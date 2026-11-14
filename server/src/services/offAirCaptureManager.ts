import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { BINS, ensureRuntimeDirs, resolveBufferDir } from '../config/paths.js';
import { getSettings, type OffAirMode } from '../db/database.js';
import { getCachedGpuEncoder } from './gpuDetector.js';
import { AUDIO_PIPE_PATHS, type WasapiAudioManager } from './wasapiAudioManager.js';
import { gracefulStopFfmpeg, setBelowNormalPriority } from '../utils/process.js';

export interface DshowDeviceList {
  video: string[];
  audio: string[];
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

export class OffAirCaptureManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private activeMode: OffAirMode = 'ddagrab';
  private activeEncoder = 'libx264';
  private activeAudioTracks = 0;
  private activeDshowVideo = '';
  private activeWebcam = '';
  private lastAutoReleaseReason: string | null = null;
  private lastAutoReleaseAt: string | null = null;
  private lastError: string | undefined;

  constructor(private readonly wasapiAudio: WasapiAudioManager) {
    super();
  }

  listDshowDevices(): Promise<DshowDeviceList> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(BINS.ffmpeg)) {
        reject(new Error('ffmpeg.exe not found in /bin'));
        return;
      }

      execFile(
        BINS.ffmpeg,
        ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
        { windowsHide: true, timeout: 8000 },
        (_err, _stdout, stderr) => {
          const video: string[] = [];
          const audio: string[] = [];
          const lines = (stderr || '').split(/\r?\n/);

          for (const line of lines) {
            const match = line.match(/\]\s+"([^"]+)"\s+\((video|audio)\)/i);
            if (!match) continue;
            const name = match[1];
            const kind = match[2].toLowerCase();
            if (kind === 'video' && !video.includes(name)) video.push(name);
            if (kind === 'audio' && !audio.includes(name)) audio.push(name);
          }

          resolve({ video, audio });
        },
      );
    });
  }

  start(overrides?: {
    mode?: OffAirMode;
    dshowVideoDevice?: string;
    dshowAudioDevice?: string;
    webcamDevice?: string;
  }): OffAirStatus {
    if (this.child) {
      return this.getStatus();
    }

    if (!fs.existsSync(BINS.ffmpeg)) {
      this.lastError = 'ffmpeg.exe not found in /bin';
      this.emit('status', this.getStatus());
      return this.getStatus();
    }

    const settings = getSettings();
    const mode = overrides?.mode ?? settings.offAirMode;
    const dshowVideo = (overrides?.dshowVideoDevice ?? settings.dshowVideoDevice).trim();
    const dshowAudio = (overrides?.dshowAudioDevice ?? settings.dshowAudioDevice).trim();
    const webcam = (overrides?.webcamDevice ?? settings.webcamDevice).trim();

    if (mode === 'dshow' && !dshowVideo) {
      this.lastError = 'dshowVideoDevice is required for DirectShow capture mode';
      this.emit('status', this.getStatus());
      return this.getStatus();
    }

    // Start 3-track WASAPI helper if binary is available
    let useWasapiPipes = false;
    if (fs.existsSync(BINS.wasapiCapture)) {
      const audioStatus = this.wasapiAudio.start();
      useWasapiPipes = audioStatus.running;
    }

    const ramDiskActive = settings.ramDiskEnabled && settings.ramDiskPath.trim().length > 0;
    const bufferDir = resolveBufferDir(ramDiskActive ? settings.ramDiskPath : null);
    ensureRuntimeDirs(bufferDir);

    const hlsListSize = Math.max(15, settings.bufferMinutes * 30);
    const playlistPath = path.join(bufferDir, 'live.m3u8');
    const segmentPattern = path.join(bufferDir, 'seg_%06d.ts');

    const gpu = getCachedGpuEncoder();
    const encoder = gpu?.selected ?? 'libx264';

    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];

    // Input 0: Video (ddagrab or dshow)
    if (mode === 'ddagrab') {
      args.push('-f', 'lavfi', '-i', 'ddagrab=framerate=60:draw_mouse=1');
    } else {
      args.push('-f', 'dshow', '-rtbufsize', '256M');
      const dshowInput = dshowAudio ? `video=${dshowVideo}:audio=${dshowAudio}` : `video=${dshowVideo}`;
      args.push('-i', dshowInput);
    }

    // Optional webcam input (when in dshow mode)
    const hasWebcam = mode === 'dshow' && webcam.length > 0;
    if (hasWebcam) {
      args.push('-f', 'dshow', '-rtbufsize', '64M', '-i', `video=${webcam}`);
    }

    // Audio inputs: 3 discrete WASAPI named pipes (48kHz stereo s16le)
    const audioInputStartIdx = hasWebcam ? 2 : 1;
    if (useWasapiPipes) {
      for (const pipePath of [AUDIO_PIPE_PATHS.t1, AUDIO_PIPE_PATHS.t2, AUDIO_PIPE_PATHS.t3]) {
        args.push('-f', 's16le', '-ar', '48000', '-ac', '2', '-i', pipePath);
      }
      this.activeAudioTracks = 3;
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      this.activeAudioTracks = 1;
    }

    // Video filter / mapping
    if (hasWebcam) {
      args.push(
        '-filter_complex',
        '[1:v]scale=320:-1[cam];[0:v][cam]overlay=W-w-24:H-h-24,format=yuv420p[vout]',
        '-map', '[vout]',
      );
    } else if (mode === 'ddagrab') {
      args.push('-vf', 'hwdownload,format=bgra,format=yuv420p', '-map', '0:v');
    } else {
      args.push('-vf', 'format=yuv420p', '-map', '0:v');
    }

    // Map discrete audio tracks into MPEG-TS HLS
    if (useWasapiPipes) {
      args.push(
        '-map', `${audioInputStartIdx}:a`,
        '-map', `${audioInputStartIdx + 1}:a`,
        '-map', `${audioInputStartIdx + 2}:a`,
      );
    } else {
      args.push('-map', `${audioInputStartIdx}:a`);
    }

    // GPU / CPU encoder settings (2s GOP = 120 frames @ 60fps)
    args.push('-c:v', encoder);
    if (encoder === 'h264_nvenc') {
      args.push('-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-b:v', '8000k');
    } else if (encoder === 'h264_amf') {
      args.push('-quality', 'speed', '-rc', 'cbr', '-b:v', '8000k');
    } else if (encoder === 'h264_qsv') {
      args.push('-preset', 'veryfast', '-b:v', '8000k');
    } else {
      args.push('-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', '6000k');
    }

    args.push(
      '-g', '120',
      '-keyint_min', '120',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', String(hlsListSize),
      '-hls_delete_threshold', '4',
      '-hls_flags', 'delete_segments+independent_segments+temp_file',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    );

    this.activeMode = mode;
    this.activeEncoder = encoder;
    this.activeDshowVideo = dshowVideo;
    this.activeWebcam = webcam;
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
        console.warn(`[OffAir:${mode}] ${msg}`);
      }
    });

    proc.on('exit', (code) => {
      this.child = null;
      console.log(`[OffAir:${mode}] Stopped (code=${code})`);
      this.emit('status', this.getStatus());
    });

    console.log(
      `[OffAir] Started ${mode} capture (encoder=${encoder}, audioTracks=${this.activeAudioTracks}) -> ${playlistPath}`,
    );
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  async stop(): Promise<OffAirStatus> {
    if (!this.child) {
      return this.getStatus();
    }
    const proc = this.child;
    this.child = null;
    await gracefulStopFfmpeg(proc);
    this.emit('status', this.getStatus());
    return this.getStatus();
  }

  /**
   * Immediately releases any active Off-Air capture handle (critical for dshow capture cards)
   * when OBS WebSocket connects or /live/program goes online.
   */
  async releaseForOnAir(reason: string): Promise<void> {
    if (!this.child) return;
    this.lastAutoReleaseReason = reason;
    this.lastAutoReleaseAt = new Date().toISOString();
    console.log(`[OffAir] Auto-releasing ${this.activeMode} capture handle: ${reason}`);
    await this.stop();
    this.emit('autoReleased', { reason, at: this.lastAutoReleaseAt });
  }

  getStatus(): OffAirStatus {
    const settings = getSettings();
    const ramDiskActive = settings.ramDiskEnabled && settings.ramDiskPath.trim().length > 0;
    const bufferDir = resolveBufferDir(ramDiskActive ? settings.ramDiskPath : null);
    return {
      running: Boolean(this.child && this.child.exitCode === null),
      pid: this.child?.pid ?? null,
      mode: this.activeMode,
      encoder: this.activeEncoder,
      audioTracks: this.activeAudioTracks,
      bufferDir,
      playlistUrl: '/buffer/live.m3u8',
      dshowVideoDevice: this.activeDshowVideo,
      webcamDevice: this.activeWebcam,
      lastAutoReleaseReason: this.lastAutoReleaseReason,
      lastAutoReleaseAt: this.lastAutoReleaseAt,
      error: this.lastError,
    };
  }
}
