export type VideoEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264';
export type RestreamPlatform = 'twitch' | 'youtube' | 'kick' | 'custom';
export type OffAirMode = 'ddagrab' | 'dshow';
export type LayoutMode =
  | 'split_2box'
  | 'top_cam_bottom_game'
  | 'pip_rounded'
  | 'blurred_pillarbox'
  | 'fullscreen_gameplay'
  | 'fullscreen_cam';
export type WhisperModelId = 'base.en' | 'small' | 'large-v3-turbo';
export type AiSensitivity = 'high_recall' | 'balanced' | 'strict';
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
  adapterName?: string;
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
  freeBytes?: number | null;
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

export type AiDetectionMode = 'audio_visual' | 'audio_only' | 'visual_only' | 'off';
export type AiVisualFocus = 'balanced' | 'clutch_heavy' | 'funny_reactions';
export type FacecamShape = 'rectangle' | 'rounded' | 'circle';

export interface OffAirFacecamConfig {
  x: number;
  y: number;
  widthPct: number;
  zoom: number;
  mirror: boolean;
  shape: FacecamShape;
  border: boolean;
}

export const DEFAULT_OFF_AIR_FACECAM: OffAirFacecamConfig = {
  x: 0.73,
  y: 0.68,
  widthPct: 25,
  zoom: 1.0,
  mirror: false,
  shape: 'rounded',
  border: true,
};

export interface AppSettings {
  bufferMinutes: number;
  maxBufferGb: number;
  ramDiskEnabled: boolean;
  ramDiskPath: string;
  dvrStorageDir: string;
  pinnedClipsDir: string;
  appMode: 'onair' | 'offair';
  offAirMode: OffAirMode;
  dshowVideoDevice: string;
  dshowAudioDevice: string;
  webcamDevice: string;
  obsWsUrl: string;
  obsWsPassword: string;
  replayWatchDir: string;
  audioT1Device: string;
  audioT2Device: string;
  audioT3Device: string;
  whisperModel?: WhisperModelId;
  aiDetectionMode?: AiDetectionMode;
  aiVisualFocus?: AiVisualFocus;
  aiSensitivity?: AiSensitivity;
  aiMaxClipSec?: number;
  brandWatermark?: string;
  offAirFacecam?: OffAirFacecamConfig;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  flow: 'render' | 'capture';
  isDefaultConsole: boolean;
  isDefaultComms: boolean;
}

export interface DshowDeviceList {
  video: string[];
  audio: string[];
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
  state?: 'idle' | 'starting' | 'running' | 'stopping';
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

export interface SubtitleWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface SubtitleCue {
  id: number;
  startSec: number;
  endSec: number;
  text: string;
  words?: SubtitleWord[];
}

export interface SubtitleStyle {
  fontSize: number;
  colorHex: string;
  verticalPos: 'top' | 'middle' | 'bottom';
}

export interface PinnedClip {
  id: number;
  filePath: string;
  filename: string;
  triggerSource: 'obs' | 'hotkey' | 'ai';
  triggerLabel: string;
  durationSec: number;
  cropPreset: ObsScenePreset | null;
  status?: 'pending' | 'approved' | 'dismissed';
  subtitles?: SubtitleCue[];
  srtPath?: string;
  createdAt: string;
}

export interface AiHighlightItem {
  id: number;
  status: 'pending' | 'approved' | 'auto_exported' | 'dismissed';
  score: number;
  pinnedClipId: number | null;
  clipFilename?: string;
  clipDurationSec?: number;
  transcript: string;
  signals: {
    chat: number;
    audio: number;
    visual: number;
    transcript: number;
    whisperAvailable: boolean;
    reasons: string[];
    headline?: string;
    tags?: string[];
    summary?: string;
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

export interface ProgramRelayStatus {
  running: boolean;
  source: 'stopped' | 'standby_bars' | 'live_obs';
  toneMuted: boolean;
  pid: number | null;
  obsLive: boolean;
  outputUrl: string;
  error?: string;
}

export interface DvrRetentionStats {
  bufferDir: string;
  segmentCount: number;
  bufferBytes: number;
  maxBufferGb: number;
  bufferMinutes: number;
  freeDriveBytes: number | null;
  lowDiskWarning: boolean;
}

export interface WhisperModelInfo {
  id: WhisperModelId;
  label: string;
  filename: string;
  approxSizeMb: number;
  downloaded: boolean;
  sizeBytes: number;
  active: boolean;
}

export interface WhisperDownloadState {
  model: WhisperModelId | null;
  downloading: boolean;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface BatchExportJob {
  jobId: string;
  pinnedClipId: number;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  downloadUrl?: string;
  filename?: string;
  exportDir?: string;
  hookTitle?: string;
  hashtags?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ControlRoomState {
  gpu: GpuDetectionResult | null;
  settings: AppSettings;
  lanIp?: string;
  ingest: MediaMtxStatus;
  relay?: ProgramRelayStatus;
  dvrRetention?: DvrRetentionStats;
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
    sensitivity?: AiSensitivity;
    audioScore?: number;
    vocalScore?: number;
    visualScore?: number;
    combinedScore?: number;
    threshold?: number;
    lastDecision?: string;
    visualEngineStatus?: string;
    visualEngineError?: string | null;
  };
  aiQueue: AiHighlightItem[];
  demo: { running: boolean; pid: number | null };
  whisperModels?: WhisperModelInfo[];
  whisperDownload?: WhisperDownloadState;
  batchExportQueue?: BatchExportJob[];
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
      selectDirectory?: (defaultPath?: string) => Promise<string | null>;
      openFolder?: (targetPath: string) => Promise<string>;
      submitFeedback?: (payload: {
        category: string;
        details: string;
        handle: string;
        diagnostics: string;
      }) => Promise<{ ok: boolean; status?: number; fallbackOpened?: boolean; error?: string }>;
      onUpdateStatus: (cb: (status: DesktopUpdateStatus) => void) => () => void;
    };
  }
}
