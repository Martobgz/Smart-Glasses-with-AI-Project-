import { BleManager, Device, BleError, Characteristic, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { encode as b64encode, decode as b64decode } from 'base-64';
import {
  BLE_DEVICE_NAME,
  GLASSES_SERVICE_UUID,
  TX_CHAR_UUID,
  RX_CHAR_UUID,
  CHUNK_SIZE,
  FLAG_CONTINUATION,
  FLAG_FINAL,
  SCAN_TIMEOUT_MS,
} from '../constants/ble';
import { BLEMessage } from '../types';

type MessageCallback = (message: BLEMessage) => void;
type ConnectionCallback = (connected: boolean) => void;

class BluetoothServiceClass {
  private manager: BleManager;
  private device: Device | null = null;
  private rxBuffer: number[] = [];
  private onMessage: MessageCallback | null = null;
  private onConnectionChange: ConnectionCallback | null = null;
  private scanTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  setMessageHandler(cb: MessageCallback) {
    this.onMessage = cb;
  }

  setConnectionHandler(cb: ConnectionCallback) {
    this.onConnectionChange = cb;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const apiLevel = parseInt(Platform.Version as string, 10);
      if (apiLevel >= 31) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    // iOS: permissions handled in Info.plist
    return true;
  }

  async waitForBluetooth(): Promise<void> {
    return new Promise(resolve => {
      const sub = this.manager.onStateChange(state => {
        if (state === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  async scan(): Promise<Device | null> {
    await this.waitForBluetooth();

    return new Promise((resolve, reject) => {
      let found: Device | null = null;

      this.scanTimeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        if (!found) reject(new Error('Device not found. Make sure the RPi is powered and nearby.'));
      }, SCAN_TIMEOUT_MS);

      this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, scannedDevice) => {
        if (error) {
          this.clearScanTimeout();
          reject(error);
          return;
        }
        if (scannedDevice?.name === BLE_DEVICE_NAME || scannedDevice?.localName === BLE_DEVICE_NAME) {
          this.clearScanTimeout();
          this.manager.stopDeviceScan();
          found = scannedDevice;
          resolve(scannedDevice);
        }
      });
    });
  }

  async connect(): Promise<void> {
    const scanned = await this.scan();
    if (!scanned) throw new Error('No device found');

    const connected = await scanned.connect();
    await connected.discoverAllServicesAndCharacteristics();
    this.device = connected;

    // Request larger MTU for bigger chunks
    try {
      await this.device.requestMTU(512);
    } catch {
      // Not critical; fallback to default MTU
    }

    // Subscribe to disconnect
    this.device.onDisconnected(() => {
      this.device = null;
      this.rxBuffer = [];
      this.onConnectionChange?.(false);
    });

    // Subscribe to incoming readings from RPi
    this.device.monitorCharacteristicForService(
      GLASSES_SERVICE_UUID,
      TX_CHAR_UUID,
      this.handleIncomingChunk,
    );

    this.onConnectionChange?.(true);
  }

  private handleIncomingChunk = (_error: BleError | null, char: Characteristic | null) => {
    if (!char?.value) return;

    const bytes = Array.from(Buffer.from(char.value, 'base64'));
    if (bytes.length < 1) return;

    const flag = bytes[0];
    const chunk = bytes.slice(1);
    this.rxBuffer.push(...chunk);

    if (flag === FLAG_FINAL) {
      try {
        const text = Buffer.from(this.rxBuffer).toString('utf-8');
        this.rxBuffer = [];
        const message: BLEMessage = JSON.parse(text);
        this.onMessage?.(message);
      } catch {
        this.rxBuffer = [];
      }
    }
  };

  async sendMessage(message: BLEMessage): Promise<void> {
    if (!this.device) throw new Error('Not connected');

    const text = JSON.stringify(message);
    const bytes = Buffer.from(text, 'utf-8');
    let offset = 0;

    while (offset < bytes.length) {
      const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
      offset += CHUNK_SIZE;
      const flag = offset >= bytes.length ? FLAG_FINAL : FLAG_CONTINUATION;
      const packet = Buffer.concat([Buffer.from([flag]), chunk]);

      await this.device.writeCharacteristicWithResponseForService(
        GLASSES_SERVICE_UUID,
        RX_CHAR_UUID,
        b64encode(String.fromCharCode(...packet)),
      );
    }
  }

  async sendAnswer(text: string): Promise<void> {
    await this.sendMessage({ type: 'answer', text });
  }

  async sendSpotifyCommand(command: string, volume?: number): Promise<void> {
    await this.sendMessage({ type: 'spotify_command', command, volume });
  }

  disconnect() {
    this.clearScanTimeout();
    this.device?.cancelConnection();
    this.device = null;
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  private clearScanTimeout() {
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
  }

  destroy() {
    this.disconnect();
    this.manager.destroy();
  }
}

export const BluetoothService = new BluetoothServiceClass();
