import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { BINS } from '../config/paths.js';
import {
  createVodItem,
  deleteVodItem,
  getSettings,
  listVodItems,
  updateVodItem,
  type VodItem,
  type VodSourceType,
} from '../db/database.js';
import { setBelowNormalPriority } from '../utils/process.js';

const SUPPORTED_EXTS = new Set(['.mp4', '.mkv', '.mov']);

export interface ReplayWatcherStatus {
  watching: boolean;
  watchDir: string;
  error?: string;
}

export class VodWatcherManager extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private watchDir = '';
  private lastError: string | undefined;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  startWatcher(dirOverride?: string): ReplayWatcherStatus {
    const settings = getSettings();
    const targetDir = (dirOverride ?? settings.replayWatchDir).trim();
    this.stopWatcher();

    if (!targetDir) {
      this.lastError = undefined;
      return this.getWatcherStatus();
    }

    if (!fs.existsSync(targetDir)) {
      this.lastError = `Replay watch directory does not exist: ${targetDir}`;
      this.emit('status', this.getWatcherStatus());
      return this.getWatcherStatus();
    }

    try {
      this.watchDir = path.resolve(targetDir);
      this.lastError = undefined;
      this.watcher = fs.watch(this.watchDir, (_eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) return;

        const fullPath = path.join(this.watchDir, filename);
        const prev = this.debounceTimers.get(fullPath);
        if (prev) clearTimeout(prev);

        this.debounceTimers.set(
          fullPath,
          setTimeout(() => {
            this.debounceTimers.delete(fullPath);
            if (fs.existsSync(fullPath)) {
              void this.scanFile(fullPath, 'replay');
            }
          }, 1500),
        );
      });

      this.watcher.on('error', (err) => {
        this.lastError = err.message;
        this.emit('status', this.getWatcherStatus());
      });

      console.log(`[VOD-Watcher] Watching replay folder: ${this.watchDir}`);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    this.emit('status', this.getWatcherStatus());
    return this.getWatcherStatus();
  }

  stopWatcher(): void {
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.watchDir = '';
    this.emit('status', this.getWatcherStatus());
  }

  async scanFile(filePath: string, sourceType: VodSourceType = 'drop'): Promise<VodItem> {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }

    const item = createVodItem({
      filePath: resolved,
      filename: path.basename(resolved),
      sourceType,
    });

    updateVodItem(item.id, { status: 'scanning', error: '' });
    this.emit('vodUpdated', listVodItems());

    try {
      const durationSec = await this.probeDuration(resolved);
      const { sceneTimestamps, audioPeaks } = await this.fastScanMedia(resolved);
      const updated = updateVodItem(item.id, {
        durationSec,
        status: 'ready',
        sceneTimestamps,
        audioPeaks,
      })!;
      this.emit('vodUpdated', listVodItems());
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = updateVodItem(item.id, {
        status: 'error',
        error: message,
      })!;
      this.emit('vodUpdated', listVodItems());
      return updated;
    }
  }

  private probeDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(BINS.ffprobe)) {
        reject(new Error('ffprobe.exe not found in /bin'));
        return;
      }
      execFile(
        BINS.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
        { windowsHide: true, timeout: 10000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          const parsed = Number.parseFloat(stdout.trim());
          resolve(Number.isFinite(parsed) ? parsed : 0);
        },
      );
    });
  }

  private fastScanMedia(filePath: string): Promise<{ sceneTimestamps: number[]; audioPeaks: number[] }> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(BINS.ffmpeg)) {
        reject(new Error('ffmpeg.exe not found in /bin'));
        return;
      }

      const args = [
        '-hide_banner',
        '-skip_frame', 'nokey',
        '-i', filePath,
        '-vf', 'scdet=threshold=12,showinfo',
        '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
        '-f', 'null',
        '-',
      ];

      const proc = spawn(BINS.ffmpeg, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      setBelowNormalPriority(proc);

      const sceneTimestamps: number[] = [];
      const audioPeaks: number[] = [];
      let currentPts = 0;

      proc.stdout?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf8').split(/\r?\n/);
        for (const line of lines) {
          const ptsMatch = line.match(/pts_time:([0-9.]+)/);
          if (ptsMatch) {
            currentPts = Number.parseFloat(ptsMatch[1]);
          }
          const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+)/);
          if (rmsMatch) {
            const db = Number.parseFloat(rmsMatch[1]);
            if (Number.isFinite(db) && db > -14) {
              const rounded = Math.round(currentPts * 10) / 10;
              if (audioPeaks.length === 0 || rounded - audioPeaks[audioPeaks.length - 1] >= 2) {
                audioPeaks.push(rounded);
              }
            }
          }
        }
      });

      let stderrTail = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderrTail = (stderrTail + text).slice(-2000);
        for (const line of text.split(/\r?\n/)) {
          const scMatch = line.match(/lavfi\.scd\.time:\s*([0-9.]+)/);
          if (scMatch) {
            const t = Math.round(Number.parseFloat(scMatch[1]) * 10) / 10;
            if (Number.isFinite(t)) sceneTimestamps.push(t);
          }
        }
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Fast-scan exited with code ${code}: ${stderrTail.trim()}`));
          return;
        }
        resolve({ sceneTimestamps, audioPeaks });
      });
    });
  }

  removeItem(id: number): boolean {
    const ok = deleteVodItem(id);
    if (ok) this.emit('vodUpdated', listVodItems());
    return ok;
  }

  listItems(): VodItem[] {
    return listVodItems();
  }

  getWatcherStatus(): ReplayWatcherStatus {
    return {
      watching: Boolean(this.watcher),
      watchDir: this.watchDir,
      error: this.lastError,
    };
  }
}
