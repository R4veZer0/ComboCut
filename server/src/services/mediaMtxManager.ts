import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { BINS, MEDIAMTX_CONFIG_PATH, ensureRuntimeDirs } from '../config/paths.js';

export type IngestPathName = 'live/program' | 'live/cam' | 'live/clean';

export interface IngestPathStatus {
  name: IngestPathName;
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

const INGEST_PATHS: IngestPathName[] = ['live/program', 'live/cam', 'live/clean'];

export class MediaMtxManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastProgramReady = false;
  private status: MediaMtxStatus = {
    running: false,
    pid: null,
    rtmpUrl: 'rtmp://127.0.0.1:1935/live/program',
    srtUrl: 'srt://127.0.0.1:8890?streamid=publish:live/program',
    apiUrl: 'http://127.0.0.1:9997',
    paths: INGEST_PATHS.map((name) => ({
      name,
      ready: false,
      readyTime: null,
      tracks: [],
      bytesReceived: 0,
      readersCount: 0,
    })),
  };

  private writeConfig(): void {
    ensureRuntimeDirs();
    const yaml = [
      'logLevel: info',
      'api: yes',
      'apiAddress: 127.0.0.1:9997',
      'rtmp: yes',
      'rtmpAddress: :1935',
      'srt: yes',
      'srtAddress: :8890',
      'rtsp: no',
      'hls: no',
      'webrtc: no',
      'paths:',
      '  live/program:',
      '    source: publisher',
      '  live/cam:',
      '    source: publisher',
      '  live/clean:',
      '    source: publisher',
      '',
    ].join('\n');
    fs.writeFileSync(MEDIAMTX_CONFIG_PATH, yaml, 'utf8');
  }

  start(): void {
    if (this.child) return;

    if (!fs.existsSync(BINS.mediamtx)) {
      this.status.error = 'mediamtx.exe not found in /bin. Run npm run setup:bins.';
      console.warn(`[MediaMTX] ${this.status.error}`);
      return;
    }

    this.writeConfig();
    this.status.error = undefined;

    const proc = spawn(BINS.mediamtx, [MEDIAMTX_CONFIG_PATH], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = proc;
    this.status.running = true;
    this.status.pid = proc.pid ?? null;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[MediaMTX] ${text}`);
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[MediaMTX] ${text}`);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[MediaMTX] Exited (code=${code}, signal=${signal})`);
      this.child = null;
      this.status.running = false;
      this.status.pid = null;
      this.resetPaths();
      this.emit('status', this.getStatus());
    });

    this.startPolling();
    console.log('[MediaMTX] Started (RTMP :1935, SRT :8890, API :9997)');
  }

  private resetPaths(): void {
    for (const p of this.status.paths) {
      p.ready = false;
      p.readyTime = null;
      p.tracks = [];
      p.bytesReceived = 0;
      p.readersCount = 0;
    }
    if (this.lastProgramReady) {
      this.lastProgramReady = false;
      this.emit('programOffline');
    }
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.pollApi();
    }, 1000);
  }

  async pollApi(): Promise<void> {
    if (!this.status.running) return;
    try {
      const res = await fetch(`${this.status.apiUrl}/v3/paths/list`, {
        signal: AbortSignal.timeout(800),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: Array<{
          name: string;
          ready: boolean;
          readyTime?: string | null;
          tracks?: string[];
          bytesReceived?: number;
          readers?: unknown[];
        }>;
      };

      const byName = new Map((data.items ?? []).map((item) => [item.name, item]));
      this.status.paths = INGEST_PATHS.map((name) => {
        const item = byName.get(name);
        return {
          name,
          ready: Boolean(item?.ready),
          readyTime: item?.readyTime ?? null,
          tracks: item?.tracks ?? [],
          bytesReceived: item?.bytesReceived ?? 0,
          readersCount: item?.readers?.length ?? 0,
        };
      });

      const programReady = this.status.paths.find((p) => p.name === 'live/program')?.ready ?? false;
      if (programReady && !this.lastProgramReady) {
        this.lastProgramReady = true;
        this.emit('programOnline');
      } else if (!programReady && this.lastProgramReady) {
        this.lastProgramReady = false;
        this.emit('programOffline');
      }

      this.emit('status', this.getStatus());
    } catch {
      // API may still be starting up
    }
  }

  getStatus(): MediaMtxStatus {
    return structuredClone(this.status);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.child) return;
    const proc = this.child;
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
        resolve();
      }, 3000);
    });
    this.child = null;
    this.status.running = false;
    this.status.pid = null;
  }
}
