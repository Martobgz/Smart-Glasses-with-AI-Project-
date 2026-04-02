#!/usr/bin/env python3
"""
Raspberry Pi BLE GATT server for the Glasses app.

What it does:
  - Advertises as "GlassesRPi" over Bluetooth Low Energy
  - Watches outputs/readings.jsonl for new entries written by Object_detection.py
  - Sends each new entry to the phone app via BLE notify (TX characteristic)
  - Receives AI-generated answers from the phone and speaks them via TTS
  - Receives Spotify control commands and forwards them to playerctl
    (playerctl talks to spotifyd / librespot running on the Pi)

Architecture:
  Phone app  <──BLE notify──  RPi (this script watches readings.jsonl)
  Phone app  ──BLE write──>   RPi (this script speaks answers via TTS)

BLE Service (Nordic UART Service UUIDs — must match GlassesApp/src/constants/ble.ts):
  Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
  TX char:  6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (notify, RPi → phone)
  RX char:  6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (write,  phone → RPi)

Chunking protocol (both directions):
  Each packet = [flags: 1 byte][data: up to CHUNK_SIZE bytes]
  flags 0x00 = continuation (more chunks follow)
  flags 0x01 = final chunk  (message complete)

Setup on Raspberry Pi Zero 2 W:
  sudo apt-get update
  sudo apt-get install -y bluetooth bluez python3-pip espeak playerctl
  sudo apt-get install -y python3-pil python3-smbus i2c-tools
  pip3 install bless aiofiles luma.oled Pillow

  # Enable I2C for the SSD1309 display:
  sudo raspi-config → Interface Options → I2C → Enable

  # Optional: Spotify Connect player (audio on Pi speaker)
  # https://github.com/Spotifyd/spotifyd — follow their install guide.
  # Once running, GlassesRPi will appear in Spotify Connect device list.

  python3 rpi_ble_server.py
"""

import asyncio
import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Optional

from rpi_display import show_notification, show_ocr_reading, show_ai_answer, show_status

try:
    from bless import (  # type: ignore
        BlessServer,
        BlessGATTCharacteristic,
        GATTCharacteristicProperties,
        GATTAttributePermissions,
    )
except ImportError:
    print("ERROR: 'bless' not installed. Run: pip3 install bless")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── BLE UUIDs ────────────────────────────────────────────────────────────────
SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
TX_CHAR_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  # notify  RPi → phone
RX_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  # write   phone → RPi

# ── Config ───────────────────────────────────────────────────────────────────
READINGS_PATH = Path("outputs/readings.jsonl")
CHUNK_SIZE = 500          # bytes per BLE packet (payload only)
FLAG_CONTINUATION = 0x00
FLAG_FINAL = 0x01
POLL_INTERVAL = 1.0       # seconds between file checks

# ── State ─────────────────────────────────────────────────────────────────────
rx_buffer: bytes = b""
gatt_server: Optional[BlessServer] = None


# ── TTS ──────────────────────────────────────────────────────────────────────

def speak(text: str) -> None:
    """Speak text on the Pi's wired speaker using espeak."""
    if not text.strip():
        return
    try:
        subprocess.run(
            ["espeak", "-s", "160", "-v", "en", text],
            timeout=60,
            capture_output=True,
        )
        logger.info(f"Spoke: {text[:60]}")
    except FileNotFoundError:
        logger.warning("espeak not found — falling back to pyttsx3")
        try:
            import pyttsx3  # type: ignore
            engine = pyttsx3.init()
            engine.setProperty("rate", 160)
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            logger.warning(f"TTS failed: {e}")
    except subprocess.TimeoutExpired:
        logger.warning("TTS timed out")
    except Exception as e:
        logger.warning(f"TTS error: {e}")


# ── Spotify control (via playerctl → spotifyd / librespot) ───────────────────

def spotify_command(command: str, volume: Optional[int] = None) -> None:
    try:
        if command == "play":
            subprocess.run(["playerctl", "play"], capture_output=True)
        elif command == "pause":
            subprocess.run(["playerctl", "pause"], capture_output=True)
        elif command == "next":
            subprocess.run(["playerctl", "next"], capture_output=True)
        elif command == "previous":
            subprocess.run(["playerctl", "previous"], capture_output=True)
        elif command == "set_volume" and volume is not None:
            # playerctl volume takes 0.0–1.0
            subprocess.run(
                ["playerctl", "volume", f"{volume / 100:.2f}"],
                capture_output=True,
            )
        logger.info(f"Spotify command: {command} (volume={volume})")
    except FileNotFoundError:
        logger.warning("playerctl not found. Install: sudo apt-get install playerctl")
    except Exception as e:
        logger.warning(f"Spotify command failed: {e}")


# ── Incoming message handler (phone → RPi) ────────────────────────────────────

def on_write(characteristic: BlessGATTCharacteristic, **_kwargs) -> bytearray:
    """Called by bless whenever the phone writes to the RX characteristic."""
    global rx_buffer

    raw = bytes(characteristic.value or b"")
    if not raw:
        return characteristic.value

    flag = raw[0]
    chunk = raw[1:]
    rx_buffer += chunk

    if flag == FLAG_FINAL:
        payload = rx_buffer
        rx_buffer = b""
        # Schedule processing without blocking the BLE callback
        asyncio.get_event_loop().call_soon_threadsafe(
            asyncio.ensure_future, handle_message(payload)
        )

    return characteristic.value


async def handle_message(payload: bytes) -> None:
    try:
        text = payload.decode("utf-8")
        data = json.loads(text)
        msg_type = data.get("type")

        if msg_type == "answer":
            answer = data.get("text", "")
            logger.info(f"Answer received: {answer[:80]}")
            await asyncio.to_thread(show_ai_answer, "", answer)
            await asyncio.to_thread(speak, answer)

        elif msg_type == "spotify_command":
            cmd = data.get("command", "")
            vol = data.get("volume")
            await asyncio.to_thread(spotify_command, cmd, vol)

        elif msg_type == "notification":
            app_label = data.get("app_label", data.get("app", ""))
            title = data.get("title", "")
            body = data.get("body", "")
            logger.info(f"Notification from {app_label}: {title}")
            await asyncio.to_thread(show_notification, app_label, title, body)
            # Speak a brief alert: just app + title (not full body, to keep it quick)
            if title:
                await asyncio.to_thread(speak, f"{app_label}: {title}")

        else:
            logger.info(f"Unknown message type: {msg_type}")

    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning(f"Bad message from phone: {e}")


# ── Send data to phone (RPi → phone, chunked notify) ─────────────────────────

async def send_to_phone(server: BlessServer, message: str) -> None:
    """Send a UTF-8 JSON string to the phone in CHUNK_SIZE-byte chunks."""
    data = message.encode("utf-8")
    offset = 0

    while offset < len(data):
        chunk = data[offset: offset + CHUNK_SIZE]
        offset += CHUNK_SIZE
        flag = FLAG_FINAL if offset >= len(data) else FLAG_CONTINUATION
        packet = bytearray([flag]) + bytearray(chunk)

        char = server.get_characteristic(TX_CHAR_UUID)
        if char is None:
            logger.error("TX characteristic not found")
            return
        char.value = packet
        server.update_value(SERVICE_UUID, TX_CHAR_UUID)

        if offset < len(data):
            await asyncio.sleep(0.05)  # pacing between chunks

    logger.info(f"Sent {len(data)} bytes to phone")


# ── readings.jsonl watcher ────────────────────────────────────────────────────

async def watch_readings(server: BlessServer) -> None:
    """Tail readings.jsonl and forward new entries to the phone."""
    # Start from the current end of the file so we don't replay old entries
    last_pos: int = READINGS_PATH.stat().st_size if READINGS_PATH.exists() else 0
    logger.info(f"Watching {READINGS_PATH} (starting at byte {last_pos})")

    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            if not READINGS_PATH.exists():
                continue
            current_size = READINGS_PATH.stat().st_size
            if current_size <= last_pos:
                continue

            with open(READINGS_PATH, "r", encoding="utf-8") as fh:
                fh.seek(last_pos)
                for raw_line in fh:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # Only forward records that have readable text
                    text = record.get("text", "").strip()
                    if not text:
                        continue

                    payload = {
                        "type": "reading",
                        "timestamp": record.get("timestamp"),
                        "text": text,
                        "status": record.get("status", "ok"),
                        "ocr_confidence": record.get("ocr_confidence"),
                    }
                    # Show raw OCR on display immediately (AI-cleaned version
                    # will overwrite it when the answer comes back from phone)
                    await asyncio.to_thread(show_ocr_reading, text)
                    await send_to_phone(server, json.dumps(payload))

                last_pos = fh.tell()

        except Exception as e:
            logger.error(f"Error reading {READINGS_PATH}: {e}")


# ── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    global gatt_server

    loop = asyncio.get_event_loop()
    stop = asyncio.Event()

    server = BlessServer(name="GlassesRPi", loop=loop)
    server.read_request_func = lambda char, **_: char.value
    server.write_request_func = on_write
    gatt_server = server

    # Register service
    await server.add_new_service(SERVICE_UUID)

    # TX characteristic — phone subscribes to notifications
    await server.add_new_characteristic(
        SERVICE_UUID,
        TX_CHAR_UUID,
        GATTCharacteristicProperties.notify,
        None,
        GATTAttributePermissions.readable,
    )

    # RX characteristic — phone writes answers / commands here
    await server.add_new_characteristic(
        SERVICE_UUID,
        RX_CHAR_UUID,
        GATTCharacteristicProperties.write | GATTCharacteristicProperties.write_without_response,
        None,
        GATTAttributePermissions.writeable,
    )

    await server.start()
    logger.info("=== GlassesRPi BLE server started ===")
    logger.info(f"Service UUID : {SERVICE_UUID}")
    logger.info(f"TX (notify)  : {TX_CHAR_UUID}")
    logger.info(f"RX (write)   : {RX_CHAR_UUID}")
    logger.info(f"Watching     : {READINGS_PATH.resolve()}")
    logger.info("Waiting for phone to connect…")

    # Start the file watcher
    asyncio.create_task(watch_readings(server))

    # Run until interrupted
    try:
        await stop.wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await server.stop()
        logger.info("BLE server stopped.")


if __name__ == "__main__":
    asyncio.run(main())
