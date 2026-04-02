// Nordic UART Service UUIDs — match rpi_ble_server.py exactly
export const BLE_DEVICE_NAME = 'GlassesRPi';

export const GLASSES_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
// RPi → Phone (notify): new readings from readings.jsonl
export const TX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
// Phone → RPi (write): AI answers & Spotify commands
export const RX_CHAR_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

// Chunking protocol
// Each BLE packet: [flags: 1 byte][data: up to CHUNK_SIZE bytes]
// flags = 0x00  → continuation (more chunks follow)
// flags = 0x01  → final chunk (message complete)
export const CHUNK_SIZE = 500;
export const FLAG_CONTINUATION = 0x00;
export const FLAG_FINAL = 0x01;

export const SCAN_TIMEOUT_MS = 15000;
export const CONNECT_TIMEOUT_MS = 10000;
