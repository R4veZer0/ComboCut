import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { BIN_DIR, BINS, RUNTIME_DIR } from '../config/paths.js';
import {
  getPinnedClip,
  getSettings,
  updatePinnedClipSubtitles,
  type PinnedClip,
  type SubtitleCue,
  type SubtitleWord,
  type WhisperModelId,
} from '../db/database.js';
import { setBelowNormalPriority } from '../utils/process.js';

export interface WhisperModelSpec {
  id: WhisperModelId;
  label: string;
  filename: string;
  url: string;
  approxSizeMb: number;
}

export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelSpec> = {
  'base.en': {
    id: 'base.en',
    label: 'Base English (Fast, ~148 MB)',
    filename: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    approxSizeMb: 148,
  },
  small: {
    id: 'small',
    label: 'Small Multilingual (Balanced, ~488 MB)',
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    approxSizeMb: 488,
  },
  'large-v3-turbo': {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo Q5_0 (Best Accuracy, ~574 MB)',
    filename: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    approxSizeMb: 574,
  },
};

export interface WhisperDownloadState {
  model: WhisperModelId | null;
  downloading: boolean;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export const subtitleEvents = new EventEmitter();

let downloadState: WhisperDownloadState = {
  model: null,
  downloading: false,
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
};

export function getWhisperDownloadState(): WhisperDownloadState {
  return { ...downloadState };
}

export interface SubtitleStyle {
  fontSize?: number;
  colorHex?: string;
  verticalPos?: 'top' | 'middle' | 'bottom';
}

function getModelsDir(): string {
  return path.join(RUNTIME_DIR, 'models');
}

function resolveExistingModelPath(spec: WhisperModelSpec): string | null {
  const userDataModel = path.join(getModelsDir(), spec.filename);
  if (fs.existsSync(userDataModel) && fs.statSync(userDataModel).size > 10_000_000) {
    return userDataModel;
  }
  const bundledModel = path.join(BIN_DIR, 'models', spec.filename);
  if (fs.existsSync(bundledModel) && fs.statSync(bundledModel).size > 10_000_000) {
    return bundledModel;
  }
  return null;
}

export function listWhisperModels() {
  const activeId = getSettings().whisperModel;
  return (Object.values(WHISPER_MODELS) as WhisperModelSpec[]).map((spec) => {
    const existing = resolveExistingModelPath(spec);
    return {
      id: spec.id,
      label: spec.label,
      filename: spec.filename,
      approxSizeMb: spec.approxSizeMb,
      downloaded: Boolean(existing),
      sizeBytes: existing ? fs.statSync(existing).size : 0,
      active: spec.id === activeId,
    };
  });
}

function formatSrtTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function parseSrtTimestamp(raw: string): number {
  const match = raw.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const ms = Number(match[4].padEnd(3, '0').slice(0, 3));
  return h * 3600 + m * 60 + s + ms / 1000;
}

export function distributeWordsEvenly(text: string, startSec: number, endSec: number): SubtitleWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const total = Math.max(0.1, endSec - startSec);
  const step = total / tokens.length;
  return tokens.map((word, idx) => ({
    text: word,
    startSec: Math.round((startSec + idx * step) * 100) / 100,
    endSec: Math.round((startSec + (idx + 1) * step) * 100) / 100,
  }));
}

export function parseSrtContent(content: string): SubtitleCue[] {
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const cues: SubtitleCue[] = [];
  let idx = 1;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLineIdx = lines[0].includes('-->') ? 0 : 1;
    const timeLine = lines[timeLineIdx];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [startRaw, endRaw] = timeLine.split('-->');
    const text = lines.slice(timeLineIdx + 1).join(' ').trim();
    if (!text) continue;
    const startSec = Math.round(parseSrtTimestamp(startRaw) * 100) / 100;
    const endSec = Math.round(parseSrtTimestamp(endRaw) * 100) / 100;
    cues.push({
      id: idx++,
      startSec,
      endSec,
      text,
      words: distributeWordsEvenly(text, startSec, endSec),
    });
  }
  return cues;
}

interface WhisperJsonToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

interface WhisperJsonSegment {
  offsets?: { from?: number; to?: number };
  text?: string;
  tokens?: WhisperJsonToken[];
}

function extractWordsFromWhisperJson(jsonPath: string): SubtitleCue[] | null {
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      transcription?: WhisperJsonSegment[];
    };
    const segments = parsed.transcription;
    if (!Array.isArray(segments) || segments.length === 0) return null;

    const cues: SubtitleCue[] = [];
    let cueId = 1;

    for (const seg of segments) {
      const segText = String(seg.text ?? '').trim();
      if (!segText) continue;
      const segStart = Math.max(0, (seg.offsets?.from ?? 0) / 1000);
      const segEnd = Math.max(segStart + 0.1, (seg.offsets?.to ?? segStart * 1000 + 500) / 1000);

      const words: SubtitleWord[] = [];
      for (const tok of seg.tokens ?? []) {
        const rawTok = String(tok.text ?? '');
        if (!rawTok || /^\[_.*\]$/.test(rawTok.trim())) continue;
        const tStart = Math.max(segStart, (tok.offsets?.from ?? segStart * 1000) / 1000);
        const tEnd = Math.max(tStart + 0.05, (tok.offsets?.to ?? tStart * 1000 + 150) / 1000);
        const startsNewWord = rawTok.startsWith(' ') || words.length === 0;
        const cleanPiece = rawTok.trim();
        if (!cleanPiece) continue;

        if (startsNewWord) {
          words.push({
            text: cleanPiece,
            startSec: Math.round(tStart * 100) / 100,
            endSec: Math.round(tEnd * 100) / 100,
          });
        } else {
          const prev = words[words.length - 1];
          prev.text += cleanPiece;
          prev.endSec = Math.max(prev.endSec, Math.round(tEnd * 100) / 100);
        }
      }

      cues.push({
        id: cueId++,
        startSec: Math.round(segStart * 100) / 100,
        endSec: Math.round(segEnd * 100) / 100,
        text: segText,
        words: words.length > 0 ? words : distributeWordsEvenly(segText, segStart, segEnd),
      });
    }

    return cues.length > 0 ? cues : null;
  } catch {
    return null;
  }
}

export function buildSrtContent(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\r\n${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}\r\n${cue.text.trim()}\r\n`)
    .join('\r\n');
}

function hexToAssBgr(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return '&H0015CCFA';
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

export function writeStyledAssFile(cues: SubtitleCue[], outPath: string, style?: SubtitleStyle): void {
  const fontSize = Math.min(96, Math.max(24, Math.round(style?.fontSize ?? 52)));
  const activeColor = hexToAssBgr(style?.colorHex ?? '#facc15');
  const pos = style?.verticalPos ?? 'bottom';
  // Alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center
  const alignment = pos === 'top' ? 8 : pos === 'middle' ? 5 : 2;
  const marginV = pos === 'top' ? 160 : pos === 'middle' ? 0 : 340;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${activeColor},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = cues
    .filter((c) => c.text.trim().length > 0 && c.endSec > c.startSec)
    .map((c) => {
      const words = c.words && c.words.length > 0 ? c.words : distributeWordsEvenly(c.text, c.startSec, c.endSec);
      if (words.length === 0) {
        const safeText = c.text.replace(/\r?\n/g, '\\N');
        return `Dialogue: 0,${formatAssTime(c.startSec)},${formatAssTime(c.endSec)},Default,,0,0,0,,${safeText}`;
      }

      const parts: string[] = [];
      let cursor = c.startSec;
      for (const w of words) {
        const gapCs = Math.max(0, Math.round((w.startSec - cursor) * 100));
        if (gapCs > 0) {
          parts.push(`{\\k${gapCs}}`);
        }
        const durCs = Math.max(5, Math.round((w.endSec - Math.max(cursor, w.startSec)) * 100));
        const safeWord = w.text.replace(/[{}\r\n]/g, '');
        parts.push(`{\\k${durCs}\\t(0,80,\\fscx114\\fscy114)\\t(80,180,\\fscx100\\fscy100)}${safeWord} `);
        cursor = Math.max(cursor, w.endSec);
      }

      return `Dialogue: 0,${formatAssTime(c.startSec)},${formatAssTime(c.endSec)},Default,,0,0,0,,${parts.join('').trimEnd()}`;
    })
    .join('\n');

  fs.writeFileSync(outPath, `${header}${events}\n`, 'utf8');
}

export async function ensureWhisperModel(modelId?: WhisperModelId): Promise<string> {
  const chosenId = modelId ?? getSettings().whisperModel ?? 'base.en';
  const spec = WHISPER_MODELS[chosenId] ?? WHISPER_MODELS['base.en'];
  const existing = resolveExistingModelPath(spec);
  if (existing) {
    return existing;
  }

  const userDataModel = path.join(getModelsDir(), spec.filename);
  fs.mkdirSync(getModelsDir(), { recursive: true });
  const partPath = `${userDataModel}.part`;
  console.log(`[Subtitles] Downloading ${spec.filename} to ${userDataModel}...`);

  downloadState = {
    model: spec.id,
    downloading: true,
    percent: 0,
    downloadedBytes: 0,
    totalBytes: spec.approxSizeMb * 1024 * 1024,
  };
  subtitleEvents.emit('download', getWhisperDownloadState());

  const res = await fetch(spec.url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    downloadState = {
      ...downloadState,
      downloading: false,
      error: `Failed to download ${spec.filename}: HTTP ${res.status}`,
    };
    subtitleEvents.emit('download', getWhisperDownloadState());
    throw new Error(downloadState.error);
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (contentLength > 0) {
    downloadState.totalBytes = contentLength;
  }

  const fileStream = fs.createWriteStream(partPath);
  const reader = res.body.getReader();
  let lastEmitAt = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        fileStream.write(Buffer.from(value));
        downloadState.downloadedBytes += value.byteLength;
        if (downloadState.totalBytes > 0) {
          downloadState.percent = Math.min(99, Math.round((downloadState.downloadedBytes / downloadState.totalBytes) * 100));
        }
        const now = Date.now();
        if (now - lastEmitAt > 400) {
          lastEmitAt = now;
          subtitleEvents.emit('download', getWhisperDownloadState());
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    fs.renameSync(partPath, userDataModel);
    downloadState = {
      model: spec.id,
      downloading: false,
      percent: 100,
      downloadedBytes: downloadState.downloadedBytes,
      totalBytes: downloadState.downloadedBytes,
    };
    subtitleEvents.emit('download', getWhisperDownloadState());
  } catch (err) {
    fileStream.destroy();
    fs.rmSync(partPath, { force: true });
    downloadState = {
      ...downloadState,
      downloading: false,
      error: err instanceof Error ? err.message : String(err),
    };
    subtitleEvents.emit('download', getWhisperDownloadState());
    throw err;
  }

  console.log(`[Subtitles] Downloaded ${spec.filename}`);
  return userDataModel;
}

export async function ensureWhisperBaseModel(): Promise<string> {
  return ensureWhisperModel('base.en');
}

export async function generateSubtitlesForClip(clipId: number): Promise<{
  clip: PinnedClip;
  cues: SubtitleCue[];
  srtPath: string;
}> {
  const clip = getPinnedClip(clipId);
  if (!clip || !fs.existsSync(clip.filePath)) {
    throw new Error('Clip file not found');
  }
  if (!fs.existsSync(BINS.ffmpeg)) {
    throw new Error('ffmpeg.exe not found in /bin');
  }
  if (!fs.existsSync(BINS.whisper)) {
    throw new Error('whisper-cli.exe not found in /bin');
  }

  const modelPath = await ensureWhisperModel();
  const wavPath = `${clip.filePath}.16k.wav`;
  const srtPrefix = clip.filePath.replace(/\.mp4$/i, '');
  const srtPath = `${srtPrefix}.srt`;
  const jsonPath = `${srtPrefix}.json`;

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        BINS.ffmpeg,
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', clip.filePath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      );
      setBelowNormalPriority(proc);
      let stderr = '';
      proc.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
      });
      proc.on('exit', (code) => {
        if (code === 0 && fs.existsSync(wavPath)) resolve();
        else reject(new Error(stderr.trim() || `FFmpeg WAV extraction failed (code=${code})`));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        BINS.whisper,
        ['-m', modelPath, '-f', wavPath, '-osrt', '-ojf', '-of', srtPrefix, '-ml', '42', '-sow'],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      setBelowNormalPriority(proc);
      let stderr = '';
      proc.stdout?.resume();
      proc.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
      });
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `whisper-cli.exe failed (code=${code})`));
      });
    });

    const jsonCues = extractWordsFromWhisperJson(jsonPath);
    const rawSrt = fs.existsSync(srtPath) ? fs.readFileSync(srtPath, 'utf8') : '';
    const cues = jsonCues ?? parseSrtContent(rawSrt);
    if (cues.length > 0 && !fs.existsSync(srtPath)) {
      fs.writeFileSync(srtPath, buildSrtContent(cues), 'utf8');
    }
    const updated = updatePinnedClipSubtitles(clipId, cues, srtPath)!;
    return { clip: updated, cues, srtPath };
  } finally {
    fs.rmSync(wavPath, { force: true });
    fs.rmSync(jsonPath, { force: true });
  }
}

export function saveEditedSubtitles(
  clipId: number,
  cues: SubtitleCue[],
): { clip: PinnedClip; cues: SubtitleCue[]; srtPath: string } {
  const clip = getPinnedClip(clipId);
  if (!clip) {
    throw new Error('Clip not found');
  }
  const normalized = cues.map((c, idx) => {
    const startSec = Math.max(0, Number(c.startSec) || 0);
    const endSec = Math.max(0, Number(c.endSec) || 0);
    const text = String(c.text ?? '').trim();
    return {
      id: idx + 1,
      startSec,
      endSec,
      text,
      words: distributeWordsEvenly(text, startSec, endSec),
    };
  });
  const srtPath = clip.srtPath || clip.filePath.replace(/\.mp4$/i, '.srt');
  fs.writeFileSync(srtPath, buildSrtContent(normalized), 'utf8');
  const updated = updatePinnedClipSubtitles(clipId, normalized, srtPath)!;
  return { clip: updated, cues: normalized, srtPath };
}
