import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { BINS, ensureRuntimeDirs, getDriveFreeBytes, resolveBufferDir } from '../config/paths.js';
import { getSettings } from '../db/database.js';
import { gracefulStopFfmpeg, setBelowNormalPriority } from '../utils/process.js';

export interface HlsDvrStatus {
  running: boolean;
  pid: number | null;
  bufferDir: string;
  ramDiskActive: boolean;
  bufferMinutes: number;
  segmentCount: number;
  totalBytes: number;
  freeBytes: number | null;
  playlistUrl: string;
  error?: string;
}

export class HlsDvrManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private shouldRun = false;
  private lastError: string | undefined;

  private getEffectiveBufferDir(): { bufferDir: string; ramDiskActive: boolean; bufferMinutes: number } {
    const settings = getSettings();
    const ramDiskActive = settings.ramDiskEnabled && settings.ramDiskPath.trim().length > 0;
    const bufferDir = resolveBufferDir(ramDiskActive ? settings.ramDiskPath : null);
    return { bufferDir, ramDiskActive, bufferMinutes: settings.bufferMinutes };
  }

  start(): void {
    this.shouldRun = true;
    if (this.child) return;
    this.spawnWorker();
  }

  private spawnWorker(): void {
    if (!this.shouldRun || this.child) return;

    if (!fs.existsSync(BINS.ffmpeg)) {
      this.lastError = 'ffmpeg.exe not found in /bin';
      return;
    }

    const { bufferDir, ramDiskActive, bufferMinutes } = this.getEffectiveBufferDir();
    try {
      ensureRuntimeDirs(bufferDir);
    } catch (err) {
      this.lastError = `Cannot access buffer directory ${bufferDir}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[HLS-DVR] ${this.lastError}`);
      return;
    }

    // 2s segments -> 30 segments per minute
    const hlsListSize = Math.max(15, bufferMinutes * 30);
    const playlistPath = path.join(bufferDir, 'live.m3u8');
    const segmentPattern = path.join(bufferDir, 'seg_%06d.ts');

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+genpts',
      '-i', 'rtmp://127.0.0.1:1935/live/program_out',
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', String(hlsListSize),
      '-hls_delete_threshold', '4',
      '-hls_flags', 'append_list+delete_segments+omit_endlist+independent_segments+temp_file',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];

    this.lastError = undefined;
    const proc = spawn(BINS.ffmpeg, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });

    setBelowNormalPriority(proc);
    this.child = proc;

    proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) {
        this.lastError = msg;
        console.warn(`[HLS-DVR] ${msg}`);
      }
    });

    proc.on('exit', (code) => {
      this.child = null;
      console.log(`[HLS-DVR] Worker exited (code=${code})`);
      this.emit('status', this.getStatus());

      if (this.shouldRun) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.spawnWorker(), 2000);
      }
    });

    if (!this.statsTimer) {
      this.statsTimer = setInterval(() => {
        this.pruneOrphanedSegments();
        this.emit('status', this.getStatus());
      }, 2000);
    }

    console.log(
      `[HLS-DVR] Recording 2s HLS ring buffer in ${bufferDir} (${ramDiskActive ? 'RAM-disk' : 'disk'}, ${bufferMinutes}m / ${hlsListSize} segs)`,
    );
    this.emit('status', this.getStatus());
  }

  private pruneOrphanedSegments(): void {
    const { bufferDir, bufferMinutes } = this.getEffectiveBufferDir();
    if (!fs.existsSync(bufferDir)) return;
    const maxSegments = Math.max(15, bufferMinutes * 30) + 10;
    try {
      const segments = fs
        .readdirSync(bufferDir)
        .filter((f) => /^seg_\d+\.ts$/i.test(f))
        .sort();
      if (segments.length > maxSegments) {
        const toDelete = segments.slice(0, segments.length - maxSegments);
        for (const file of toDelete) {
          fs.rmSync(path.join(bufferDir, file), { force: true });
        }
      }
    } catch {
      // ignore transient filesystem errors
    }
  }

  getStatus(): HlsDvrStatus {
    const { bufferDir, ramDiskActive, bufferMinutes } = this.getEffectiveBufferDir();
    let segmentCount = 0;
    let totalBytes = 0;

    if (fs.existsSync(bufferDir)) {
      try {
        for (const name of fs.readdirSync(bufferDir)) {
          if (/^seg_\d+\.ts$/i.test(name)) {
            segmentCount += 1;
            const stat = fs.statSync(path.join(bufferDir, name));
            totalBytes += stat.size;
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      running: this.child !== null,
      pid: this.child?.pid ?? null,
      bufferDir,
      ramDiskActive,
      bufferMinutes,
      segmentCount,
      totalBytes,
      freeBytes: getDriveFreeBytes(bufferDir),
      playlistUrl: '/buffer/live.m3u8',
      error: this.lastError,
    };
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.child) {
      const proc = this.child;
      this.child = null;
      await gracefulStopFfmpeg(proc);
    }
    this.emit('status', this.getStatus());
  }

  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }
}
