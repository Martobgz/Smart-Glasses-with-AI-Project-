import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReadingCard from '../components/ReadingCard';
import { Reading } from '../types';

const STORAGE_KEY = '@glasses_readings';

export default function NotificationsScreen() {
  const [readings, setReadings] = useState<Reading[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setReadings(JSON.parse(stored));
    } catch {/* ignore */}
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={readings}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ReadingCard reading={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No readings yet.</Text>
            <Text style={styles.emptySubtext}>
              Connect to your glasses and point at text to start.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12121c' },
  list: { paddingVertical: 12, paddingBottom: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#555', fontSize: 16, marginBottom: 8 },
  emptySubtext: { color: '#444', textAlign: 'center', paddingHorizontal: 32 },
});
