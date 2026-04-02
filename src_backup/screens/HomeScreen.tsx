import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BluetoothService } from '../services/BluetoothService';
import { processOCRText } from '../services/AIService';
import { showReadingNotification, setupNotifications } from '../services/NotificationService';
import ConnectionBanner from '../components/ConnectionBanner';
import ReadingCard from '../components/ReadingCard';
import { Reading, BLEMessage } from '../types';

const STORAGE_KEY = '@glasses_readings';

export default function HomeScreen() {
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [latestReading, setLatestReading] = useState<Reading | null>(null);

  // Keep readings in a ref so the BLE callback always sees the latest value
  const readingsRef = useRef<Reading[]>([]);

  // ---- Persistence --------------------------------------------------------
  useEffect(() => {
    (async () => {
      await setupNotifications();
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: Reading[] = JSON.parse(stored);
          readingsRef.current = parsed;
          setReadings(parsed);
          setLatestReading(parsed[0] ?? null);
        }
      } catch {/* ignore */}
    })();

    BluetoothService.setConnectionHandler(setConnected);
    BluetoothService.setMessageHandler(handleIncomingMessage);

    return () => {
      BluetoothService.disconnect();
    };
  }, []);

  async function persistReadings(updated: Reading[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 200)));
  }

  // ---- BLE message handler ------------------------------------------------
  const handleIncomingMessage = useCallback(async (msg: BLEMessage) => {
    if (msg.type !== 'reading' || !msg.text) return;

    const newReading: Reading = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: msg.timestamp ?? new Date().toISOString(),
      rawText: msg.text,
      cleanedText: msg.text,
      isQuestion: false,
      status: 'processing',
      ocrConfidence: msg.ocr_confidence,
      receivedAt: Date.now(),
    };

    // Add immediately so user sees it
    const withNew = [newReading, ...readingsRef.current];
    readingsRef.current = withNew;
    setReadings([...withNew]);
    setLatestReading(newReading);

    // --- AI processing ---
    let result;
    try {
      result = await processOCRText(msg.text);
    } catch (e) {
      const updated = withNew.map(r =>
        r.id === newReading.id ? { ...r, status: 'error' as const } : r,
      );
      readingsRef.current = updated;
      setReadings([...updated]);
      return;
    }

    const finished: Reading = {
      ...newReading,
      cleanedText: result.cleanedText,
      isQuestion: result.isQuestion,
      aiAnswer: result.answer,
      status: 'done',
    };

    const finalList = withNew.map(r => (r.id === newReading.id ? finished : r));
    readingsRef.current = finalList;
    setReadings([...finalList]);
    setLatestReading(finished);
    await persistReadings(finalList);

    // Send answer back to RPi for TTS playback
    if (result.isQuestion && result.answer) {
      try {
        await BluetoothService.sendAnswer(result.answer);
      } catch {/* silent */}
    }

    // Show notification
    await showReadingNotification(finished);
  }, []);

  // ---- BLE connection -----------------------------------------------------
  async function handleConnect() {
    setScanning(true);
    try {
      const ok = await BluetoothService.requestPermissions();
      if (!ok) {
        Alert.alert('Permission required', 'Bluetooth permission is needed to connect.');
        return;
      }
      await BluetoothService.connect();
    } catch (e: any) {
      Alert.alert('Connection failed', e.message ?? 'Could not connect to GlassesRPi.');
    } finally {
      setScanning(false);
    }
  }

  function handleDisconnect() {
    BluetoothService.disconnect();
    setConnected(false);
  }

  // ---- UI -----------------------------------------------------------------
  return (
    <View style={styles.container}>
      <ConnectionBanner
        connected={connected}
        scanning={scanning}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero: latest reading */}
        <View style={styles.heroSection}>
          <Text style={styles.heroLabel}>Latest Reading</Text>
          {latestReading ? (
            <ReadingCard reading={latestReading} />
          ) : (
            <View style={styles.emptyHero}>
              <Text style={styles.emptyText}>
                {connected
                  ? 'Waiting for a reading from the glasses…'
                  : 'Connect to your glasses to start receiving readings.'}
              </Text>
            </View>
          )}
        </View>

        {/* Recent readings */}
        {readings.length > 1 && (
          <View style={styles.recentSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <TouchableOpacity
                onPress={() => {
                  readingsRef.current = [];
                  setReadings([]);
                  setLatestReading(null);
                  AsyncStorage.removeItem(STORAGE_KEY);
                }}>
                <Text style={styles.clearBtn}>Clear</Text>
              </TouchableOpacity>
            </View>
            {readings.slice(1, 6).map(r => (
              <ReadingCard key={r.id} reading={r} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12121c' },
  scroll: { paddingBottom: 24 },
  heroSection: { paddingTop: 16 },
  heroLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginLeft: 16,
    marginBottom: 4,
  },
  emptyHero: {
    margin: 12,
    padding: 24,
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: { color: '#555', textAlign: 'center', lineHeight: 22 },
  recentSection: { marginTop: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 4,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  clearBtn: { color: '#e53935', fontSize: 13 },
});
