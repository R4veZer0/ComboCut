export type VideoEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264';
export type RestreamPlatform = 'twitch' | 'youtube' | 'kick' | 'custom';
export type OffAirMode = 'ddagrab' | 'dshow';
export type LayoutMode = 'split_2box' | 'fullscreen_gameplay' | 'fullscreen_cam';
export type SafeZonePlatform = 'none' | 'tiktok' | 'shorts' | 'reels' | 'universal';
export type ColorPreset = 'none' | 'vibrant' | 'cinematic' | 'crisp';

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GpuDetectionResult {
  selected: VideoEncoder;
  probed: Array<{ encoder: VideoEncoder; available: boolean; reason?: string }>;
  detectedAt: string;
}

export interface IngestPathStatus {
  name: 'live/program' | 'live/cam' | 'live/clean';
  ready: boolean;
  readyTime: string | null;
  tracks: string[];
  bytesReceived: number;
  readersCount: number;
}

export interface MediaMtxStatus {
  running: boolean;
  pid: number | null;
  rtmpUrl: string;
  srtUrl: string;
  apiUrl: string;
  paths: IngestPathStatus[];
  error?: string;
}

export interface HlsDvrStatus {
  running: boolean;
  pid: number | null;
  bufferDir: string;
  ramDiskActive: boolean;
  bufferMinutes: number;
  segmentCount: number;
  totalBytes: number;
  playlistUrl: string;
  error?: string;
}

export interface RestreamTarget {
  id: number;
  name: string;
  platform: RestreamPlatform;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
  twitchDownscale1080p60: boolean;
  createdAt: string;
}

export interface RestreamWorkerStatus {
  targetId: number;
  state: 'stopped' | 'starting' | 'live' | 'reconnecting' | 'error';
  pid: number | null;
  startedAt: string | null;
  reconnectCount: number;
  mode: 'copy' | 'twitch-1080p60';
  encoder: VideoEncoder | 'copy';
  lastError?: string;
}

export interface AppSettings {
  bufferMinutes: number;
  ramDiskEnabled: boolean;
  ramDiskPath: string;
  offAirMode: OffAirMode;
  dshowVideoDevice: string;
  dshowAudioDevice: string;
  webcamDevice: string;
  obsWsUrl: string;
  obsWsPassword: string;
  replayWatchDir: string;
}

export interface WasapiAudioStatus {
  running: boolean;
  pid: number | null;
  pipes: {
    t1: string;
    t2: string;
    t3: string;
    connected: [boolean, boolean, boolean];
  };
  meters: { t1: number; t2: number; t3: number };
  trackDevices: { t1: string; t2: string; t3: string };
  lastHotSwapAt: string | null;
  error?: string;
}

export interface OffAirStatus {
  running: boolean;
  pid: number | null;
  mode: OffAirMode;
  encoder: string;
  audioTracks: number;
  bufferDir: string;
  playlistUrl: string;
  dshowVideoDevice: string;
  webcamDevice: string;
  lastAutoReleaseReason: string | null;
  lastAutoReleaseAt: string | null;
  error?: string;
}

export interface ObsScenePreset {
  sceneName: string;
  webcamSource: string;
  webcamRect: NormalizedRect | null;
  layoutMode: LayoutMode;
  updatedAt: string;
}

export interface ObsWebSocketStatus {
  connected: boolean;
  connecting: boolean;
  url: string;
  currentScene: string | null;
  activePreset: ObsScenePreset | null;
  error?: string;
}

export interface TimelineMarker {
  id: number;
  timestampMs: number;
  source: 'obs' | 'hotkey' | 'ai';
  label: string;
  sceneName: string;
  createdAt: string;
}

export interface PinnedClip {
  id: number;
  filePath: string;
  filename: string;
  triggerSource: 'obs' | 'hotkey' | 'ai';
  triggerLabel: string;
  durationSec: number;
  cropPreset: ObsScenePreset | null;
  createdAt: string;
}

export interface AiHighlightItem {
  id: number;
  status: 'pending' | 'approved' | 'auto_exported' | 'dismissed';
  score: number;
  pinnedClipId: number | null;
  transcript: string;
  signals: {
    chat: number;
    audio: number;
    visual: number;
    transcript: number;
    whisperAvailable: boolean;
    reasons: string[];
  };
  exportPath?: string;
  createdAt: string;
}

export interface VodItem {
  id: number;
  filePath: string;
  filename: string;
  sourceType: 'drop' | 'replay';
  durationSec: number;
  status: 'queued' | 'scanning' | 'ready' | 'error';
  sceneTimestamps: number[];
  audioPeaks: number[];
  createdAt: string;
}

export interface ControlRoomState {
  gpu: GpuDetectionResult | null;
  settings: AppSettings;
  ingest: MediaMtxStatus;
  hls: HlsDvrStatus;
  restreamWorkers: RestreamWorkerStatus[];
  audio: WasapiAudioStatus;
  offAir: OffAirStatus;
  obs: ObsWebSocketStatus;
  vodItems: VodItem[];
  markers: TimelineMarker[];
  pinnedClips: PinnedClip[];
  chat: {
    enabled: boolean;
    onAir: boolean;
    connected: boolean;
    channel: string;
    score: number;
  };
  ai: {
    monitoring: boolean;
    evaluating: boolean;
    whisperAvailable: boolean;
    weights: { chat: number; audio: number; visual: number; transcript: number };
  };
  aiQueue: AiHighlightItem[];
  demo: { running: boolean; pid: number | null };
}

export interface DesktopUpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  percent?: number;
  message: string;
}

declare global {
  interface Window {
    combocutDesktop?: {
      isDesktop: boolean;
      checkForUpdates: () => Promise<DesktopUpdateStatus>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (cb: (status: DesktopUpdateStatus) => void) => () => void;
    };
  }
}
