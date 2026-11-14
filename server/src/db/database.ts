import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ensureRuntimeDirs } from '../config/paths.js';

export type RestreamPlatform = 'twitch' | 'youtube' | 'kick' | 'custom';

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

export type OffAirMode = 'ddagrab' | 'dshow';
export type VodSourceType = 'drop' | 'replay';
export type VodScanStatus = 'queued' | 'scanning' | 'ready' | 'error';
export type MarkerSource = 'obs' | 'hotkey' | 'ai';
export type AiHighlightStatus = 'pending' | 'approved' | 'auto_exported' | 'dismissed';
export type AiDetectionMode = 'audio_visual' | 'audio_only' | 'visual_only' | 'off';
export type AiVisualFocus = 'balanced' | 'clutch_heavy' | 'funny_reactions';
export type AiSensitivity = 'high_recall' | 'balanced' | 'strict';

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineMarker {
  id: number;
  timestampMs: number;
  source: MarkerSource;
  label: string;
  sceneName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type LayoutMode =
  | 'split_2box'
  | 'top_cam_bottom_game'
  | 'pip_rounded'
  | 'blurred_pillarbox'
  | 'fullscreen_gameplay'
  | 'fullscreen_cam';

export type WhisperModelId = 'base.en' | 'small' | 'large-v3-turbo';

export interface ObsScenePreset {
  sceneName: string;
  webcamSource: string;
  webcamRect: NormalizedRect | null;
  layoutMode: LayoutMode;
  updatedAt: string;
}

export type ClipStatus = 'pending' | 'approved' | 'dismissed';

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

export interface PinnedClip {
  id: number;
  filePath: string;
  filename: string;
  triggerSource: MarkerSource;
  triggerLabel: string;
  durationSec: number;
  cropPreset: ObsScenePreset | null;
  status: ClipStatus;
  subtitles: SubtitleCue[];
  srtPath: string;
  createdAt: string;
}

export interface AiSignalBreakdown {
  chat: number;
  audio: number;
  visual: number;
  transcript: number;
  whisperAvailable: boolean;
  reasons: string[];
  headline?: string;
  tags?: string[];
  summary?: string;
}

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

export interface AiWeights {
  chat: number;
  audio: number;
  visual: number;
  transcript: number;
}

export interface AiHighlightItem {
  id: number;
  status: AiHighlightStatus;
  score: number;
  pinnedClipId: number | null;
  clipFilename?: string;
  clipDurationSec?: number;
  transcript: string;
  signals: AiSignalBreakdown;
  exportPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VodItem {
  id: number;
  filePath: string;
  filename: string;
  sourceType: VodSourceType;
  durationSec: number;
  status: VodScanStatus;
  sceneTimestamps: number[];
  audioPeaks: number[];
  error?: string;
  createdAt: string;
}

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
  whisperModel: WhisperModelId;
  aiDetectionMode: AiDetectionMode;
  aiVisualFocus: AiVisualFocus;
  aiSensitivity: AiSensitivity;
  aiMaxClipSec: number;
  brandWatermark: string;
  offAirFacecam: OffAirFacecamConfig;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureRuntimeDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  initSchema(db);
  return db;
}

function initSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restream_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('twitch', 'youtube', 'kick', 'custom')),
      rtmp_url TEXT NOT NULL,
      stream_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      twitch_downscale_1080p60 INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vod_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('drop', 'replay')),
      duration_sec REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'scanning', 'ready', 'error')),
      scene_timestamps_json TEXT NOT NULL DEFAULT '[]',
      audio_peaks_json TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS timeline_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp_ms INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('obs', 'hotkey', 'ai')),
      label TEXT NOT NULL,
      scene_name TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS obs_scene_presets (
      scene_name TEXT PRIMARY KEY,
      webcam_source TEXT NOT NULL DEFAULT '',
      webcam_rect_json TEXT NOT NULL DEFAULT 'null',
      layout_mode TEXT NOT NULL DEFAULT 'fullscreen_gameplay' CHECK(layout_mode IN ('split_2box', 'fullscreen_gameplay', 'fullscreen_cam')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pinned_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      trigger_source TEXT NOT NULL CHECK(trigger_source IN ('obs', 'hotkey', 'ai')),
      trigger_label TEXT NOT NULL DEFAULT '',
      duration_sec REAL NOT NULL DEFAULT 0,
      crop_preset_json TEXT NOT NULL DEFAULT 'null',
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'dismissed')),
      subtitles_json TEXT NOT NULL DEFAULT '[]',
      srt_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'auto_exported', 'dismissed')),
      score REAL NOT NULL DEFAULT 0,
      pinned_clip_id INTEGER,
      transcript TEXT NOT NULL DEFAULT '',
      signals_json TEXT NOT NULL DEFAULT '{}',
      export_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_weights (
      signal TEXT PRIMARY KEY,
      weight REAL NOT NULL
    );
  `);

  const clipCols = database
    .prepare('PRAGMA table_info(pinned_clips)')
    .all() as unknown as Array<{ name: string }>;
  const colNames = new Set(clipCols.map((c) => c.name));
  if (!colNames.has('status')) {
    database.exec("ALTER TABLE pinned_clips ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
  }
  if (!colNames.has('subtitles_json')) {
    database.exec("ALTER TABLE pinned_clips ADD COLUMN subtitles_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!colNames.has('srt_path')) {
    database.exec("ALTER TABLE pinned_clips ADD COLUMN srt_path TEXT NOT NULL DEFAULT ''");
  }

  const defaultWeights: Array<[string, number]> = [
    ['chat', 1.0],
    ['audio', 1.0],
    ['visual', 1.0],
    ['transcript', 1.2],
  ];
  const insertWeight = database.prepare('INSERT OR IGNORE INTO ai_weights (signal, weight) VALUES (?, ?)');
  for (const [sig, w] of defaultWeights) {
    insertWeight.run(sig, w);
  }

  const defaults: Record<string, string> = {
    bufferMinutes: '30',
    maxBufferGb: '25',
    ramDiskEnabled: 'false',
    ramDiskPath: '',
    dvrStorageDir: '',
    pinnedClipsDir: '',
    appMode: 'onair',
    offAirMode: 'ddagrab',
    dshowVideoDevice: '',
    dshowAudioDevice: '',
    webcamDevice: '',
    obsWsUrl: 'ws://127.0.0.1:4455',
    obsWsPassword: '',
    replayWatchDir: '',
    audioT1Device: '',
    audioT2Device: '',
    audioT3Device: '',
    whisperModel: 'base.en',
    aiDetectionMode: 'audio_visual',
    aiVisualFocus: 'balanced',
    aiSensitivity: 'balanced',
    aiMaxClipSec: '180',
    brandWatermark: '@ComboCut',
    offAirFacecam: JSON.stringify(DEFAULT_OFF_AIR_FACECAM),
  };

  const insert = database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v);
  }
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as unknown as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const parsedMinutes = Number.parseInt(map.get('bufferMinutes') ?? '30', 10);
  const parsedMaxGb = Number.parseInt(map.get('maxBufferGb') ?? '25', 10);
  const rawMode = map.get('offAirMode');
  const rawAppMode = map.get('appMode');
  const rawWhisperModel = map.get('whisperModel');
  const whisperModel: WhisperModelId =
    rawWhisperModel === 'small' || rawWhisperModel === 'large-v3-turbo' ? rawWhisperModel : 'base.en';
  const rawAiMode = map.get('aiDetectionMode');
  const aiDetectionMode: AiDetectionMode =
    rawAiMode === 'audio_only' || rawAiMode === 'visual_only' || rawAiMode === 'off'
      ? rawAiMode
      : 'audio_visual';
  const rawVisualFocus = map.get('aiVisualFocus');
  const aiVisualFocus: AiVisualFocus =
    rawVisualFocus === 'clutch_heavy' || rawVisualFocus === 'funny_reactions'
      ? rawVisualFocus
      : 'balanced';
  const rawSensitivity = map.get('aiSensitivity');
  const aiSensitivity: AiSensitivity =
    rawSensitivity === 'high_recall' || rawSensitivity === 'strict'
      ? rawSensitivity
      : 'balanced';
  const parsedMaxClipSec = Number.parseInt(map.get('aiMaxClipSec') ?? '180', 10);
  const aiMaxClipSec = Number.isFinite(parsedMaxClipSec)
    ? Math.min(180, Math.max(30, parsedMaxClipSec))
    : 180;
  return {
    bufferMinutes: Number.isFinite(parsedMinutes) ? Math.min(240, Math.max(1, parsedMinutes)) : 30,
    maxBufferGb: Number.isFinite(parsedMaxGb) ? Math.min(500, Math.max(2, parsedMaxGb)) : 25,
    ramDiskEnabled: map.get('ramDiskEnabled') === 'true',
    ramDiskPath: map.get('ramDiskPath') ?? '',
    dvrStorageDir: map.get('dvrStorageDir') ?? '',
    pinnedClipsDir: map.get('pinnedClipsDir') ?? '',
    appMode: rawAppMode === 'offair' ? 'offair' : 'onair',
    offAirMode: rawMode === 'dshow' ? 'dshow' : 'ddagrab',
    dshowVideoDevice: map.get('dshowVideoDevice') ?? '',
    dshowAudioDevice: map.get('dshowAudioDevice') ?? '',
    webcamDevice: map.get('webcamDevice') ?? '',
    obsWsUrl: map.get('obsWsUrl') ?? 'ws://127.0.0.1:4455',
    obsWsPassword: map.get('obsWsPassword') ?? '',
    replayWatchDir: map.get('replayWatchDir') ?? '',
    audioT1Device: map.get('audioT1Device') ?? '',
    audioT2Device: map.get('audioT2Device') ?? '',
    audioT3Device: map.get('audioT3Device') ?? '',
    whisperModel,
    aiDetectionMode,
    aiVisualFocus,
    aiSensitivity,
    aiMaxClipSec,
    brandWatermark: map.get('brandWatermark') ?? '@ComboCut',
    offAirFacecam: sanitizeFacecamConfig(
      safeParseJson(map.get('offAirFacecam') ?? '', DEFAULT_OFF_AIR_FACECAM),
    ),
  };
}

function sanitizeFacecamConfig(raw: Partial<OffAirFacecamConfig> | null | undefined): OffAirFacecamConfig {
  const shape: FacecamShape =
    raw?.shape === 'rectangle' || raw?.shape === 'circle' ? raw.shape : 'rounded';
  return {
    x: clampNum(raw?.x, 0, 0.9, DEFAULT_OFF_AIR_FACECAM.x),
    y: clampNum(raw?.y, 0, 0.9, DEFAULT_OFF_AIR_FACECAM.y),
    widthPct: clampNum(raw?.widthPct, 15, 50, DEFAULT_OFF_AIR_FACECAM.widthPct),
    zoom: clampNum(raw?.zoom, 1.0, 2.0, DEFAULT_OFF_AIR_FACECAM.zoom),
    mirror: Boolean(raw?.mirror ?? DEFAULT_OFF_AIR_FACECAM.mirror),
    shape,
    border: raw?.border !== undefined ? Boolean(raw.border) : DEFAULT_OFF_AIR_FACECAM.border,
  };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (patch.bufferMinutes !== undefined) {
    const clamped = Math.min(240, Math.max(1, Math.round(patch.bufferMinutes)));
    upsert.run('bufferMinutes', String(clamped));
  }
  if (patch.maxBufferGb !== undefined) {
    const clampedGb = Math.min(500, Math.max(2, Math.round(patch.maxBufferGb)));
    upsert.run('maxBufferGb', String(clampedGb));
  }
  if (patch.appMode !== undefined) {
    upsert.run('appMode', patch.appMode === 'offair' ? 'offair' : 'onair');
  }
  if (patch.ramDiskEnabled !== undefined) {
    upsert.run('ramDiskEnabled', patch.ramDiskEnabled ? 'true' : 'false');
  }
  if (patch.offAirMode !== undefined) {
    upsert.run('offAirMode', patch.offAirMode === 'dshow' ? 'dshow' : 'ddagrab');
  }
  if (patch.whisperModel !== undefined) {
    const valid =
      patch.whisperModel === 'small' || patch.whisperModel === 'large-v3-turbo'
        ? patch.whisperModel
        : 'base.en';
    upsert.run('whisperModel', valid);
  }
  if (patch.aiDetectionMode !== undefined) {
    const valid =
      patch.aiDetectionMode === 'audio_only' ||
      patch.aiDetectionMode === 'visual_only' ||
      patch.aiDetectionMode === 'off'
        ? patch.aiDetectionMode
        : 'audio_visual';
    upsert.run('aiDetectionMode', valid);
  }
  if (patch.aiVisualFocus !== undefined) {
    const valid =
      patch.aiVisualFocus === 'clutch_heavy' || patch.aiVisualFocus === 'funny_reactions'
        ? patch.aiVisualFocus
        : 'balanced';
    upsert.run('aiVisualFocus', valid);
  }
  if (patch.aiSensitivity !== undefined) {
    const valid =
      patch.aiSensitivity === 'high_recall' || patch.aiSensitivity === 'strict'
        ? patch.aiSensitivity
        : 'balanced';
    upsert.run('aiSensitivity', valid);
  }
  if (patch.aiMaxClipSec !== undefined) {
    const clamped = Math.min(180, Math.max(30, Math.round(patch.aiMaxClipSec)));
    upsert.run('aiMaxClipSec', String(clamped));
  }
  if (patch.offAirFacecam !== undefined) {
    const current = getSettings().offAirFacecam;
    const merged = sanitizeFacecamConfig({ ...current, ...patch.offAirFacecam });
    upsert.run('offAirFacecam', JSON.stringify(merged));
  }
  const stringKeys = [
    'ramDiskPath',
    'dvrStorageDir',
    'pinnedClipsDir',
    'dshowVideoDevice',
    'dshowAudioDevice',
    'webcamDevice',
    'obsWsUrl',
    'obsWsPassword',
    'replayWatchDir',
    'audioT1Device',
    'audioT2Device',
    'audioT3Device',
    'brandWatermark',
  ] as const;
  for (const key of stringKeys) {
    if (patch[key] !== undefined) {
      upsert.run(key, String(patch[key]).trim());
    }
  }
  return getSettings();
}

interface TargetRow {
  id: number;
  name: string;
  platform: RestreamPlatform;
  rtmp_url: string;
  stream_key: string;
  enabled: number;
  twitch_downscale_1080p60: number;
  created_at: string;
}

function mapTarget(row: TargetRow): RestreamTarget {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    rtmpUrl: row.rtmp_url,
    streamKey: row.stream_key,
    enabled: row.enabled === 1,
    twitchDownscale1080p60: row.twitch_downscale_1080p60 === 1,
    createdAt: row.created_at,
  };
}

export function listRestreamTargets(): RestreamTarget[] {
  const rows = getDb().prepare('SELECT * FROM restream_targets ORDER BY id ASC').all() as unknown as TargetRow[];
  return rows.map(mapTarget);
}

export function getRestreamTarget(id: number): RestreamTarget | null {
  const row = getDb().prepare('SELECT * FROM restream_targets WHERE id = ?').get(id) as unknown as TargetRow | undefined;
  return row ? mapTarget(row) : null;
}

export function createRestreamTarget(input: {
  name: string;
  platform: RestreamPlatform;
  rtmpUrl: string;
  streamKey: string;
  enabled?: boolean;
  twitchDownscale1080p60?: boolean;
}): RestreamTarget {
  const info = getDb()
    .prepare(
      `INSERT INTO restream_targets (name, platform, rtmp_url, stream_key, enabled, twitch_downscale_1080p60)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.platform,
      input.rtmpUrl.trim(),
      input.streamKey.trim(),
      input.enabled === false ? 0 : 1,
      input.twitchDownscale1080p60 ? 1 : 0,
    );
  return getRestreamTarget(Number(info.lastInsertRowid))!;
}

export function updateRestreamTarget(
  id: number,
  patch: Partial<Omit<RestreamTarget, 'id' | 'createdAt'>>,
): RestreamTarget | null {
  const existing = getRestreamTarget(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE restream_targets
       SET name = ?, platform = ?, rtmp_url = ?, stream_key = ?, enabled = ?, twitch_downscale_1080p60 = ?
       WHERE id = ?`,
    )
    .run(
      patch.name !== undefined ? patch.name.trim() : existing.name,
      patch.platform ?? existing.platform,
      patch.rtmpUrl !== undefined ? patch.rtmpUrl.trim() : existing.rtmpUrl,
      patch.streamKey !== undefined ? patch.streamKey.trim() : existing.streamKey,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      patch.twitchDownscale1080p60 !== undefined
        ? patch.twitchDownscale1080p60
          ? 1
          : 0
        : existing.twitchDownscale1080p60
          ? 1
          : 0,
      id,
    );
  return getRestreamTarget(id);
}

export function deleteRestreamTarget(id: number): boolean {
  const info = getDb().prepare('DELETE FROM restream_targets WHERE id = ?').run(id);
  return info.changes > 0;
}

interface VodRow {
  id: number;
  file_path: string;
  filename: string;
  source_type: VodSourceType;
  duration_sec: number;
  status: VodScanStatus;
  scene_timestamps_json: string;
  audio_peaks_json: string;
  error: string;
  created_at: string;
}

function mapVod(row: VodRow): VodItem {
  let sceneTimestamps: number[] = [];
  let audioPeaks: number[] = [];
  try {
    sceneTimestamps = JSON.parse(row.scene_timestamps_json) as number[];
  } catch {
    sceneTimestamps = [];
  }
  try {
    audioPeaks = JSON.parse(row.audio_peaks_json) as number[];
  } catch {
    audioPeaks = [];
  }
  return {
    id: row.id,
    filePath: row.file_path,
    filename: row.filename,
    sourceType: row.source_type,
    durationSec: row.duration_sec,
    status: row.status,
    sceneTimestamps,
    audioPeaks,
    error: row.error || undefined,
    createdAt: row.created_at,
  };
}

export function listVodItems(): VodItem[] {
  const rows = getDb().prepare('SELECT * FROM vod_items ORDER BY id DESC').all() as unknown as VodRow[];
  return rows.map(mapVod);
}

export function getVodItem(id: number): VodItem | null {
  const row = getDb().prepare('SELECT * FROM vod_items WHERE id = ?').get(id) as unknown as VodRow | undefined;
  return row ? mapVod(row) : null;
}

export function getVodItemByPath(filePath: string): VodItem | null {
  const row = getDb().prepare('SELECT * FROM vod_items WHERE file_path = ?').get(filePath) as unknown as VodRow | undefined;
  return row ? mapVod(row) : null;
}

export function createVodItem(input: {
  filePath: string;
  filename: string;
  sourceType: VodSourceType;
}): VodItem {
  const existing = getVodItemByPath(input.filePath);
  if (existing) return existing;
  const info = getDb()
    .prepare(
      `INSERT INTO vod_items (file_path, filename, source_type, status)
       VALUES (?, ?, ?, 'queued')`,
    )
    .run(input.filePath, input.filename, input.sourceType);
  return getVodItem(Number(info.lastInsertRowid))!;
}

export function updateVodItem(
  id: number,
  patch: Partial<{
    durationSec: number;
    status: VodScanStatus;
    sceneTimestamps: number[];
    audioPeaks: number[];
    error: string;
  }>,
): VodItem | null {
  const existing = getVodItem(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE vod_items
       SET duration_sec = ?, status = ?, scene_timestamps_json = ?, audio_peaks_json = ?, error = ?
       WHERE id = ?`,
    )
    .run(
      patch.durationSec ?? existing.durationSec,
      patch.status ?? existing.status,
      JSON.stringify(patch.sceneTimestamps ?? existing.sceneTimestamps),
      JSON.stringify(patch.audioPeaks ?? existing.audioPeaks),
      patch.error ?? existing.error ?? '',
      id,
    );
  return getVodItem(id);
}

export function deleteVodItem(id: number): boolean {
  const info = getDb().prepare('DELETE FROM vod_items WHERE id = ?').run(id);
  return info.changes > 0;
}

// --- Timeline Markers ---
export function createTimelineMarker(input: {
  timestampMs?: number;
  source: MarkerSource;
  label: string;
  sceneName?: string;
  metadata?: Record<string, unknown>;
}): TimelineMarker {
  const ts = input.timestampMs ?? Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO timeline_markers (timestamp_ms, source, label, scene_name, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ts, input.source, input.label, input.sceneName ?? '', JSON.stringify(input.metadata ?? {}));
  return listTimelineMarkers(1).find((m) => m.id === Number(info.lastInsertRowid))!;
}

export function listTimelineMarkers(limit = 100): TimelineMarker[] {
  const rows = getDb()
    .prepare('SELECT * FROM timeline_markers ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as Array<{
    id: number;
    timestamp_ms: number;
    source: MarkerSource;
    label: string;
    scene_name: string;
    metadata_json: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    timestampMs: r.timestamp_ms,
    source: r.source,
    label: r.label,
    sceneName: r.scene_name,
    metadata: safeParseJson(r.metadata_json, {}),
    createdAt: r.created_at,
  }));
}

// --- OBS Scene Presets ---
export function upsertObsScenePreset(input: {
  sceneName: string;
  webcamSource: string;
  webcamRect: NormalizedRect | null;
  layoutMode: 'split_2box' | 'fullscreen_gameplay' | 'fullscreen_cam';
}): ObsScenePreset {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO obs_scene_presets (scene_name, webcam_source, webcam_rect_json, layout_mode, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(input.sceneName, input.webcamSource, JSON.stringify(input.webcamRect), input.layoutMode);
  return getObsScenePreset(input.sceneName)!;
}

export function getObsScenePreset(sceneName: string): ObsScenePreset | null {
  const r = getDb()
    .prepare('SELECT * FROM obs_scene_presets WHERE scene_name = ?')
    .get(sceneName) as unknown as
    | {
        scene_name: string;
        webcam_source: string;
        webcam_rect_json: string;
        layout_mode: 'split_2box' | 'fullscreen_gameplay' | 'fullscreen_cam';
        updated_at: string;
      }
    | undefined;
  if (!r) return null;
  return {
    sceneName: r.scene_name,
    webcamSource: r.webcam_source,
    webcamRect: safeParseJson(r.webcam_rect_json, null),
    layoutMode: r.layout_mode,
    updatedAt: r.updated_at,
  };
}

export function listObsScenePresets(): ObsScenePreset[] {
  const rows = getDb()
    .prepare('SELECT * FROM obs_scene_presets ORDER BY updated_at DESC')
    .all() as unknown as Array<{
    scene_name: string;
    webcam_source: string;
    webcam_rect_json: string;
    layout_mode: 'split_2box' | 'fullscreen_gameplay' | 'fullscreen_cam';
    updated_at: string;
  }>;
  return rows.map((r) => ({
    sceneName: r.scene_name,
    webcamSource: r.webcam_source,
    webcamRect: safeParseJson(r.webcam_rect_json, null),
    layoutMode: r.layout_mode,
    updatedAt: r.updated_at,
  }));
}

// --- Pinned Clips ---
export function createPinnedClip(input: {
  filePath: string;
  filename: string;
  triggerSource: MarkerSource;
  triggerLabel: string;
  durationSec: number;
  cropPreset: ObsScenePreset | null;
  status?: ClipStatus;
}): PinnedClip {
  const info = getDb()
    .prepare(
      `INSERT INTO pinned_clips (file_path, filename, trigger_source, trigger_label, duration_sec, crop_preset_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.filePath,
      input.filename,
      input.triggerSource,
      input.triggerLabel,
      input.durationSec,
      JSON.stringify(input.cropPreset),
      input.status ?? 'approved',
    );
  return getPinnedClip(Number(info.lastInsertRowid))!;
}

interface RawPinnedClipRow {
  id: number;
  file_path: string;
  filename: string;
  trigger_source: MarkerSource;
  trigger_label: string;
  duration_sec: number;
  crop_preset_json: string;
  status?: ClipStatus;
  subtitles_json?: string;
  srt_path?: string;
  created_at: string;
}

function mapPinnedClipRow(r: RawPinnedClipRow): PinnedClip {
  return {
    id: r.id,
    filePath: r.file_path,
    filename: r.filename,
    triggerSource: r.trigger_source,
    triggerLabel: r.trigger_label,
    durationSec: r.duration_sec,
    cropPreset: safeParseJson(r.crop_preset_json, null),
    status: r.status === 'pending' || r.status === 'dismissed' ? r.status : 'approved',
    subtitles: safeParseJson<SubtitleCue[]>(r.subtitles_json ?? '[]', []),
    srtPath: r.srt_path ?? '',
    createdAt: r.created_at,
  };
}

export function getPinnedClip(id: number): PinnedClip | null {
  const r = getDb().prepare('SELECT * FROM pinned_clips WHERE id = ?').get(id) as unknown as
    | RawPinnedClipRow
    | undefined;
  if (!r) return null;
  return mapPinnedClipRow(r);
}

export function listPinnedClips(): PinnedClip[] {
  const rows = getDb()
    .prepare("SELECT * FROM pinned_clips WHERE status = 'approved' ORDER BY id DESC")
    .all() as unknown as RawPinnedClipRow[];
  return rows.map(mapPinnedClipRow);
}

export function updatePinnedClipStatus(id: number, status: ClipStatus): PinnedClip | null {
  getDb().prepare('UPDATE pinned_clips SET status = ? WHERE id = ?').run(status, id);
  return getPinnedClip(id);
}

export function updatePinnedClipSubtitles(
  id: number,
  subtitles: SubtitleCue[],
  srtPath: string,
): PinnedClip | null {
  getDb()
    .prepare('UPDATE pinned_clips SET subtitles_json = ?, srt_path = ? WHERE id = ?')
    .run(JSON.stringify(subtitles), srtPath, id);
  return getPinnedClip(id);
}

export function updatePinnedClipPaths(id: number, filePath: string, srtPath: string): PinnedClip | null {
  getDb()
    .prepare('UPDATE pinned_clips SET file_path = ?, srt_path = ? WHERE id = ?')
    .run(filePath, srtPath, id);
  return getPinnedClip(id);
}

export function listAllNonDismissedClips(): PinnedClip[] {
  const rows = getDb()
    .prepare("SELECT * FROM pinned_clips WHERE status != 'dismissed' ORDER BY id DESC")
    .all() as unknown as RawPinnedClipRow[];
  return rows.map(mapPinnedClipRow);
}

export function deletePinnedClip(id: number): boolean {
  const info = getDb().prepare('DELETE FROM pinned_clips WHERE id = ?').run(id);
  return info.changes > 0;
}

// --- AI Highlights & Self-Tuning Weights ---
export function getAiWeights(): AiWeights {
  const rows = getDb().prepare('SELECT signal, weight FROM ai_weights').all() as unknown as Array<{
    signal: string;
    weight: number;
  }>;
  const map = new Map(rows.map((r) => [r.signal, r.weight]));
  return {
    chat: map.get('chat') ?? 1.0,
    audio: map.get('audio') ?? 1.0,
    visual: map.get('visual') ?? 1.0,
    transcript: map.get('transcript') ?? 1.2,
  };
}

export function adjustAiWeights(signals: AiSignalBreakdown, delta: number): AiWeights {
  const current = getAiWeights();
  const upsert = getDb().prepare('INSERT OR REPLACE INTO ai_weights (signal, weight) VALUES (?, ?)');
  const keys: Array<keyof AiWeights> = ['chat', 'audio', 'visual', 'transcript'];
  for (const key of keys) {
    const contribution = signals[key];
    if (contribution > 0.15) {
      const next = Math.min(3.0, Math.max(0.1, Math.round((current[key] + delta * contribution) * 1000) / 1000));
      upsert.run(key, next);
    }
  }
  return getAiWeights();
}

export function createAiHighlight(input: {
  score: number;
  pinnedClipId: number | null;
  transcript: string;
  signals: AiSignalBreakdown;
}): AiHighlightItem {
  const info = getDb()
    .prepare(
      `INSERT INTO ai_highlights (status, score, pinned_clip_id, transcript, signals_json)
       VALUES ('pending', ?, ?, ?, ?)`,
    )
    .run(input.score, input.pinnedClipId, input.transcript, JSON.stringify(input.signals));
  return getAiHighlight(Number(info.lastInsertRowid))!;
}

export function getAiHighlight(id: number): AiHighlightItem | null {
  const r = getDb()
    .prepare(
      `SELECT ah.*, pc.filename AS clip_filename, pc.duration_sec AS clip_duration_sec
       FROM ai_highlights ah
       LEFT JOIN pinned_clips pc ON pc.id = ah.pinned_clip_id
       WHERE ah.id = ?`,
    )
    .get(id) as unknown as
    | {
        id: number;
        status: AiHighlightStatus;
        score: number;
        pinned_clip_id: number | null;
        clip_filename: string | null;
        clip_duration_sec: number | null;
        transcript: string;
        signals_json: string;
        export_path: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    score: r.score,
    pinnedClipId: r.pinned_clip_id,
    clipFilename: r.clip_filename ?? undefined,
    clipDurationSec: r.clip_duration_sec ?? undefined,
    transcript: r.transcript,
    signals: safeParseJson(r.signals_json, {
      chat: 0,
      audio: 0,
      visual: 0,
      transcript: 0,
      whisperAvailable: false,
      reasons: [],
    }),
    exportPath: r.export_path || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listAiHighlights(): AiHighlightItem[] {
  const rows = getDb()
    .prepare(
      `SELECT ah.*, pc.filename AS clip_filename, pc.duration_sec AS clip_duration_sec
       FROM ai_highlights ah
       LEFT JOIN pinned_clips pc ON pc.id = ah.pinned_clip_id
       ORDER BY ah.id DESC LIMIT 100`,
    )
    .all() as unknown as Array<{
    id: number;
    status: AiHighlightStatus;
    score: number;
    pinned_clip_id: number | null;
    clip_filename: string | null;
    clip_duration_sec: number | null;
    transcript: string;
    signals_json: string;
    export_path: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    score: r.score,
    pinnedClipId: r.pinned_clip_id,
    clipFilename: r.clip_filename ?? undefined,
    clipDurationSec: r.clip_duration_sec ?? undefined,
    transcript: r.transcript,
    signals: safeParseJson(r.signals_json, {
      chat: 0,
      audio: 0,
      visual: 0,
      transcript: 0,
      whisperAvailable: false,
      reasons: [],
    }),
    exportPath: r.export_path || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function updateAiHighlightStatus(
  id: number,
  status: AiHighlightStatus,
  exportPath?: string,
): AiHighlightItem | null {
  const existing = getAiHighlight(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE ai_highlights
       SET status = ?, export_path = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(status, exportPath ?? existing.exportPath ?? '', id);
  return getAiHighlight(id);
}

export function updateAiHighlightDetails(
  id: number,
  patch: { transcript?: string; score?: number; signals?: AiSignalBreakdown },
): AiHighlightItem | null {
  const existing = getAiHighlight(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE ai_highlights
       SET transcript = ?, score = ?, signals_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      patch.transcript ?? existing.transcript,
      patch.score ?? existing.score,
      JSON.stringify(patch.signals ?? existing.signals),
      id,
    );
  return getAiHighlight(id);
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
