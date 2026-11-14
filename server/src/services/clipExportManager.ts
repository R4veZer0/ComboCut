import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { BINS, ROOT_DIR, ensureRuntimeDirs, resolveBufferDir, resolveExportsDir } from '../config/paths.js';
import { getPinnedClip, getSettings, type LayoutMode, type NormalizedRect, type SubtitleCue } from '../db/database.js';
import { getCachedGpuEncoder } from './gpuDetector.js';
import { buildSrtContent, writeStyledAssFile, type SubtitleStyle } from './subtitleService.js';
import { gracefulStopFfmpeg, setBelowNormalPriority } from '../utils/process.js';

export interface DemoStreamStatus {
  running: boolean;
  pid: number | null;
}

export interface ClipExportRequest {
  pinnedClipId?: number;
  inSec?: number;
  outSec?: number;
  layoutMode: LayoutMode;
  gameplayRect: NormalizedRect;
  facecamRect: NormalizedRect | null;
  audioGains: { t1: number; t2: number; t3: number };
  normalizeLufs: boolean;
  captionsEnabled: boolean;
  captionText?: string;
  speakerColor?: string;
  subtitleCues?: SubtitleCue[];
  subtitleStyle?: SubtitleStyle;
  watermarkText?: string;
  colorPreset?: 'none' | 'vibrant' | 'cinematic' | 'crisp';
  speed?: number;
  zoomScale?: number;
}

export interface ClipExportResult {
  filename: string;
  filePath: string;
  exportDir: string;
  downloadUrl: string;
  encoder: string;
  hookTitle: string;
  hashtags: string;
}

export function generateHookSuggestion(
  cues: SubtitleCue[],
  fallbackLabel?: string,
): { hookTitle: string; hashtags: string } {
  const fullText = cues
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  let hookTitle = '';
  if (fullText.length > 0) {
    const firstSentence = fullText.split(/[.!?]/)[0]?.trim() ?? fullText;
    const words = firstSentence.split(/\s+/).slice(0, 9).join(' ');
    hookTitle = words.length < firstSentence.length ? `${words}...` : words;
  } else {
    hookTitle = fallbackLabel?.trim() || 'Insane Highlight Moment!';
  }

  const tags = new Set<string>(['#gaming', '#clips', '#shorts', '#highlights']);
  const lower = `${fullText} ${fallbackLabel ?? ''}`.toLowerCase();
  if (/\b(clutch|ace|1v\d|win|victory)\b/.test(lower)) tags.add('#clutch');
  if (/\b(fail|rip|what|no way|bro)\b/.test(lower)) tags.add('#funny');
  if (/\b(headshot|snipe|aim|flick|kill)\b/.test(lower)) tags.add('#fps');
  if (/\b(stream|chat|twitch)\b/.test(lower)) tags.add('#twitch');

  return {
    hookTitle,
    hashtags: Array.from(tags).slice(0, 6).join(' '),
  };
}

export class ClipExportManager extends EventEmitter {
  private demoChild: ChildProcess | null = null;

  startDemoStream(): DemoStreamStatus {
    if (this.demoChild) return this.getDemoStatus();
    const scriptPath = path.join(ROOT_DIR, 'scripts', 'test-stream.mjs');
    if (!fs.existsSync(scriptPath)) {
      throw new Error('scripts/test-stream.mjs not found');
    }

    const proc = spawn(process.execPath, [scriptPath], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    setBelowNormalPriority(proc);
    this.demoChild = proc;

    proc.on('exit', () => {
      this.demoChild = null;
      this.emit('demoStatus', this.getDemoStatus());
    });

    console.log('[Demo] Started built-in synthetic 1080p60 demo stream');
    this.emit('demoStatus', this.getDemoStatus());
    return this.getDemoStatus();
  }

  async stopDemoStream(): Promise<DemoStreamStatus> {
    if (!this.demoChild) return this.getDemoStatus();
    const proc = this.demoChild;
    this.demoChild = null;
    await gracefulStopFfmpeg(proc);
    this.emit('demoStatus', this.getDemoStatus());
    return this.getDemoStatus();
  }

  getDemoStatus(): DemoStreamStatus {
    return {
      running: Boolean(this.demoChild && this.demoChild.exitCode === null),
      pid: this.demoChild?.pid ?? null,
    };
  }

  async exportClip(req: ClipExportRequest): Promise<ClipExportResult> {
    if (!fs.existsSync(BINS.ffmpeg)) {
      throw new Error('ffmpeg.exe not found in /bin');
    }
    ensureRuntimeDirs();

    let inputPath = '';
    let concatListPath: string | null = null;

    if (req.pinnedClipId) {
      const clip = getPinnedClip(req.pinnedClipId);
      if (!clip || !fs.existsSync(clip.filePath)) {
        throw new Error('Pinned clip not found');
      }
      inputPath = clip.filePath;
    } else {
      const settings = getSettings();
      const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
      const segments = fs.existsSync(bufferDir)
        ? fs
            .readdirSync(bufferDir)
            .filter((f) => /^seg_\d+\.ts$/i.test(f))
            .sort()
            .slice(-45)
        : [];
      if (segments.length === 0) {
        throw new Error('No HLS buffer segments or pinned clip selected for export');
      }
      concatListPath = path.join(resolveExportsDir(), `.export_list_${Date.now()}.txt`);
      fs.writeFileSync(
        concatListPath,
        segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8',
      );
      inputPath = concatListPath;
    }

    const outFilename = `combocut_${Date.now()}.mp4`;
    const outPath = path.join(resolveExportsDir(), outFilename);
    const gpu = getCachedGpuEncoder();
    const encoder = gpu?.selected ?? 'libx264';

    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'warning'];
    if (concatListPath) {
      args.push('-f', 'concat', '-safe', '0');
    }
    if (typeof req.inSec === 'number' && req.inSec > 0) {
      args.push('-ss', req.inSec.toFixed(2));
    }
    if (typeof req.outSec === 'number' && req.outSec > (req.inSec ?? 0)) {
      args.push('-to', req.outSec.toFixed(2));
    }
    args.push('-i', inputPath);

    // Build single-pass filter_complex for 1080x1920 vertical output
    const filters: string[] = [];
    const gp = req.gameplayRect;
    const zoom = Math.min(2.0, Math.max(1.0, req.zoomScale ?? 1.0));

    if (req.layoutMode === 'split_2box' && req.facecamRect) {
      const fc = req.facecamRect;
      // Top 35% (1080x672) Facecam, Bottom 65% (1080x1248) Gameplay
      filters.push(
        `[0:v]split=2[vcam][vgame]`,
        `[vcam]crop=iw*${fc.width.toFixed(4)}:ih*${fc.height.toFixed(4)}:iw*${fc.x.toFixed(4)}:ih*${fc.y.toFixed(4)},scale=1080:672:force_original_aspect_ratio=increase,crop=1080:672[cam_out]`,
        `[vgame]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:1248:force_original_aspect_ratio=increase,crop=1080:1248[game_out]`,
        `[cam_out][game_out]vstack=inputs=2[vstacked]`,
      );
    } else if (req.layoutMode === 'top_cam_bottom_game' && req.facecamRect) {
      const fc = req.facecamRect;
      // 50/50 split: Top 960px Facecam, Bottom 960px Gameplay
      filters.push(
        `[0:v]split=2[vcam][vgame]`,
        `[vcam]crop=iw*${fc.width.toFixed(4)}:ih*${fc.height.toFixed(4)}:iw*${fc.x.toFixed(4)}:ih*${fc.y.toFixed(4)},scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[cam_out]`,
        `[vgame]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[game_out]`,
        `[cam_out][game_out]vstack=inputs=2[vstacked]`,
      );
    } else if (req.layoutMode === 'pip_rounded' && req.facecamRect) {
      const fc = req.facecamRect;
      // Full-height gameplay + 320x320 rounded-corner Facecam PiP with drop shadow in top-right safe zone
      filters.push(
        `[0:v]split=2[vgame][vcam]`,
        `[vgame]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawbox=x=1080-320-32:y=156:w=320:h=320:color=black@0.45:t=fill[game_out]`,
        `[vcam]crop=iw*${fc.width.toFixed(4)}:ih*${fc.height.toFixed(4)}:iw*${fc.x.toFixed(4)}:ih*${fc.y.toFixed(4)},scale=320:320:force_original_aspect_ratio=increase,crop=320:320,format=yuva420p,geq=lum='p(X,Y)':a='if(gt(abs(W/2-X),W/2-36)*gt(abs(H/2-Y),H/2-36),if(lte(hypot(abs(W/2-X)-(W/2-36),abs(H/2-Y)-(H/2-36)),36),255,0),255)'[cam_pip]`,
        `[game_out][cam_pip]overlay=W-w-36:150[vstacked]`,
      );
    } else if (req.layoutMode === 'blurred_pillarbox') {
      // Blurred 9:16 background + centered full-width gameplay foreground
      filters.push(
        `[0:v]split=2[vbg][vfg]`,
        `[vbg]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.12[bg_out]`,
        `[vfg]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:-2[fg_out]`,
        `[bg_out][fg_out]overlay=(W-w)/2:(H-h)/2[vstacked]`,
      );
    } else if (req.layoutMode === 'fullscreen_cam' && req.facecamRect) {
      const fc = req.facecamRect;
      filters.push(
        `[0:v]crop=iw*${fc.width.toFixed(4)}:ih*${fc.height.toFixed(4)}:iw*${fc.x.toFixed(4)}:ih*${fc.y.toFixed(4)},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vstacked]`,
      );
    } else {
      filters.push(
        `[0:v]crop=iw*${gp.width.toFixed(4)}:ih*${gp.height.toFixed(4)}:iw*${gp.x.toFixed(4)}:ih*${gp.y.toFixed(4)},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vstacked]`,
      );
    }

    let vLabel = 'vstacked';

    if (zoom > 1.01) {
      const zw = Math.round(1080 * zoom);
      const zh = Math.round(1920 * zoom);
      filters.push(`[${vLabel}]scale=${zw}:${zh},crop=1080:1920[vzoom]`);
      vLabel = 'vzoom';
    }

    if (req.colorPreset === 'vibrant') {
      filters.push(`[${vLabel}]eq=saturation=1.25:contrast=1.08[vcolor]`);
      vLabel = 'vcolor';
    } else if (req.colorPreset === 'cinematic') {
      filters.push(`[${vLabel}]eq=saturation=0.92:contrast=1.14:brightness=-0.02[vcolor]`);
      vLabel = 'vcolor';
    } else if (req.colorPreset === 'crisp') {
      filters.push(`[${vLabel}]unsharp=5:5:0.8:5:5:0.0,eq=contrast=1.05[vcolor]`);
      vLabel = 'vcolor';
    }

    const speed = Math.min(2.0, Math.max(0.5, req.speed ?? 1.0));
    if (Math.abs(speed - 1.0) > 0.01) {
      filters.push(`[${vLabel}]setpts=${(1 / speed).toFixed(4)}*PTS[vspeed]`);
      vLabel = 'vspeed';
    }

    if (req.watermarkText && req.watermarkText.trim().length > 0) {
      const safeWm = req.watermarkText.trim().replace(/[:'\\]/g, '');
      filters.push(
        `[${vLabel}]drawtext=text='${safeWm}':fontsize=34:fontcolor=white@0.75:box=1:boxcolor=black@0.35:x=40:y=40[vwm]`,
      );
      vLabel = 'vwm';
    }

    const rawCues =
      req.subtitleCues && req.subtitleCues.length > 0
        ? req.subtitleCues
        : req.pinnedClipId
          ? getPinnedClip(req.pinnedClipId)?.subtitles ?? []
          : [];
    const trimStart = Math.max(0, req.inSec ?? 0);
    const shiftedCues = rawCues
      .map((c, i) => ({
        id: i + 1,
        startSec: Math.max(0, (c.startSec - trimStart) / speed),
        endSec: Math.max(0, (c.endSec - trimStart) / speed),
        text: c.text,
        words: c.words
          ?.map((w) => ({
            text: w.text,
            startSec: Math.max(0, (w.startSec - trimStart) / speed),
            endSec: Math.max(0, (w.endSec - trimStart) / speed),
          }))
          .filter((w) => w.endSec > w.startSec),
      }))
      .filter((c) => c.endSec > c.startSec && c.text.trim().length > 0);

    if (shiftedCues.length > 0) {
      const sidecarSrtPath = outPath.replace(/\.mp4$/i, '.srt');
      fs.writeFileSync(sidecarSrtPath, buildSrtContent(shiftedCues), 'utf8');
    }

    let tempAssPath: string | null = null;
    if (req.captionsEnabled && shiftedCues.length > 0) {
      tempAssPath = `${outPath}.ass`;
      writeStyledAssFile(shiftedCues, tempAssPath, {
        colorHex: req.speakerColor,
        ...req.subtitleStyle,
      });
      const escapedAss = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filters.push(`[${vLabel}]ass='${escapedAss}'[vcap]`);
      vLabel = 'vcap';
    } else if (req.captionsEnabled && req.captionText && req.captionText.trim().length > 0) {
      const safeCap = req.captionText.trim().replace(/[:'\\]/g, '');
      const color = req.speakerColor || '#FACC15';
      filters.push(
        `[${vLabel}]drawtext=text='${safeCap}':fontsize=48:fontcolor=${color}:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.72[vcap]`,
      );
      vLabel = 'vcap';
    }

    filters.push(`[${vLabel}]format=yuv420p[vfinal]`);

    // Audio chain: gain + optional -14 LUFS normalize + speed
    const avgGain = Math.max(0.1, (req.audioGains.t1 + req.audioGains.t2 + req.audioGains.t3) / 3);
    const aSteps: string[] = [`volume=${avgGain.toFixed(2)}`];
    if (Math.abs(speed - 1.0) > 0.01) {
      aSteps.push(`atempo=${speed.toFixed(2)}`);
    }
    if (req.normalizeLufs) {
      aSteps.push('loudnorm=I=-14:TP=-1.5:LRA=11');
    }
    filters.push(`[0:a]${aSteps.join(',')}[afinal]`);

    args.push('-filter_complex', filters.join(';'), '-map', '[vfinal]', '-map', '[afinal]');
    args.push('-c:v', encoder);
    if (encoder === 'h264_nvenc') {
      args.push('-preset', 'p4', '-b:v', '12000k');
    } else if (encoder === 'h264_amf') {
      args.push('-quality', 'balanced', '-b:v', '12000k');
    } else if (encoder === 'h264_qsv') {
      args.push('-preset', 'fast', '-b:v', '12000k');
    } else {
      args.push('-preset', 'veryfast', '-crf', '20');
    }
    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath);

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(BINS.ffmpeg, args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        });
        setBelowNormalPriority(proc);
        let stderr = '';
        proc.stderr?.on('data', (c: Buffer) => {
          stderr += c.toString('utf8');
        });
        proc.on('exit', (code) => {
          if (code === 0 && fs.existsSync(outPath)) resolve();
          else reject(new Error(stderr.trim() || `Export exited with code ${code}`));
        });
      });
    } finally {
      if (concatListPath) fs.rmSync(concatListPath, { force: true });
      if (tempAssPath) fs.rmSync(tempAssPath, { force: true });
    }

    const clipLabel = req.pinnedClipId ? getPinnedClip(req.pinnedClipId)?.triggerLabel : undefined;
    const suggestion = generateHookSuggestion(shiftedCues, clipLabel);
    const exportDir = path.dirname(outPath);

    console.log(`[Export] Rendered 9:16 MP4 (${encoder}) -> ${outPath}`);
    return {
      filename: outFilename,
      filePath: outPath,
      exportDir,
      downloadUrl: `/exports/${outFilename}`,
      encoder,
      hookTitle: suggestion.hookTitle,
      hashtags: suggestion.hashtags,
    };
  }
}
