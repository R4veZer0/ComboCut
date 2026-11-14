import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { BINS } from '../config/paths.js';
import { getSettings } from '../db/database.js';
import { setBelowNormalPriority } from '../utils/process.js';

export interface AudioDeviceInfo {
  id: string;
  name: string;
  flow: 'render' | 'capture';
  isDefaultConsole: boolean;
  isDefaultComms: boolean;
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
  meters: {
    t1: number;
    t2: number;
    t3: number;
  };
  trackDevices: {
    t1: string;
    t2: string;
    t3: string;
  };
  lastHotSwapAt: string | null;
  error?: string;
}

export const AUDIO_PIPE_PATHS = {
  t1: '\\\\.\\pipe\\combocut-audio-t1',
  t2: '\\\\.\\pipe\\combocut-audio-t2',
  t3: '\\\\.\\pipe\\combocut-audio-t3',
} as const;

export class WasapiAudioManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private shouldRun = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private stdoutBuffer = '';
  private connected: [boolean, boolean, boolean] = [false, false, false];
  private meters = { t1: 0, t2: 0, t3: 0 };
  private trackDevices = { t1: '', t2: '', t3: '' };
  private lastHotSwapAt: string | null = null;
  private lastError: string | undefined;

  listDevices(): Promise<AudioDeviceInfo[]> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(BINS.wasapiCapture)) {
        reject(new Error('wasapi-capture.exe not found in /bin. Run "npm run build:wasapi".'));
        return;
      }
      execFile(
        BINS.wasapiCapture,
        ['--list-devices'],
        { windowsHide: true, timeout: 5000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim()) as AudioDeviceInfo[];
            resolve(parsed);
          } catch (parseErr) {
            reject(parseErr);
          }
        },
      );
    });
  }

  start(): WasapiAudioStatus {
    this.shouldRun = true;
    if (!this.child) {
      this.spawnWorker();
    }
    return this.getStatus();
  }

  private spawnWorker(): void {
    if (!this.shouldRun || this.child) return;

    if (!fs.existsSync(BINS.wasapiCapture)) {
      this.lastError = 'wasapi-capture.exe not found in /bin';
      this.emit('status', this.getStatus());
      return;
    }

    const settings = getSettings();
    const args: string[] = [];
    if (settings.audioT1Device) args.push('--t1-device', settings.audioT1Device);
    if (settings.audioT2Device) args.push('--t2-device', settings.audioT2Device);
    if (settings.audioT3Device) args.push('--t3-device', settings.audioT3Device);

    this.lastError = undefined;
    this.stdoutBuffer = '';

    const proc = spawn(BINS.wasapiCapture, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    setBelowNormalPriority(proc);
    this.child = proc;

    proc.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.handleTelemetryLine(trimmed);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) {
        this.lastError = msg;
        console.warn(`[WASAPI] ${msg}`);
      }
    });

    proc.on('exit', (code) => {
      this.child = null;
      this.connected = [false, false, false];
      this.meters = { t1: 0, t2: 0, t3: 0 };
      console.log(`[WASAPI] Exited (code=${code})`);
      this.emit('status', this.getStatus());

      if (this.shouldRun) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.spawnWorker(), 1500);
      }
    });

    console.log('[WASAPI] Started 3-track Core Audio capture helper');
    this.emit('status', this.getStatus());
  }

  private handleTelemetryLine(line: string): void {
    try {
      const msg = JSON.parse(line) as {
        type?: string;
        t1?: number;
        t2?: number;
        t3?: number;
        pipes?: [boolean, boolean, boolean];
        track?: number;
        label?: string;
        message?: string;
      };

      if (msg.type === 'meters') {
        this.meters = {
          t1: msg.t1 ?? 0,
          t2: msg.t2 ?? 0,
          t3: msg.t3 ?? 0,
        };
        if (Array.isArray(msg.pipes) && msg.pipes.length === 3) {
          this.connected = msg.pipes;
        }
        this.emit('meters', this.meters);
        return;
      }

      if (msg.type === 'trackReady' && msg.track) {
        if (msg.track === 1) this.trackDevices.t1 = msg.message ?? '';
        if (msg.track === 2) this.trackDevices.t2 = msg.message ?? '';
        if (msg.track === 3) this.trackDevices.t3 = msg.message ?? '';
        this.emit('status', this.getStatus());
        return;
      }

      if (msg.type === 'hotSwap') {
        this.lastHotSwapAt = new Date().toISOString();
        console.log(`[WASAPI] Track ${msg.track} (${msg.label}) hot-swap: ${msg.message}`);
        this.emit('hotSwap', msg);
        this.emit('status', this.getStatus());
        return;
      }

      if (msg.type === 'error') {
        this.lastError = msg.message;
        console.warn(`[WASAPI] Track ${msg.track} error: ${msg.message}`);
      }
    } catch {
      // Ignore non-JSON log lines
    }
  }

  async stop(): Promise<void> {
    this.shouldRun = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.child) return;

    const proc = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.killed) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 2000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });

    this.connected = [false, false, false];
    this.meters = { t1: 0, t2: 0, t3: 0 };
    this.emit('status', this.getStatus());
  }

  getStatus(): WasapiAudioStatus {
    return {
      running: Boolean(this.child && this.child.exitCode === null),
      pid: this.child?.pid ?? null,
      pipes: {
        ...AUDIO_PIPE_PATHS,
        connected: [...this.connected] as [boolean, boolean, boolean],
      },
      meters: { ...this.meters },
      trackDevices: { ...this.trackDevices },
      lastHotSwapAt: this.lastHotSwapAt,
      error: this.lastError,
    };
  }
}
