export interface Reading {
  id: string;
  timestamp: string;
  rawText: string;
  cleanedText: string;
  isQuestion: boolean;
  aiAnswer?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  ocrConfidence?: number;
  receivedAt: number; // Date.now()
}

export interface AIResult {
  cleanedText: string;
  isQuestion: boolean;
  answer?: string;
}

export interface SpotifyTrack {
  name: string;
  artist: string;
  albumName: string;
  albumArtUrl?: string;
  durationMs: number;
  positionMs: number;
}

export interface SpotifyState {
  track: SpotifyTrack | null;
  isPaused: boolean;
  volume: number;
  isConnected: boolean;
}

export interface BLEMessage {
  type: 'reading' | 'answer' | 'spotify_command' | 'status';
  timestamp?: string;
  text?: string;
  status?: string;
  ocr_confidence?: number;
  command?: string;
  volume?: number;
}
