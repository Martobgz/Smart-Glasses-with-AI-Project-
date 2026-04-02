import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';

interface Props {
  connected: boolean;
  scanning: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function ConnectionBanner({ connected, scanning, onConnect, onDisconnect }: Props) {
  if (connected) {
    return (
      <View style={[styles.banner, styles.connected]}>
        <View style={styles.dot} />
        <Text style={styles.text}>Connected to GlassesRPi</Text>
        <TouchableOpacity onPress={onDisconnect} style={styles.btn}>
          <Text style={styles.btnText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.disconnected]}>
      {scanning ? (
        <>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={[styles.text, { marginLeft: 8 }]}>Scanning…</Text>
        </>
      ) : (
        <>
          <Text style={styles.text}>Not connected</Text>
          <TouchableOpacity onPress={onConnect} style={styles.btn}>
            <Text style={styles.btnText}>Connect</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  connected: { backgroundColor: '#1a3a1a' },
  disconnected: { backgroundColor: '#3a1a1a' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4caf50',
    marginRight: 8,
  },
  text: { color: '#ccc', flex: 1, fontSize: 13 },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  btnText: { color: '#fff', fontSize: 13 },
});
