import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { BINS } from '../config/paths.js';
import { getCachedGpuEncoder } from './gpuDetector.js';
import type { MediaMtxManager, MediaMtxStatus } from './mediaMtxManager.js';
import { forceKillProcessTree, setBelowNormalPriority } from '../utils/process.js';

export type ProgramRelaySource = 'stopped' | 'standby_bars' | 'live_obs';

export interface ProgramRelayStatus {
  running: boolean;
  source: ProgramRelaySource;
  toneMuted: boolean;
  pid: number | null;
  obsLive: boolean;
  outputUrl: string;
  error?: string;
}

export class ProgramRelayManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private shouldRun = false;
  private obsLive = false;
  private toneMuted = true;
  private activeSource: ProgramRelaySource = 'stopped';
  private restartTimer: NodeJS.Timeout | null = null;
  private switching = false;
  private lastError: string | undefined;

  constructor(private readonly mediaMtx: MediaMtxManager) {
    super();
    this.mediaMtx.on('status', (status: MediaMtxStatus) => {
      const ready = status.paths.find((p) => p.name === 'live/program')?.ready ?? false;
      if (ready !== this.obsLive) {
        this.obsLive = ready;
        if (this.shouldRun) {
          void this.switchSource();
        }
      }
    });
  }

  start(): ProgramRelayStatus {
    this.shouldRun = true;
    const ready = this.mediaMtx.getStatus().paths.find((p) => p.name === 'live/program')?.ready ?? false;
    this.obsLive = ready;
    if (!this.child && !this.switching) {
      void this.switchSource();
    }
    return this.getStatus();
  }

  async stop(): Promise<ProgramRelayStatus> {
    this.shouldRun = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    await this.killCurrentChild();
    this.activeSource = 'stopped';
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  async setToneMuted(muted: boolean): Promise<ProgramRelayStatus> {
    if (this.toneMuted === muted) return this.getStatus();
    this.toneMuted = muted;
    if (this.shouldRun && !this.obsLive) {
      await this.switchSource();
    } else {
      this.emit('status', this.getStatus());
    }
    return this.getStatus();
  }

  private async killCurrentChild(): Promise<void> {
    const proc = this.child;
    this.child = null;
    if (!proc) return;
    await forceKillProcessTree(proc.pid);
  }

  private async switchSource(): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    try {
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      await this.killCurrentChild();
      if (!this.shouldRun) {
        this.activeSource = 'stopped';
        this.emit('status', this.getStatus());
        return;
      }
      this.spawnWorker();
    } finally {
      this.switching = false;
    }
  }

  private spawnWorker(): void {
    if (!this.shouldRun || this.child) return;
    if (!fs.existsSync(BINS.ffmpeg)) {
      this.lastError = 'ffmpeg.exe not found in /bin';
      this.emit('status', this.getStatus());
      return;
    }

    const targetSource: ProgramRelaySource = this.obsLive ? 'live_obs' : 'standby_bars';
    this.activeSource = targetSource;
    this.lastError = undefined;

    const outputUrl = 'rtmp://127.0.0.1:1935/live/program_out';
    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];

    if (targetSource === 'live_obs') {
      args.push(
        '-fflags', '+genpts',
        '-i', 'rtmp://127.0.0.1:1935/live/program',
        '-c', 'copy',
        '-f', 'flv',
        outputUrl,
      );
    } else {
      const encoder = getCachedGpuEncoder()?.selected ?? 'libx264';
      args.push(
        '-re',
        '-f', 'lavfi',
        '-i', 'smptehdbars=size=1280x720:rate=30',
        '-f', 'lavfi',
        '-i', this.toneMuted ? 'anullsrc=channel_layout=stereo:sample_rate=48000' : 'sine=frequency=440:sample_rate=48000',
        '-c:v', encoder === 'libx264' ? 'libx264' : encoder,
      );
      if (encoder === 'h264_nvenc') {
        args.push('-preset', 'p1', '-tune', 'll', '-b:v', '2500k');
      } else if (encoder === 'h264_amf') {
        args.push('-quality', 'speed', '-b:v', '2500k');
      } else if (encoder === 'h264_qsv') {
        args.push('-preset', 'veryfast', '-b:v', '2500k');
      } else {
        args.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', '2500k');
      }
      args.push(
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-ar', '48000',
        '-ac', '2',
        '-b:a', '128k',
        '-f', 'flv',
        outputUrl,
      );
    }

    const proc = spawn(BINS.ffmpeg, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    setBelowNormalPriority(proc);
    this.child = proc;

    proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) {
        this.lastError = msg;
      }
    });

    proc.on('exit', () => {
      if (this.child === proc) {
        this.child = null;
      }
      if (this.shouldRun && !this.switching) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (this.shouldRun && !this.child && !this.switching) {
            this.spawnWorker();
          }
        }, 1200);
      }
      this.emit('status', this.getStatus());
    });

    this.emit('status', this.getStatus());
  }

  getStatus(): ProgramRelayStatus {
    return {
      running: this.child !== null,
      source: this.activeSource,
      toneMuted: this.toneMuted,
      pid: this.child?.pid ?? null,
      obsLive: this.obsLive,
      outputUrl: 'rtmp://127.0.0.1:1935/live/program_out',
      error: this.lastError,
    };
  }
}
