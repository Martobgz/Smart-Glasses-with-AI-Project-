"""
SSD1309 display driver for the Glasses RPi.

Wiring (I2C):
  SSD1309 VCC  → RPi 3.3V  (pin 1)
  SSD1309 GND  → RPi GND   (pin 6)
  SSD1309 SCL  → RPi GPIO3 (pin 5)
  SSD1309 SDA  → RPi GPIO2 (pin 3)

Install:
  sudo apt-get install -y python3-pil python3-smbus i2c-tools
  pip3 install luma.oled

Enable I2C on the Pi:
  sudo raspi-config → Interface Options → I2C → Enable
"""

import textwrap
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    from luma.core.interface.serial import i2c
    from luma.oled.device import ssd1309
    from PIL import Image, ImageDraw, ImageFont
    DISPLAY_AVAILABLE = True
except ImportError:
    DISPLAY_AVAILABLE = False
    print("[DISPLAY] luma.oled or Pillow not installed — display disabled")
    print("[DISPLAY] Run: pip3 install luma.oled Pillow")

# ── Config ────────────────────────────────────────────────────────────────────
DISPLAY_WIDTH = 128
DISPLAY_HEIGHT = 64
I2C_PORT = 1
I2C_ADDRESS = 0x3C   # Common SSD1309 address; try 0x3D if it doesn't work
FONT_SIZE = 10
LINE_HEIGHT = 12
MAX_LINES = 5         # How many lines fit on screen
CLEAR_AFTER_S = 10    # Seconds before display blanks itself


@dataclass
class DisplayMessage:
    """A message to show on the display."""
    header: str        # Bold top line (e.g. "WhatsApp" or "OCR Reading")
    body: str          # Main content
    icon: str = ''     # Optional prefix icon character


class GlassesDisplay:
    def __init__(self):
        self._device = None
        self._lock = threading.Lock()
        self._clear_timer: Optional[threading.Timer] = None
        self._current_message: Optional[DisplayMessage] = None

        if not DISPLAY_AVAILABLE:
            return

        try:
            serial = i2c(port=I2C_PORT, address=I2C_ADDRESS)
            self._device = ssd1309(serial, width=DISPLAY_WIDTH, height=DISPLAY_HEIGHT)
            self._device.contrast(200)
            self._show_boot_screen()
            print(f"[DISPLAY] SSD1309 ready at I2C {hex(I2C_ADDRESS)}")
        except Exception as e:
            print(f"[DISPLAY] Failed to initialise SSD1309: {e}")
            self._device = None

    def _show_boot_screen(self):
        self._render_raw("GlassesRPi", "Ready", icon="*")

    def show(self, msg: DisplayMessage):
        """Thread-safe: display a message and auto-clear after CLEAR_AFTER_S."""
        with self._lock:
            self._current_message = msg
            self._render_raw(msg.header, msg.body, msg.icon)
            self._reset_clear_timer()

    def clear(self):
        with self._lock:
            if self._device:
                self._device.clear()
            self._current_message = None

    # ── Internal rendering ────────────────────────────────────────────────────

    def _render_raw(self, header: str, body: str, icon: str = ''):
        if not self._device:
            print(f"[DISPLAY] {icon} {header}: {body[:60]}")
            return

        image = Image.new('1', (DISPLAY_WIDTH, DISPLAY_HEIGHT), 0)
        draw = ImageDraw.Draw(image)

        try:
            font_bold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', FONT_SIZE)
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', FONT_SIZE)
        except IOError:
            font_bold = ImageFont.load_default()
            font = ImageFont.load_default()

        y = 1
        # Header line
        prefix = f"{icon} " if icon else ""
        draw.text((0, y), f"{prefix}{header}"[:22], font=font_bold, fill=1)
        y += LINE_HEIGHT + 1

        # Divider
        draw.line([(0, y), (DISPLAY_WIDTH, y)], fill=1)
        y += 2

        # Body — word-wrap
        wrapped = textwrap.wrap(body, width=21)
        remaining_lines = (DISPLAY_HEIGHT - y) // LINE_HEIGHT
        for line in wrapped[:remaining_lines]:
            draw.text((0, y), line, font=font, fill=1)
            y += LINE_HEIGHT

        self._device.display(image)

    def _reset_clear_timer(self):
        if self._clear_timer:
            self._clear_timer.cancel()
        self._clear_timer = threading.Timer(CLEAR_AFTER_S, self.clear)
        self._clear_timer.daemon = True
        self._clear_timer.start()

    def destroy(self):
        if self._clear_timer:
            self._clear_timer.cancel()
        self.clear()


# ── Convenience functions used by rpi_ble_server.py ──────────────────────────

_display = GlassesDisplay()


def show_notification(app_label: str, title: str, body: str):
    _display.show(DisplayMessage(
        header=f"{app_label[:14]}",
        body=f"{title}: {body}" if title else body,
        icon=chr(0x2709),  # envelope character
    ))


def show_ocr_reading(text: str):
    _display.show(DisplayMessage(
        header="OCR Reading",
        body=text,
        icon=chr(0x1F453),  # glasses character (fallback to 'R' on basic font)
    ))


def show_ai_answer(question: str, answer: str):
    _display.show(DisplayMessage(
        header="Answer",
        body=answer,
        icon="?",
    ))


def show_status(text: str):
    _display.show(DisplayMessage(header="Status", body=text, icon="i"))
