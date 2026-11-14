import fs from 'node:fs';
import path from 'node:path';

const resourcesOverride = process.env.COMBOCUT_RESOURCES_PATH || process.env.COMBOCUT_RESOURCES_DIR;
const userDataOverride = process.env.COMBOCUT_USER_DATA || process.env.COMBOCUT_USER_DATA_DIR;

export const ROOT_DIR = resourcesOverride
  ? path.resolve(resourcesOverride)
  : path.resolve(import.meta.dirname, '..', '..', '..');
export const RUNTIME_DIR = userDataOverride
  ? path.resolve(userDataOverride)
  : ROOT_DIR;
export const BIN_DIR = path.join(ROOT_DIR, 'bin');
export const CLIENT_DIST_DIR = process.env.COMBOCUT_CLIENT_DIR
  ? path.resolve(process.env.COMBOCUT_CLIENT_DIR)
  : path.join(ROOT_DIR, 'client', 'dist');
export const DEFAULT_BUFFER_DIR = path.join(RUNTIME_DIR, 'buffer');
export const PINNED_DIR = path.join(RUNTIME_DIR, 'pinned');
export const EXPORTS_DIR = process.env.COMBOCUT_VIDEOS_DIR
  ? path.join(path.resolve(process.env.COMBOCUT_VIDEOS_DIR), 'ComboCut')
  : process.env.COMBOCUT_EXPORTS_DIR
    ? path.resolve(process.env.COMBOCUT_EXPORTS_DIR)
    : path.join(RUNTIME_DIR, 'exports');
export const DATA_DIR = path.join(RUNTIME_DIR, 'data');

export const BINS = {
  mediamtx: path.join(BIN_DIR, 'mediamtx.exe'),
  ffmpeg: path.join(BIN_DIR, 'ffmpeg.exe'),
  ffprobe: path.join(BIN_DIR, 'ffprobe.exe'),
  whisper: path.join(BIN_DIR, 'whisper-cli.exe'),
  wasapiCapture: path.join(BIN_DIR, 'wasapi-capture.exe'),
};

export const DB_PATH = path.join(DATA_DIR, 'studio.db');
export const MEDIAMTX_CONFIG_PATH = path.join(DATA_DIR, 'mediamtx.yml');

let configuredDvrRoot: string | null = null;
let configuredPinnedDir: string | null = null;

export function setCustomDvrDir(dir?: string | null): void {
  const trimmed = dir?.trim() ?? '';
  configuredDvrRoot = trimmed.length > 0 ? path.resolve(trimmed) : null;
}

export function setCustomPinnedDir(dir?: string | null): void {
  const trimmed = dir?.trim() ?? '';
  configuredPinnedDir = trimmed.length > 0 ? path.resolve(trimmed) : null;
}

export function resolvePinnedDir(): string {
  if (configuredPinnedDir) {
    return configuredPinnedDir;
  }
  return PINNED_DIR;
}

export function resolveExportsDir(): string {
  if (configuredDvrRoot) {
    return path.join(configuredDvrRoot, 'exports');
  }
  return EXPORTS_DIR;
}

export function ensureRuntimeDirs(bufferDir = resolveBufferDir()): void {
  for (const dir of [bufferDir, resolvePinnedDir(), resolveExportsDir(), DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveBufferDir(ramDiskPath?: string | null): string {
  if (ramDiskPath && ramDiskPath.trim().length > 0) {
    return path.resolve(ramDiskPath.trim());
  }
  if (configuredDvrRoot) {
    return path.join(configuredDvrRoot, 'buffer');
  }
  return DEFAULT_BUFFER_DIR;
}

export function getDriveFreeBytes(targetDir: string): number | null {
  try {
    let probe = path.resolve(targetDir);
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const stats = fs.statfsSync(probe);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}
