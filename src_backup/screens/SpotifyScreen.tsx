import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SpotifyService } from '../services/SpotifyService';
import { BluetoothService } from '../services/BluetoothService';
import { SpotifyState } from '../types';

const POLL_MS = 2000;

export default function SpotifyScreen() {
  const [spotifyState, setSpotifyState] = useState<SpotifyState>({
    track: null,
    isPaused: true,
    volume: 0.5,
    isConnected: false,
  });
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Lifecycle ----------------------------------------------------------
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      SpotifyService.disconnect().catch(() => {});
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const state = await SpotifyService.getPlayerState();
        if (state) setSpotifyState(state);
      } catch {/* ignore */}
    }, POLL_MS);
  }, []);

  // ---- Spotify auth -------------------------------------------------------
  async function handleConnectSpotify() {
    setConnecting(true);
    try {
      await SpotifyService.connect();
      const state = await SpotifyService.getPlayerState();
      if (state) setSpotifyState(state);
      startPolling();
    } catch (e: any) {
      Alert.alert(
        'Spotify error',
        e.message ?? 'Could not connect to Spotify. Make sure the Spotify app is installed.',
      );
    } finally {
      setConnecting(false);
    }
  }

  // ---- Controls -----------------------------------------------------------
  async function togglePlay() {
    try {
      if (spotifyState.isPaused) {
        await SpotifyService.play();
        await BluetoothService.sendSpotifyCommand('play');
      } else {
        await SpotifyService.pause();
        await BluetoothService.sendSpotifyCommand('pause');
      }
      setSpotifyState(prev => ({ ...prev, isPaused: !prev.isPaused }));
    } catch {/* ignore */}
  }

  async function skipNext() {
    await SpotifyService.skipNext();
    await BluetoothService.sendSpotifyCommand('next');
  }

  async function skipPrev() {
    await SpotifyService.skipPrevious();
    await BluetoothService.sendSpotifyCommand('previous');
  }

  async function onVolumeChange(v: number) {
    setSpotifyState(prev => ({ ...prev, volume: v }));
    await SpotifyService.setVolume(v);
    await BluetoothService.sendSpotifyCommand('set_volume', Math.round(v * 100));
  }

  // ---- Render -------------------------------------------------------------
  if (!spotifyState.isConnected) {
    return (
      <View style={styles.center}>
        {connecting ? (
          <ActivityIndicator color="#1db954" size="large" />
        ) : (
          <>
            <Text style={styles.title}>Spotify</Text>
            <Text style={styles.subtitle}>
              Connect Spotify to control playback.{'\n'}
              Music plays on the RPi speaker via Spotify Connect{'\n'}
              (GlassesRPi must be running librespot).
            </Text>
            <TouchableOpacity style={styles.connectBtn} onPress={handleConnectSpotify}>
              <Text style={styles.connectBtnText}>Connect to Spotify</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const { track, isPaused, volume } = spotifyState;

  return (
    <View style={styles.container}>
      {/* Album art */}
      <View style={styles.artContainer}>
        {track?.albumArtUrl ? (
          <Image source={{ uri: track.albumArtUrl }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Text style={styles.artPlaceholderText}>♪</Text>
          </View>
        )}
      </View>

      {/* Track info */}
      <View style={styles.trackInfo}>
        <Text style={styles.trackName} numberOfLines={1}>
          {track?.name ?? 'Nothing playing'}
        </Text>
        <Text style={styles.artistName} numberOfLines={1}>
          {track?.artist ?? ''}
        </Text>
        {track?.albumName ? (
          <Text style={styles.albumName} numberOfLines={1}>
            {track.albumName}
          </Text>
        ) : null}
      </View>

      {/* Playback controls */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={skipPrev} style={styles.controlBtn}>
          <Text style={styles.controlIcon}>⏮</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Text style={styles.playIcon}>{isPaused ? '▶' : '⏸'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={skipNext} style={styles.controlBtn}>
          <Text style={styles.controlIcon}>⏭</Text>
        </TouchableOpacity>
      </View>

      {/* Volume */}
      <View style={styles.volumeRow}>
        <Text style={styles.volumeIcon}>🔈</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={volume}
          onSlidingComplete={onVolumeChange}
          minimumTrackTintColor="#1db954"
          maximumTrackTintColor="#444"
          thumbTintColor="#1db954"
        />
        <Text style={styles.volumeIcon}>🔊</Text>
      </View>

      <Text style={styles.hint}>
        Audio plays on GlassesRPi via Spotify Connect
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12121c', alignItems: 'center', paddingTop: 32 },
  center: { flex: 1, backgroundColor: '#12121c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 12 },
  subtitle: { color: '#888', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  connectBtn: {
    backgroundColor: '#1db954',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  connectBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  artContainer: { marginBottom: 24 },
  art: { width: 240, height: 240, borderRadius: 16 },
  artPlaceholder: {
    backgroundColor: '#2a2a3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artPlaceholderText: { fontSize: 80, color: '#555' },
  trackInfo: { width: '80%', alignItems: 'center', marginBottom: 32 },
  trackName: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  artistName: { color: '#aaa', fontSize: 16, marginTop: 4 },
  albumName: { color: '#666', fontSize: 13, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 32 },
  controlBtn: { padding: 12 },
  controlIcon: { fontSize: 28, color: '#fff' },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1db954',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { fontSize: 26, color: '#fff' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', width: '80%', gap: 8 },
  volumeIcon: { fontSize: 18 },
  slider: { flex: 1, height: 40 },
  hint: { color: '#444', fontSize: 12, marginTop: 24 },
});
