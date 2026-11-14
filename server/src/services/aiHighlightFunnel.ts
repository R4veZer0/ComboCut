import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { BIN_DIR, BINS, DATA_DIR, ensureRuntimeDirs, resolveBufferDir } from '../config/paths.js';
import {
  adjustAiWeights,
  createAiHighlight,
  createTimelineMarker,
  getAiHighlight,
  getAiWeights,
  getSettings,
  listAiHighlights,
  updateAiHighlightStatus,
  type AiHighlightItem,
  type AiSignalBreakdown,
  type AiWeights,
} from '../db/database.js';
import type { ChatMonitor } from './chatMonitor.js';
import type { WasapiAudioManager } from './wasapiAudioManager.js';
import type { PinnedClipManager } from './pinnedClipManager.js';
import { setBelowNormalPriority } from '../utils/process.js';

const WHISPER_HYPE_PATTERN =
  /\b(oh my god|no way|what|let'?s go|clutch|insane|clipped|clip that|bro|holy|gg|win|nice)\b/i;

export interface AiFunnelStatus {
  monitoring: boolean;
  evaluating: boolean;
  whisperAvailable: boolean;
  whisperModelPath: string | null;
  weights: AiWeights;
  lastAudioScore: number;
  lastVisualScore: number;
  lastEvaluatedAt: string | null;
}

export class AiHighlightFunnel extends EventEmitter {
  private monitorTimer: NodeJS.Timeout | null = null;
  private evaluating = false;
  private lastAudioScore = 0;
  private lastVisualScore = 0;
  private lastEvaluatedAt: string | null = null;
  private lastCandidateAt = 0;
  private micBaseline = 0.02;

  constructor(
    private readonly chatMonitor: ChatMonitor,
    private readonly wasapiAudio: WasapiAudioManager,
    private readonly pinnedClips: PinnedClipManager,
  ) {
    super();

    this.wasapiAudio.on('meters', (m: { t1: number; t2: number; t3: number }) => {
      const vocal = Math.max(m.t2, m.t3);
      this.micBaseline = this.micBaseline * 0.96 + vocal * 0.04;
      const ratio = vocal / Math.max(0.01, this.micBaseline, m.t1 * 0.8);
      const score = Math.min(1, Math.max(0, (ratio - 1.5) / 3.5));
      if (score > this.lastAudioScore) {
        this.lastAudioScore = Math.round(score * 1000) / 1000;
      } else {
        this.lastAudioScore = Math.round((this.lastAudioScore * 0.92 + score * 0.08) * 1000) / 1000;
      }
    });
  }

  startMonitoring(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      void this.tick();
    }, 10_000);
    this.emit('status', this.getStatus());
  }

  stopMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.emit('status', this.getStatus());
  }

  private resolveWhisperModel(): string | null {
    const modelsDir = path.join(BIN_DIR, 'models');
    const candidates = ['ggml-small.en-q5_1.bin', 'ggml-large-v3-turbo-q5_0.bin', 'ggml-base.en.bin'];
    for (const name of candidates) {
      const full = path.join(modelsDir, name);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  private async tick(): Promise<void> {
    if (this.evaluating) return;
    if (Date.now() - this.lastCandidateAt < 30_000) return;

    const chatScore = this.chatMonitor.getScore();
    const audioScore = this.lastAudioScore;
    const visualScore = await this.probeRecentVisualAction();
    this.lastVisualScore = visualScore;

    const weights = getAiWeights();
    const preScore =
      chatScore * weights.chat + audioScore * weights.audio + visualScore * weights.visual;

    if (preScore >= 0.85) {
      await this.evaluateCandidate({ chatScore, audioScore, visualScore });
    }
  }

  /**
   * Evaluates a highlight candidate window (or runs an explicit test evaluation).
   * Runs burst Vulkan whisper.cpp transcription (< 1 GB VRAM, unloaded immediately)
   * when the binary + quantized model are present.
   */
  async evaluateCandidate(overrides?: {
    chatScore?: number;
    audioScore?: number;
    visualScore?: number;
    pinDurationSec?: number;
    forceQueue?: boolean;
  }): Promise<AiHighlightItem | null> {
    if (this.evaluating) return null;
    this.evaluating = true;
    this.emit('status', this.getStatus());

    try {
      const chatScore = overrides?.chatScore ?? this.chatMonitor.getScore();
      const audioScore = overrides?.audioScore ?? this.lastAudioScore;
      const visualScore = overrides?.visualScore ?? (await this.probeRecentVisualAction());
      this.lastVisualScore = visualScore;
      this.lastEvaluatedAt = new Date().toISOString();

      let transcript = '';
      let transcriptScore = 0;
      const modelPath = this.resolveWhisperModel();
      const whisperAvailable = fs.existsSync(BINS.whisper) && Boolean(modelPath);

      if (whisperAvailable && modelPath) {
        transcript = await this.runBurstWhisper(modelPath);
        if (transcript.length > 0) {
          const hypeHit = WHISPER_HYPE_PATTERN.test(transcript) ? 0.65 : 0.25;
          const density = Math.min(0.35, transcript.split(/\s+/).length / 80);
          transcriptScore = Math.round(Math.min(1, hypeHit + density) * 1000) / 1000;
        }
      }

      const weights = getAiWeights();
      const totalScore =
        Math.round(
          (chatScore * weights.chat +
            audioScore * weights.audio +
            visualScore * weights.visual +
            transcriptScore * weights.transcript) *
            1000,
        ) / 1000;

      const reasons: string[] = [];
      if (chatScore >= 0.3) reasons.push(`Chat spike (${chatScore.toFixed(2)})`);
      if (audioScore >= 0.3) reasons.push(`Vocal/Audio peak (${audioScore.toFixed(2)})`);
      if (visualScore >= 0.3) reasons.push(`Visual action burst (${visualScore.toFixed(2)})`);
      if (transcriptScore >= 0.3) reasons.push(`Transcript hype (${transcriptScore.toFixed(2)})`);

      if (!overrides?.forceQueue && totalScore < 0.75) {
        return null;
      }

      this.lastCandidateAt = Date.now();

      let pinnedClipId: number | null = null;
      try {
        const clip = await this.pinnedClips.pinFromBuffer({
          triggerSource: 'ai',
          triggerLabel: reasons[0] ?? `AI Candidate (${totalScore.toFixed(2)})`,
          durationSec: overrides?.pinDurationSec ?? 45,
        });
        pinnedClipId = clip.id;
      } catch {
        // Buffer may be empty during synthetic evaluation
      }

      const signals: AiSignalBreakdown = {
        chat: chatScore,
        audio: audioScore,
        visual: visualScore,
        transcript: transcriptScore,
        whisperAvailable,
        reasons,
      };

      const item = createAiHighlight({
        score: totalScore,
        pinnedClipId,
        transcript,
        signals,
      });

      const marker = createTimelineMarker({
        source: 'ai',
        label: `AI Highlight (${totalScore.toFixed(2)})`,
        metadata: { highlightId: item.id, pinnedClipId },
      });

      this.emit('markerCreated', marker);
      this.emit('queueUpdated', listAiHighlights());
      return item;
    } finally {
      this.evaluating = false;
      this.emit('status', this.getStatus());
    }
  }

  private async probeRecentVisualAction(): Promise<number> {
    if (!fs.existsSync(BINS.ffmpeg)) return 0;
    const settings = getSettings();
    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    if (!fs.existsSync(bufferDir)) return 0;

    const segments = fs
      .readdirSync(bufferDir)
      .filter((f) => /^seg_\d+\.ts$/i.test(f))
      .sort()
      .slice(-5); // latest ~10s

    if (segments.length === 0) return 0;

    const listPath = path.join(DATA_DIR, `.scdet_${Date.now()}.txt`);
    ensureRuntimeDirs();
    fs.writeFileSync(
      listPath,
      segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );

    try {
      const cuts = await new Promise<number>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          ['-hide_banner', '-skip_frame', 'nokey', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', 'scdet=threshold=14', '-f', 'null', '-'],
          { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        let count = 0;
        proc.stderr?.on('data', (chunk: Buffer) => {
          const matches = chunk.toString('utf8').match(/lavfi\.scd\.time:/g);
          if (matches) count += matches.length;
        });
        proc.on('exit', () => resolve(count));
      });
      return Math.round(Math.min(1, cuts / 6) * 1000) / 1000;
    } finally {
      fs.rmSync(listPath, { force: true });
    }
  }

  private async runBurstWhisper(modelPath: string): Promise<string> {
    const settings = getSettings();
    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    const segments = fs.existsSync(bufferDir)
      ? fs
          .readdirSync(bufferDir)
          .filter((f) => /^seg_\d+\.ts$/i.test(f))
          .sort()
          .slice(-23) // ~45s
      : [];
    if (segments.length === 0 || !fs.existsSync(BINS.ffmpeg)) return '';

    ensureRuntimeDirs();
    const listPath = path.join(DATA_DIR, `.whisper_list_${Date.now()}.txt`);
    const wavPath = path.join(DATA_DIR, `.whisper_slice_${Date.now()}.wav`);
    fs.writeFileSync(
      listPath,
      segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );

    try {
      const wavOk = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-vn', '-ar', '16000', '-ac', '1', wavPath],
          { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        proc.on('exit', (code) => resolve(code === 0 && fs.existsSync(wavPath)));
      });
      if (!wavOk) return '';

      // Burst inference: whisper-cli.exe exits immediately after transcription, unloading VRAM
      return await new Promise<string>((resolve) => {
        const proc = spawn(
          BINS.whisper,
          ['-m', modelPath, '-f', wavPath, '-nt', '-np'],
          { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        let out = '';
        proc.stdout?.on('data', (c: Buffer) => {
          out += c.toString('utf8');
        });
        proc.on('exit', () => resolve(out.trim()));
      });
    } finally {
      fs.rmSync(listPath, { force: true });
      fs.rmSync(wavPath, { force: true });
    }
  }

  approve(id: number): { item: AiHighlightItem; weights: AiWeights } | null {
    const existing = getAiHighlight(id);
    if (!existing) return null;
    const item = updateAiHighlightStatus(id, 'approved')!;
    const weights = adjustAiWeights(existing.signals, 0.08);
    this.emit('queueUpdated', listAiHighlights());
    this.emit('status', this.getStatus());
    return { item, weights };
  }

  async quickAutoExport(id: number): Promise<{ item: AiHighlightItem; weights: AiWeights } | null> {
    const existing = getAiHighlight(id);
    if (!existing) return null;
    let exportPath = '';
    if (existing.pinnedClipId) {
      exportPath = await this.pinnedClips.quickExport(existing.pinnedClipId);
    }
    const item = updateAiHighlightStatus(id, 'auto_exported', exportPath)!;
    const weights = adjustAiWeights(existing.signals, 0.12);
    this.emit('queueUpdated', listAiHighlights());
    this.emit('status', this.getStatus());
    return { item, weights };
  }

  dismiss(id: number): { item: AiHighlightItem; weights: AiWeights } | null {
    const existing = getAiHighlight(id);
    if (!existing) return null;
    const item = updateAiHighlightStatus(id, 'dismissed')!;
    const weights = adjustAiWeights(existing.signals, -0.08);
    this.emit('queueUpdated', listAiHighlights());
    this.emit('status', this.getStatus());
    return { item, weights };
  }

  listQueue(): AiHighlightItem[] {
    return listAiHighlights();
  }

  getStatus(): AiFunnelStatus {
    const modelPath = this.resolveWhisperModel();
    return {
      monitoring: Boolean(this.monitorTimer),
      evaluating: this.evaluating,
      whisperAvailable: fs.existsSync(BINS.whisper) && Boolean(modelPath),
      whisperModelPath: modelPath,
      weights: getAiWeights(),
      lastAudioScore: this.lastAudioScore,
      lastVisualScore: this.lastVisualScore,
      lastEvaluatedAt: this.lastEvaluatedAt,
    };
  }
}
