import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Reading } from '../types';

interface Props {
  reading: Reading;
}

const STATUS_COLOR: Record<Reading['status'], string> = {
  pending: '#888',
  processing: '#f5a623',
  done: '#4caf50',
  error: '#e53935',
};

export default function ReadingCard({ reading }: Props) {
  const time = new Date(reading.receivedAt).toLocaleTimeString();

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.time}>{time}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[reading.status] }]}>
          <Text style={styles.badgeText}>{reading.status}</Text>
        </View>
      </View>

      {reading.cleanedText ? (
        <Text style={styles.cleanedText}>{reading.cleanedText}</Text>
      ) : (
        <Text style={styles.rawText}>{reading.rawText}</Text>
      )}

      {reading.rawText !== reading.cleanedText && reading.cleanedText ? (
        <Text style={styles.rawLabel}>Original: {reading.rawText}</Text>
      ) : null}

      {reading.isQuestion && reading.aiAnswer ? (
        <View style={styles.answerBox}>
          <Text style={styles.answerLabel}>Answer</Text>
          <Text style={styles.answerText}>{reading.aiAnswer}</Text>
        </View>
      ) : null}

      {reading.ocrConfidence !== undefined ? (
        <Text style={styles.confidence}>
          OCR confidence: {reading.ocrConfidence.toFixed(0)}%
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
    marginHorizontal: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  time: { color: '#888', fontSize: 12 },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  cleanedText: { color: '#e0e0e0', fontSize: 16, lineHeight: 22 },
  rawText: { color: '#aaa', fontSize: 15, lineHeight: 22 },
  rawLabel: { color: '#555', fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  answerBox: {
    marginTop: 10,
    backgroundColor: '#11263e',
    borderLeftWidth: 3,
    borderLeftColor: '#4a90d9',
    borderRadius: 6,
    padding: 10,
  },
  answerLabel: { color: '#4a90d9', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  answerText: { color: '#cce0ff', fontSize: 14, lineHeight: 20 },
  confidence: { color: '#555', fontSize: 11, marginTop: 8 },
});
