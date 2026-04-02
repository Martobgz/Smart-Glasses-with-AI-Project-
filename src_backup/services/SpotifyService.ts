/**
 * Spotify integration via the Spotify Web API (no native SDK needed).
 *
 * Flow:
 *   1. User taps "Connect" → opens Spotify auth URL in the phone browser.
 *   2. After login Spotify redirects to glasses-app://spotify-callback?code=...
 *   3. We exchange the code for an access token.
 *   4. All playback commands go to https://api.spotify.com/v1/me/player/...
 *
 * Requirements:
 *   - Spotify Developer app with redirect URI: glasses-app://spotify-callback
 *   - Spotify Premium account (Web API playback control requires Premium)
 *
 * To fill in:
 *   CLIENT_ID     → your Spotify app's Client ID
 *   CLIENT_SECRET → your Spotify app's Client Secret
 */

import { Linking } from 'react-native';
import { SpotifyState } from '../types';

const CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID_HERE';
const CLIENT_SECRET = 'YOUR_SPOTIFY_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'glasses-app://spotify-callback';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const BASE = 'https://api.spotify.com/v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiresAt = 0;

// ── Auth helpers ─────────────────────────────────────────────────────────────

function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCode(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = await res.json();
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
}

async function refreshAccessToken(): Promise<void> {
  if (!refreshToken) throw new Error('No refresh token');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
}

async function getToken(): Promise<string> {
  if (!accessToken) throw new Error('Not authenticated');
  if (Date.now() > tokenExpiresAt - 30_000) await refreshAccessToken();
  return accessToken!;
}

async function apiCall(method: string, path: string, body?: object): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Public service ────────────────────────────────────────────────────────────

class SpotifyServiceClass {
  private _connected = false;
  private _pendingResolve: ((code: string) => void) | null = null;

  /** Open Spotify login in the browser. Call handleCallback() when redirected back. */
  async connect(): Promise<void> {
    const state = Math.random().toString(36).slice(2);
    const url = buildAuthUrl(state);

    return new Promise((resolve, reject) => {
      this._pendingResolve = async (code: string) => {
        try {
          await exchangeCode(code);
          this._connected = true;
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      Linking.openURL(url).catch(reject);
    });
  }

  /** Call this from App.tsx's Linking event handler with the full deep-link URL. */
  handleCallback(url: string): void {
    const match = url.match(/[?&]code=([^&]+)/);
    if (match && this._pendingResolve) {
      this._pendingResolve(decodeURIComponent(match[1]));
      this._pendingResolve = null;
    }
  }

  isConnected(): boolean {
    return this._connected && !!accessToken;
  }

  async disconnect(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    this._connected = false;
  }

  async getPlayerState(): Promise<SpotifyState | null> {
    try {
      const data = await apiCall('GET', '/me/player');
      if (!data) return null;
      const item = data.item;
      return {
        isPaused: !data.is_playing,
        volume: (data.device?.volume_percent ?? 50) / 100,
        isConnected: true,
        track: item
          ? {
              name: item.name,
              artist: item.artists?.map((a: any) => a.name).join(', ') ?? '',
              albumName: item.album?.name ?? '',
              albumArtUrl: item.album?.images?.[0]?.url,
              durationMs: item.duration_ms,
              positionMs: data.progress_ms ?? 0,
            }
          : null,
      };
    } catch {
      return null;
    }
  }

  async play(): Promise<void> {
    await apiCall('PUT', '/me/player/play');
  }

  async pause(): Promise<void> {
    await apiCall('PUT', '/me/player/pause');
  }

  async skipNext(): Promise<void> {
    await apiCall('POST', '/me/player/next');
  }

  async skipPrevious(): Promise<void> {
    await apiCall('POST', '/me/player/previous');
  }

  async setVolume(volume: number): Promise<void> {
    const pct = Math.round(volume * 100);
    await apiCall('PUT', `/me/player/volume?volume_percent=${pct}`);
  }

  async playUri(uri: string): Promise<void> {
    await apiCall('PUT', '/me/player/play', { context_uri: uri });
  }
}

export const SpotifyService = new SpotifyServiceClass();
