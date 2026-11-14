import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { BINS, EXPORTS_DIR, PINNED_DIR, ensureRuntimeDirs, resolveBufferDir } from '../config/paths.js';
import {
  createPinnedClip,
  createTimelineMarker,
  deletePinnedClip,
  getPinnedClip,
  getSettings,
  listPinnedClips,
  type MarkerSource,
  type PinnedClip,
} from '../db/database.js';
import type { ObsWebSocketManager } from './obsWebSocketManager.js';
import { setBelowNormalPriority } from '../utils/process.js';

export class PinnedClipManager extends EventEmitter {
  constructor(private readonly obsWs: ObsWebSocketManager) {
    super();
  }

  async pinFromBuffer(options?: {
    triggerSource?: MarkerSource;
    triggerLabel?: string;
    durationSec?: number;
  }): Promise<PinnedClip> {
    const triggerSource = options?.triggerSource ?? 'hotkey';
    const triggerLabel = options?.triggerLabel ?? 'Manual Hotkey Pin';
    const requestedSec = Math.min(90, Math.max(45, Math.round(options?.durationSec ?? 60)));

    const settings = getSettings();
    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    ensureRuntimeDirs(bufferDir);

    if (!fs.existsSync(BINS.ffmpeg)) {
      throw new Error('ffmpeg.exe not found in /bin');
    }

    const segments = fs.existsSync(bufferDir)
      ? fs
          .readdirSync(bufferDir)
          .filter((f) => /^seg_\d+\.ts$/i.test(f))
          .sort()
      : [];

    if (segments.length === 0) {
      throw new Error('No HLS DVR segments available in /buffer to pin');
    }

    // 2s per segment -> take trailing ceil(requestedSec / 2) segments
    const neededSegs = Math.max(1, Math.ceil(requestedSec / 2));
    const selected = segments.slice(-neededSegs);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTag = triggerSource.replace(/[^a-z0-9_-]/gi, '');
    const filename = `pin_${stamp}_${safeTag}.mp4`;
    const outputPath = path.join(PINNED_DIR, filename);
    const listPath = path.join(PINNED_DIR, `.concat_${Date.now()}.txt`);

    const listBody = selected
      .map((seg) => `file '${path.join(bufferDir, seg).replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listPath, listBody, 'utf8');

    try {
      await this.runFfmpegCopy(listPath, outputPath);
    } finally {
      fs.rmSync(listPath, { force: true });
    }

    const actualDuration = (await this.probeDuration(outputPath)) || selected.length * 2;
    const activePreset = this.obsWs.getActivePreset();

    if (triggerSource === 'hotkey') {
      const marker = createTimelineMarker({
        source: 'hotkey',
        label: triggerLabel,
        sceneName: activePreset?.sceneName ?? '',
        metadata: { filename, durationSec: actualDuration },
      });
      this.emit('markerCreated', marker);
    }

    const clip = createPinnedClip({
      filePath: outputPath,
      filename,
      triggerSource,
      triggerLabel,
      durationSec: actualDuration,
      cropPreset: activePreset,
    });

    console.log(`[Pinned] Extracted ${actualDuration.toFixed(1)}s micro-clip -> ${outputPath}`);
    this.emit('pinned', clip);
    this.emit('clipsUpdated', listPinnedClips());
    return clip;
  }

  async quickExport(pinnedClipId: number): Promise<string> {
    const clip = getPinnedClip(pinnedClipId);
    if (!clip || !fs.existsSync(clip.filePath)) {
      throw new Error('Pinned clip file not found');
    }
    ensureRuntimeDirs();
    const outName = `export_${Date.now()}_${clip.filename}`;
    const outPath = path.join(EXPORTS_DIR, outName);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        BINS.ffmpeg,
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', clip.filePath, '-c', 'copy', '-movflags', '+faststart', outPath],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      );
      setBelowNormalPriority(proc);
      let errText = '';
      proc.stderr?.on('data', (c: Buffer) => {
        errText += c.toString('utf8');
      });
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(errText || `Quick export exited with code ${code}`));
      });
    });

    return outPath;
  }

  private runFfmpegCopy(listPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel', 'warning',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ];

      const proc = spawn(BINS.ffmpeg, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });

      setBelowNormalPriority(proc);

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      proc.on('exit', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve();
        } else {
          reject(new Error(`Pinned clip extraction failed (code=${code}): ${stderr.trim()}`));
        }
      });
    });
  }

  private probeDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      if (!fs.existsSync(BINS.ffprobe)) {
        resolve(0);
        return;
      }
      execFile(
        BINS.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err) {
            resolve(0);
            return;
          }
          const v = Number.parseFloat(stdout.trim());
          resolve(Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
        },
      );
    });
  }

  listClips(): PinnedClip[] {
    return listPinnedClips();
  }

  removeClip(id: number): boolean {
    const clip = getPinnedClip(id);
    if (clip && fs.existsSync(clip.filePath)) {
      fs.rmSync(clip.filePath, { force: true });
    }
    const ok = deletePinnedClip(id);
    if (ok) this.emit('clipsUpdated', listPinnedClips());
    return ok;
  }
}
