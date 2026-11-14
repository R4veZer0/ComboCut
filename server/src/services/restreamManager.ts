import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { BINS } from '../config/paths.js';
import { getRestreamTarget, listRestreamTargets, type RestreamTarget } from '../db/database.js';
import { getCachedGpuEncoder, type VideoEncoder } from './gpuDetector.js';
import { gracefulStopFfmpeg, setBelowNormalPriority } from '../utils/process.js';

export type WorkerState = 'stopped' | 'starting' | 'live' | 'reconnecting' | 'error';

export interface RestreamWorkerStatus {
  targetId: number;
  state: WorkerState;
  pid: number | null;
  startedAt: string | null;
  reconnectCount: number;
  mode: 'copy' | 'twitch-1080p60';
  encoder: VideoEncoder | 'copy';
  lastError?: string;
}

interface WorkerEntry {
  targetId: number;
  child: ChildProcess | null;
  state: WorkerState;
  startedAt: string | null;
  reconnectCount: number;
  shouldRun: boolean;
  restartTimer: NodeJS.Timeout | null;
  mode: 'copy' | 'twitch-1080p60';
  encoder: VideoEncoder | 'copy';
  lastError?: string;
}

function buildDestinationUrl(rtmpUrl: string, streamKey: string): string {
  const base = rtmpUrl.trim().replace(/\/+$/, '');
  const key = streamKey.trim().replace(/^\/+/, '');
  return key ? `${base}/${key}` : base;
}

function buildEncoderArgs(encoder: VideoEncoder): string[] {
  const common = [
    '-vf', 'scale=1920:1080:flags=bilinear,fps=60',
    '-pix_fmt', 'yuv420p',
    '-g', '120',
    '-keyint_min', '120',
    '-b:v', '7500k',
    '-maxrate', '7500k',
    '-bufsize', '15000k',
  ];

  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', ...common];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cbr', ...common];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...common];
    case 'libx264':
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', ...common];
  }
}

export class RestreamManager extends EventEmitter {
  private workers = new Map<number, WorkerEntry>();

  private getOrCreateEntry(target: RestreamTarget): WorkerEntry {
    const existing = this.workers.get(target.id);
    if (existing) return existing;
    const entry: WorkerEntry = {
      targetId: target.id,
      child: null,
      state: 'stopped',
      startedAt: null,
      reconnectCount: 0,
      shouldRun: false,
      restartTimer: null,
      mode: target.platform === 'twitch' && target.twitchDownscale1080p60 ? 'twitch-1080p60' : 'copy',
      encoder: 'copy',
    };
    this.workers.set(target.id, entry);
    return entry;
  }

  startTarget(targetId: number): RestreamWorkerStatus {
    const target = getRestreamTarget(targetId);
    if (!target) {
      throw new Error(`Restream target ${targetId} not found`);
    }

    const entry = this.getOrCreateEntry(target);
    entry.shouldRun = true;
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    if (!entry.child) {
      this.spawnWorker(target, entry);
    }
    return this.toStatus(entry);
  }

  private spawnWorker(target: RestreamTarget, entry: WorkerEntry): void {
    if (!entry.shouldRun || entry.child) return;

    if (!fs.existsSync(BINS.ffmpeg)) {
      entry.state = 'error';
      entry.lastError = 'ffmpeg.exe not found in /bin';
      this.emitStatus();
      return;
    }

    const destUrl = buildDestinationUrl(target.rtmpUrl, target.streamKey);
    const useDownscale = target.platform === 'twitch' && target.twitchDownscale1080p60;
    const detectedGpu = getCachedGpuEncoder()?.selected ?? 'libx264';

    entry.mode = useDownscale ? 'twitch-1080p60' : 'copy';
    entry.encoder = useDownscale ? detectedGpu : 'copy';
    entry.state = 'starting';
    entry.lastError = undefined;

    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-i', 'rtmp://127.0.0.1:1935/live/program_out',
    ];

    if (useDownscale) {
      args.push(...buildEncoderArgs(detectedGpu), '-c:a', 'copy');
    } else {
      args.push('-c', 'copy');
    }

    args.push('-f', 'flv', destUrl);

    const proc = spawn(BINS.ffmpeg, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });

    setBelowNormalPriority(proc);
    entry.child = proc;
    entry.startedAt = new Date().toISOString();
    entry.state = 'live';
    this.emitStatus();

    console.log(`[Restream:${target.name}] Started (${entry.mode}, encoder=${entry.encoder})`);

    proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) {
        entry.lastError = msg;
        console.warn(`[Restream:${target.name}] ${msg}`);
        this.emitStatus();
      }
    });

    proc.on('exit', (code) => {
      entry.child = null;
      entry.startedAt = null;
      console.log(`[Restream:${target.name}] Exited (code=${code})`);

      if (entry.shouldRun) {
        entry.state = 'reconnecting';
        entry.reconnectCount += 1;
        this.emitStatus();
        const delayMs = Math.min(15000, 2000 * Math.max(1, entry.reconnectCount));
        entry.restartTimer = setTimeout(() => {
          const fresh = getRestreamTarget(target.id);
          if (fresh && entry.shouldRun) {
            this.spawnWorker(fresh, entry);
          }
        }, delayMs);
      } else {
        entry.state = 'stopped';
        this.emitStatus();
      }
    });
  }

  async stopTarget(targetId: number): Promise<RestreamWorkerStatus | null> {
    const entry = this.workers.get(targetId);
    if (!entry) return null;

    entry.shouldRun = false;
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }

    if (entry.child) {
      const proc = entry.child;
      entry.child = null;
      await gracefulStopFfmpeg(proc);
    }

    entry.state = 'stopped';
    entry.startedAt = null;
    entry.reconnectCount = 0;
    this.emitStatus();
    return this.toStatus(entry);
  }

  startAllEnabled(): void {
    for (const target of listRestreamTargets()) {
      if (target.enabled) {
        this.startTarget(target.id);
      }
    }
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.workers.keys());
    await Promise.all(ids.map((id) => this.stopTarget(id)));
  }

  getWorkerStatuses(): RestreamWorkerStatus[] {
    const targets = listRestreamTargets();
    return targets.map((t) => {
      const entry = this.workers.get(t.id);
      if (!entry) {
        return {
          targetId: t.id,
          state: 'stopped',
          pid: null,
          startedAt: null,
          reconnectCount: 0,
          mode: t.platform === 'twitch' && t.twitchDownscale1080p60 ? 'twitch-1080p60' : 'copy',
          encoder: 'copy',
        };
      }
      return this.toStatus(entry);
    });
  }

  private toStatus(entry: WorkerEntry): RestreamWorkerStatus {
    return {
      targetId: entry.targetId,
      state: entry.state,
      pid: entry.child?.pid ?? null,
      startedAt: entry.startedAt,
      reconnectCount: entry.reconnectCount,
      mode: entry.mode,
      encoder: entry.encoder,
      lastError: entry.lastError,
    };
  }

  private emitStatus(): void {
    this.emit('status', this.getWorkerStatuses());
  }
}
