import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { BIN_DIR, BINS, DATA_DIR, RUNTIME_DIR, ensureRuntimeDirs, resolveBufferDir } from '../config/paths.js';
import {
  adjustAiWeights,
  createAiHighlight,
  createTimelineMarker,
  getAiHighlight,
  getAiWeights,
  getPinnedClip,
  getSettings,
  listAiHighlights,
  listPinnedClips,
  updateAiHighlightDetails,
  updateAiHighlightStatus,
  updatePinnedClipStatus,
  type AiDetectionMode,
  type AiHighlightItem,
  type AiSensitivity,
  type AiSignalBreakdown,
  type AiWeights,
} from '../db/database.js';
import type { ChatMonitor } from './chatMonitor.js';
import type { WasapiAudioManager } from './wasapiAudioManager.js';
import type { PinnedClipManager } from './pinnedClipManager.js';
import { VisualAiClassifier } from './visualAiClassifier.js';
import { getCachedGpuEncoder } from './gpuDetector.js';
import { setBelowNormalPriority } from '../utils/process.js';
import { describeClipLocally, judgeAndDescribeClip } from '../ai/clipDescriber.js';
import {
  RollingContextTimeline,
  filterGameCharacterBarks,
  type VisualSceneState,
} from '../ai/contextTimeline.js';

const WHISPER_HYPE_PATTERN =
  /\b(oh my god|no way|what|let'?s go|clutch|insane|clipped|clip that|bro|holy|gg|win|nice)\b/i;

export interface AiFunnelStatus {
  monitoring: boolean;
  evaluating: boolean;
  mode: AiDetectionMode;
  sensitivity: AiSensitivity;
  whisperAvailable: boolean;
  whisperModelPath: string | null;
  weights: AiWeights;
  lastAudioScore: number;
  lastVisualScore: number;
  audioScore: number;
  vocalScore: number;
  visualScore: number;
  combinedScore: number;
  threshold: number;
  lastDecision: string;
  visualEngineStatus: string;
  visualEngineError: string | null;
  lastEvaluatedAt: string | null;
}

export class AiHighlightFunnel extends EventEmitter {
  private monitorTimer: NodeJS.Timeout | null = null;
  private evaluating = false;
  private lastAudioScore = 0;
  private lastVocalScore = 0;
  private lastVisualScore = 0;
  private lastCombinedScore = 0;
  private lastThreshold = 1.05;
  private lastDecision = 'Idle';
  private lastEvaluatedAt: string | null = null;
  private lastCandidateAt = 0;
  private micBaseline = 0.02;
  private latestGameMeter = 0;
  private latestHumanMeter = 0;
  private readonly fullAudioHistory: Array<{ ts: number; db: number }> = [];
  private readonly vocalAudioHistory: Array<{ ts: number; db: number }> = [];
  private activeSourceCheck: (() => boolean) | null = null;
  private lastScannedSegment = '';
  private readonly visualClassifier = new VisualAiClassifier();
  private readonly timeline = new RollingContextTimeline();

  constructor(
    private readonly chatMonitor: ChatMonitor,
    private readonly wasapiAudio: WasapiAudioManager,
    private readonly pinnedClips: PinnedClipManager,
  ) {
    super();

    this.wasapiAudio.on('meters', (m: { t1: number; t2: number; t3: number }) => {
      const vocal = Math.max(m.t2, m.t3);
      this.latestGameMeter = Math.max(this.latestGameMeter * 0.85, m.t1);
      this.latestHumanMeter = Math.max(this.latestHumanMeter * 0.85, vocal);
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

  setActiveSourceCheck(fn: () => boolean): void {
    this.activeSourceCheck = fn;
  }

  startMonitoring(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      void this.tick();
    }, 6_000);
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
    const candidates = ['ggml-small.en-q5_1.bin', 'ggml-small.bin', 'ggml-large-v3-turbo-q5_0.bin', 'ggml-base.en.bin'];
    for (const dir of [path.join(RUNTIME_DIR, 'models'), path.join(BIN_DIR, 'models')]) {
      for (const name of candidates) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) return full;
      }
    }
    return null;
  }

  private getSensitivityThreshold(sensitivity: AiSensitivity): number {
    if (sensitivity === 'high_recall') return 0.85;
    if (sensitivity === 'strict') return 1.25;
    return 1.05;
  }

  private computeCombinedScore(
    mode: AiDetectionMode,
    vocalScore: number,
    audioScore: number,
    visualScore: number,
    chatScore: number,
    chatWeight: number,
  ): number {
    let raw = 0;
    if (mode === 'audio_only') {
      raw = vocalScore * 0.75 + audioScore * 0.6 + chatScore * chatWeight;
    } else if (mode === 'visual_only') {
      raw = visualScore * 1.15 + chatScore * chatWeight;
    } else {
      raw = vocalScore * 0.65 + audioScore * 0.45 + visualScore * 0.55 + chatScore * chatWeight;
    }
    return Math.round(raw * 1000) / 1000;
  }

  private updateAndGet25thPercentileFloor(
    history: Array<{ ts: number; db: number }>,
    sampleDb: number,
    defaultDb: number,
  ): number {
    const now = Date.now();
    while (history.length > 0 && now - history[0].ts > 60_000) {
      history.shift();
    }
    if (sampleDb > -65 && sampleDb < -3) {
      history.push({ ts: now, db: sampleDb });
      if (history.length > 30) history.shift();
    }
    if (history.length < 2) return defaultDb;
    const sorted = history.map((h) => h.db).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.25)];
  }

  private async tick(): Promise<void> {
    if (this.evaluating) return;
    const settings = getSettings();
    const threshold = this.getSensitivityThreshold(settings.aiSensitivity);
    this.lastThreshold = threshold;
    if (settings.aiDetectionMode === 'off') {
      this.lastDecision = 'Off (Manual Only)';
      return;
    }
    if (this.activeSourceCheck && !this.activeSourceCheck()) {
      this.lastDecision = 'Waiting for active stream';
      return;
    }
    const elapsedSinceClip = Date.now() - this.lastCandidateAt;
    if (this.lastCandidateAt > 0 && elapsedSinceClip < 25_000) {
      const remSec = Math.ceil((25_000 - elapsedSinceClip) / 1000);
      this.lastDecision = `Cooldown (${remSec}s)`;
      this.emit('status', this.getStatus());
      return;
    }

    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    if (!fs.existsSync(bufferDir)) return;
    const segments = fs
      .readdirSync(bufferDir)
      .filter((f) => /^seg_\d+\.ts$/i.test(f))
      .sort();
    if (segments.length === 0) return;
    const newest = segments[segments.length - 1];
    if (newest === this.lastScannedSegment) return;
    this.lastScannedSegment = newest;

    const runAudio = settings.aiDetectionMode === 'audio_visual' || settings.aiDetectionMode === 'audio_only';
    const runVisual = settings.aiDetectionMode === 'audio_visual' || settings.aiDetectionMode === 'visual_only';

    const chatScore = this.chatMonitor.getScore();
    const newestPath = path.join(bufferDir, newest);

    // Stage 1a: Fast single-pass FFmpeg full-spectrum + 300-3400Hz vocal-band probe
    const gate = await this.probeCandidateTriggerGate(newestPath, runAudio);
    const audioScore = runAudio ? gate.audioScore : 0;
    const vocalScore = runAudio ? gate.vocalScore : 0;

    const isOffAir = settings.appMode === 'offair';
    const gameAudioEnergy = isOffAir && gate.hasMultiTrackSignal ? this.latestGameMeter : audioScore;
    const humanVocalEnergy = vocalScore;

    // Record baseline segment in Rolling Context Timeline
    this.timeline.upsert({
      segmentName: newest,
      timestampMs: Date.now(),
      gameAudioEnergy,
      humanVocalEnergy,
      hasHumanSpeech: humanVocalEnergy >= 0.25,
      sceneState: 'calm',
      combatProb: 0,
      hudBannerProb: 0,
      chaosProb: 0,
      reactionProb: 0,
      negativeProbSum: 1,
      transcriptSnippet: '',
    });

    let visualScore = 0;
    let isStaticMenu = false;
    let visualReasons: string[] = [];
    let visualProbs: {
      combatProb?: number;
      hudBannerProb?: number;
      chaosProb?: number;
      reactionProb?: number;
    } = {};

    if (runVisual) {
      const cls = await this.visualClassifier.classifySegment(newestPath, settings.aiVisualFocus);
      const sceneState: VisualSceneState = cls.rejected
        ? 'menu'
        : cls.combatProb >= 0.6
          ? 'combat'
          : cls.hudBannerProb >= 0.35
            ? 'hud_banner'
            : cls.chaosProb >= 0.45
              ? 'chaos'
              : cls.reactionProb >= 0.35
                ? 'reaction'
                : 'calm';
      this.timeline.upsert({
        segmentName: newest,
        timestampMs: Date.now(),
        gameAudioEnergy,
        humanVocalEnergy,
        hasHumanSpeech: humanVocalEnergy >= 0.25,
        sceneState,
        combatProb: cls.combatProb,
        hudBannerProb: cls.hudBannerProb,
        chaosProb: cls.chaosProb,
        reactionProb: cls.reactionProb,
        negativeProbSum: cls.negativeProbSum,
        transcriptSnippet: '',
      });
      isStaticMenu = cls.rejected && cls.negativeProbSum >= 0.65;
      if (!cls.rejected) {
        visualScore = cls.score;
        visualReasons = cls.reasons;
        visualProbs = {
          combatProb: cls.combatProb,
          hudBannerProb: cls.hudBannerProb,
          chaosProb: cls.chaosProb,
          reactionProb: cls.reactionProb,
        };
      }
    }

    const weights = getAiWeights();
    const combinedScore = this.computeCombinedScore(
      settings.aiDetectionMode,
      vocalScore,
      audioScore,
      visualScore,
      chatScore,
      weights.chat,
    );

    this.lastAudioScore = audioScore;
    this.lastVocalScore = vocalScore;
    this.lastVisualScore = visualScore;
    this.lastCombinedScore = combinedScore;
    this.lastEvaluatedAt = new Date().toISOString();

    if (combinedScore >= threshold) {
      this.lastDecision = `Clipped (${combinedScore.toFixed(2)} >= ${threshold.toFixed(2)})`;
      this.emit('status', this.getStatus());
      await this.evaluateCandidate({
        chatScore,
        audioScore,
        vocalScore,
        visualScore,
        combinedScore,
        visualReasons,
        ...visualProbs,
        peakSegmentName: newest,
        humanVocalEnergy,
        gameAudioEnergy,
        meanAudioDb: gate.fullMeanDb,
        isStaticMenu,
        forceQueue: true,
      });
    } else {
      this.lastDecision = `Monitoring (${combinedScore.toFixed(2)} < ${threshold.toFixed(2)})`;
      this.emit('status', this.getStatus());
    }
  }

  /**
   * Near-zero-cost Candidate Trigger Gate:
   * (a) Single-pass FFmpeg full-spectrum + 300-3400Hz vocal-band RMS & 25th-percentile floor
   * (b) Keyframe-only d3d11va center-50% / top-right HUD flash (ignores routine camera panning)
   */
  private async probeCandidateTriggerGate(
    segmentPath: string,
    checkAudio: boolean,
  ): Promise<{
    triggered: boolean;
    audioScore: number;
    vocalScore: number;
    fullMeanDb: number;
    hasMultiTrackSignal: boolean;
  }> {
    if (!fs.existsSync(BINS.ffmpeg) || !fs.existsSync(segmentPath)) {
      return { triggered: false, audioScore: 0, vocalScore: 0, fullMeanDb: -60, hasMultiTrackSignal: false };
    }

    let audioScore = 0;
    let vocalScore = 0;
    let fullMeanDb = -60;
    let sustainedAudioOrVocal = false;
    let hasMultiTrackSignal = false;

    if (checkAudio) {
      const { fullMean, fullMax, vocalMean } = await new Promise<{
        fullMean: number;
        fullMax: number;
        vocalMean: number;
      }>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          [
            '-hide_banner',
            '-i',
            segmentPath,
            '-vn',
            '-filter_complex',
            '[0:a]asplit=2[full][voc];[full]volumedetect[aout];[voc]highpass=f=300,lowpass=f=3400,volumedetect[vout]',
            '-map',
            '[aout]',
            '-f',
            'null',
            '-',
            '-map',
            '[vout]',
            '-f',
            'null',
            '-',
          ],
          { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        let stderr = '';
        proc.stderr?.on('data', (c: Buffer) => {
          stderr += c.toString('utf8');
        });
        proc.on('close', () => {
          const meanMatches = [...stderr.matchAll(/mean_volume:\s*([-\d.]+)\s*dB/gi)];
          const maxMatches = [...stderr.matchAll(/max_volume:\s*([-\d.]+)\s*dB/gi)];
          const fMean = meanMatches[0] ? Number.parseFloat(meanMatches[0][1]) : -60;
          const fMax = maxMatches[0] ? Number.parseFloat(maxMatches[0][1]) : -60;
          const vMean = meanMatches[1] ? Number.parseFloat(meanMatches[1][1]) : fMean;
          resolve({ fullMean: fMean, fullMax: fMax, vocalMean: vMean });
        });
      });

      fullMeanDb = fullMean;
      const fullFloorDb = this.updateAndGet25thPercentileFloor(this.fullAudioHistory, fullMean, -34);
      const vocalFloorDb = this.updateAndGet25thPercentileFloor(this.vocalAudioHistory, vocalMean, -36);

      const fullDelta = fullMean - fullFloorDb;
      const vocalDelta = vocalMean - vocalFloorDb;

      const fullDeltaPart = Math.min(1, Math.max(0, (fullDelta - 1.5) / 10));
      const fullLevelPart = Math.min(1, Math.max(0, (fullMean + 32) / 18));
      const peakBoost = fullMax >= -10 ? 0.25 : fullMax >= -16 ? 0.12 : 0;
      audioScore = Math.round(Math.min(1, Math.max(fullDeltaPart, fullLevelPart * 0.75) + peakBoost) * 1000) / 1000;

      const vocalDeltaPart = Math.min(1, Math.max(0, (vocalDelta - 1.5) / 9));
      const vocalLevelPart = Math.min(1, Math.max(0, (vocalMean + 34) / 18));
      vocalScore = Math.round(Math.min(1, Math.max(vocalDeltaPart, vocalLevelPart * 0.8)) * 1000) / 1000;

      // Auto-detect whether multi-track WASAPI inputs (Track 2 Discord / Track 3 Mic) carry real signal (> -55 dB)
      const wasapiStatus = this.wasapiAudio.getStatus();
      const wasapiVocalPeak = Math.max(this.latestHumanMeter, wasapiStatus.meters.t2, wasapiStatus.meters.t3);
      hasMultiTrackSignal = wasapiStatus.running && wasapiVocalPeak > 0.005;
      if (hasMultiTrackSignal) {
        const wasapiVocalScore = Math.min(1, Math.max(0, (wasapiVocalPeak - 0.02) / 0.28));
        vocalScore = Math.round(Math.max(vocalScore, wasapiVocalScore) * 1000) / 1000;
      }

      sustainedAudioOrVocal =
        audioScore >= 0.35 ||
        vocalScore >= 0.35 ||
        (fullDelta >= 4 && fullMax >= -16) ||
        vocalDelta >= 4;
    }

    return {
      triggered: sustainedAudioOrVocal,
      audioScore,
      vocalScore,
      fullMeanDb,
      hasMultiTrackSignal,
    };
  }

  /**
   * Evaluates a highlight candidate window (or runs an explicit test evaluation).
   * Immediately stream-copies (-c copy) the dynamic 15s-180s window into /pinned,
   * then runs burst Whisper asynchronously in the background when enabled by mode.
   */
  async evaluateCandidate(overrides?: {
    chatScore?: number;
    audioScore?: number;
    vocalScore?: number;
    visualScore?: number;
    combinedScore?: number;
    visualReasons?: string[];
    combatProb?: number;
    hudBannerProb?: number;
    chaosProb?: number;
    reactionProb?: number;
    peakSegmentName?: string;
    humanVocalEnergy?: number;
    gameAudioEnergy?: number;
    meanAudioDb?: number;
    isStaticMenu?: boolean;
    pinDurationSec?: number;
    forceQueue?: boolean;
  }): Promise<AiHighlightItem | null> {
    if (this.evaluating) return null;
    this.evaluating = true;
    this.emit('status', this.getStatus());

    try {
      const settings = getSettings();
      const mode = settings.aiDetectionMode;
      const runAudio = mode !== 'visual_only';
      const runVisual = mode !== 'audio_only';

      const chatScore = overrides?.chatScore ?? this.chatMonitor.getScore();
      const audioScore = runAudio ? (overrides?.audioScore ?? this.lastAudioScore) : 0;
      const vocalScore = runAudio ? (overrides?.vocalScore ?? this.lastVocalScore) : 0;
      const visualScore = runVisual
        ? (overrides?.visualScore ?? (await this.probeRecentVisualAction()))
        : 0;
      if (runVisual) this.lastVisualScore = visualScore;
      this.lastEvaluatedAt = new Date().toISOString();

      const weights = getAiWeights();
      const totalScore =
        overrides?.combinedScore ??
        this.computeCombinedScore(mode, vocalScore, audioScore, visualScore, chatScore, weights.chat);

      const reasons: string[] = [...(overrides?.visualReasons ?? [])];
      if (chatScore >= 0.3) reasons.push(`Chat spike (${chatScore.toFixed(2)})`);
      if (vocalScore >= 0.3) reasons.push(`Vocal surge (${vocalScore.toFixed(2)})`);
      if (audioScore >= 0.3) reasons.push(`Audio impact (${audioScore.toFixed(2)})`);
      if (visualScore >= 0.3 && reasons.length === 0) {
        reasons.push(`Visual action burst (${visualScore.toFixed(2)})`);
      }

      const threshold = this.getSensitivityThreshold(settings.aiSensitivity);
      this.lastThreshold = threshold;
      this.lastCombinedScore = totalScore;
      if (!overrides?.forceQueue && totalScore < threshold) {
        this.lastDecision = `Below threshold (${totalScore.toFixed(2)} < ${threshold.toFixed(2)})`;
        return null;
      }

      this.lastCandidateAt = Date.now();
      this.lastDecision = `Clipped (${totalScore.toFixed(2)} >= ${threshold.toFixed(2)})`;

      // Autonomous Narrative & Action Arc Boundary Finder (Slice-First, no pre-slice Whisper)
      const dynamicWindow = this.findDynamicSegmentWindow(
        settings.aiMaxClipSec,
        overrides?.pinDurationSec,
        overrides?.peakSegmentName,
      );

      let pinnedClipId: number | null = null;
      let pinnedFilePath: string | null = null;
      try {
        const clip = await this.pinnedClips.pinFromBuffer({
          triggerSource: 'ai',
          triggerLabel: reasons[0] ?? `AI Candidate (${totalScore.toFixed(2)})`,
          durationSec: dynamicWindow.durationSec,
          segmentNames: dynamicWindow.segments,
          status: 'pending',
        });
        pinnedClipId = clip.id;
        pinnedFilePath = clip.filePath;
      } catch {
        // Buffer may be empty during synthetic evaluation
      }

      const modelPath = this.resolveWhisperModel();
      const whisperAvailable = runAudio && fs.existsSync(BINS.whisper) && Boolean(modelPath);

      const initialDesc = describeClipLocally({
        transcript: '',
        chatScore,
        audioScore,
        visualScore,
        humanSpeechScore: vocalScore,
        combatProb: overrides?.combatProb,
        hudBannerProb: overrides?.hudBannerProb,
        chaosProb: overrides?.chaosProb,
        reactionProb: overrides?.reactionProb,
        durationSec: dynamicWindow.durationSec,
        reasons,
      });

      const signals: AiSignalBreakdown = {
        chat: chatScore,
        audio: Math.max(audioScore, vocalScore),
        visual: visualScore,
        transcript: 0,
        whisperAvailable,
        reasons,
        headline: initialDesc.headline,
        tags: initialDesc.tags,
        summary: initialDesc.summary,
      };

      const item = createAiHighlight({
        score: totalScore,
        pinnedClipId,
        transcript: '',
        signals,
      });

      const marker = createTimelineMarker({
        source: 'ai',
        label: initialDesc.headline || `AI Highlight (${totalScore.toFixed(2)})`,
        metadata: { highlightId: item.id, pinnedClipId, durationSec: dynamicWindow.durationSec },
      });

      this.emit('markerCreated', marker);
      this.emit('queueUpdated', listAiHighlights());

      // Stage 2: Run burst Whisper asynchronously on the complete sliced .mp4
      if (whisperAvailable && modelPath) {
        void this.enrichHighlightWithWhisper(item.id, modelPath, pinnedFilePath, mode, {
          combatProb: overrides?.combatProb,
          hudBannerProb: overrides?.hudBannerProb,
          chaosProb: overrides?.chaosProb,
          reactionProb: overrides?.reactionProb,
          humanSpeechScore: overrides?.humanVocalEnergy ?? vocalScore,
          gameAudioScore: overrides?.gameAudioEnergy ?? audioScore,
          meanAudioDb: overrides?.meanAudioDb,
          isStaticMenu: overrides?.isStaticMenu,
          isOffAir: settings.appMode === 'offair',
        });
      }

      return item;
    } finally {
      this.evaluating = false;
      this.emit('status', this.getStatus());
    }
  }

  private async enrichHighlightWithWhisper(
    highlightId: number,
    modelPath: string,
    pinnedFilePath: string | null,
    mode: AiDetectionMode,
    ctx?: {
      combatProb?: number;
      hudBannerProb?: number;
      chaosProb?: number;
      reactionProb?: number;
      humanSpeechScore?: number;
      gameAudioScore?: number;
      meanAudioDb?: number;
      isStaticMenu?: boolean;
      isOffAir?: boolean;
    },
  ): Promise<void> {
    try {
      const preferCpuFallback = mode === 'audio_only' && getCachedGpuEncoder()?.selected === 'libx264';
      const rawTranscript = await this.runBurstWhisper(modelPath, pinnedFilePath, preferCpuFallback);

      const existing = getAiHighlight(highlightId);
      if (!existing) return;

      const barkFiltered = filterGameCharacterBarks(
        rawTranscript,
        ctx?.humanSpeechScore ?? existing.signals.audio,
        Boolean(ctx?.isOffAir),
      );
      const transcript = barkFiltered.humanTranscript;

      const refinedDesc = await judgeAndDescribeClip({
        transcript,
        chatScore: existing.signals.chat,
        audioScore: existing.signals.audio,
        visualScore: existing.signals.visual,
        gameAudioScore: ctx?.gameAudioScore,
        humanSpeechScore: ctx?.humanSpeechScore,
        meanAudioDb: ctx?.meanAudioDb,
        isStaticMenu: ctx?.isStaticMenu,
        isOffAir: ctx?.isOffAir,
        hasFullTranscript: true,
        combatProb: ctx?.combatProb,
        hudBannerProb: ctx?.hudBannerProb,
        chaosProb: ctx?.chaosProb,
        reactionProb: ctx?.reactionProb,
        durationSec: existing.clipDurationSec,
        reasons: existing.signals.reasons,
      });

      // Auto-prune false alarms after transcription if neither human narrative nor gameplay climax occurred
      if (!refinedDesc.valid) {
        console.log(`[AI Judge] Auto-pruned #${highlightId}: ${refinedDesc.rejectReason}`);
        if (existing.pinnedClipId) {
          const clip = getPinnedClip(existing.pinnedClipId);
          if (clip && fs.existsSync(clip.filePath)) fs.rmSync(clip.filePath, { force: true });
          updatePinnedClipStatus(existing.pinnedClipId, 'dismissed');
          this.pinnedClips.emit('clipsUpdated', listPinnedClips());
        }
        updateAiHighlightStatus(highlightId, 'dismissed');
        this.emit('queueUpdated', listAiHighlights());
        return;
      }

      const hypeHit = transcript && WHISPER_HYPE_PATTERN.test(transcript) ? 0.65 : transcript ? 0.25 : 0;
      const density = transcript ? Math.min(0.35, barkFiltered.realWordCount / 80) : 0;
      const transcriptScore = Math.round(Math.min(1, hypeHit + density) * 1000) / 1000;
      const weights = getAiWeights();
      const updatedScore =
        Math.round((existing.score + transcriptScore * weights.transcript) * 1000) / 1000;

      const reasons = [...existing.signals.reasons];
      if (transcriptScore >= 0.3 && !reasons.some((r) => r.startsWith('Transcript'))) {
        reasons.push(`Transcript hype (${transcriptScore.toFixed(2)})`);
      }

      updateAiHighlightDetails(highlightId, {
        transcript,
        score: updatedScore,
        signals: {
          ...existing.signals,
          transcript: transcriptScore,
          reasons,
          headline: refinedDesc.headline,
          tags: refinedDesc.tags,
          summary: refinedDesc.summary,
        },
      });
      this.emit('queueUpdated', listAiHighlights());
    } catch {
      // Non-fatal background enrichment
    }
  }

  private findDynamicSegmentWindow(
    maxClipSec: number,
    overrideSec?: number,
    peakSegmentName?: string,
  ): { segments: string[]; durationSec: number } {
    const clampedMax = Math.min(240, Math.max(15, maxClipSec || 180));
    if (overrideSec !== undefined) {
      const clamped = Math.min(clampedMax, Math.max(15, overrideSec));
      return { segments: [], durationSec: clamped };
    }

    const settings = getSettings();
    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    if (!fs.existsSync(bufferDir)) {
      return { segments: [], durationSec: 20 };
    }

    const allSegments = fs
      .readdirSync(bufferDir)
      .filter((f) => /^seg_\d+\.ts$/i.test(f))
      .sort();

    if (allSegments.length === 0) {
      return { segments: [], durationSec: 20 };
    }

    const peakName = peakSegmentName ?? allSegments[allSegments.length - 1];
    const peakIdx = Math.max(0, allSegments.length - 4);
    let startIdx = Math.max(0, peakIdx - 6); // 12s pre-peak default (6 x 2s)

    // Narrative / Discord Joke Arc: if sustained vocal-band activity spans >= 20s before peak,
    // trace backward to the conversational pause (up to 180s / 90 segments).
    const hasNarrativeFlow = this.timeline.hasContinuousNarrativeFlow(peakName);
    if (hasNarrativeFlow) {
      const narrativeStartName = this.timeline.findNarrativeStartSegment(peakName, 90);
      if (narrativeStartName) {
        const idx = allSegments.indexOf(narrativeStartName);
        if (idx >= 0) {
          startIdx = idx;
        }
      }
    }

    // 8s post-peak (4 x 2s segments)
    const endIdx = Math.min(allSegments.length - 1, peakIdx + 4);
    const effectiveMaxSegs = hasNarrativeFlow ? Math.max(8, Math.floor(180 / 2)) : Math.max(8, Math.floor(clampedMax / 2));

    if (endIdx - startIdx + 1 < 8) {
      startIdx = Math.max(0, endIdx - 7);
    }
    if (endIdx - startIdx + 1 > effectiveMaxSegs) {
      startIdx = endIdx - effectiveMaxSegs + 1;
    }

    const selected = allSegments.slice(startIdx, endIdx + 1);
    return {
      segments: selected,
      durationSec: Math.min(240, Math.max(15, selected.length * 2)),
    };
  }

  private async countSpokenWordsInSegments(
    bufferDir: string,
    segments: string[],
    modelPath: string,
  ): Promise<number> {
    if (segments.length === 0 || !fs.existsSync(BINS.ffmpeg)) return 0;
    ensureRuntimeDirs();
    const listPath = path.join(DATA_DIR, `.pre_speech_${Date.now()}.txt`);
    const wavPath = path.join(DATA_DIR, `.pre_speech_${Date.now()}.wav`);
    fs.writeFileSync(
      listPath,
      segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-vn', '-ar', '16000', '-ac', '1', wavPath],
          { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        proc.on('exit', (c) => resolve(c === 0 && fs.existsSync(wavPath)));
      });
      if (!ok) return 0;
      const text = await new Promise<string>((resolve) => {
        const proc = spawn(BINS.whisper, ['-m', modelPath, '-f', wavPath, '-nt', '-np'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
        setBelowNormalPriority(proc);
        let out = '';
        proc.stdout?.on('data', (c: Buffer) => {
          out += c.toString('utf8');
        });
        proc.on('exit', () => resolve(out.trim()));
      });
      return text
        .replace(/\[[^\]]+\]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => /[a-z0-9]/i.test(w)).length;
    } catch {
      return 0;
    } finally {
      fs.rmSync(listPath, { force: true });
      fs.rmSync(wavPath, { force: true });
    }
  }

  private hasSegmentBoundaryBreak(segmentPath: string): Promise<boolean> {
    if (!fs.existsSync(BINS.ffmpeg) || !fs.existsSync(segmentPath)) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const proc = spawn(
        BINS.ffmpeg,
        [
          '-hide_banner',
          '-hwaccel', 'auto',
          '-i', segmentPath,
          '-af', 'silencedetect=noise=-34dB:d=1.5',
          '-vf', 'scdet=threshold=18',
          '-f', 'null',
          '-',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      );
      setBelowNormalPriority(proc);
      let stderr = '';
      proc.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
      });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve(false);
      }, 2000);
      proc.on('close', () => {
        clearTimeout(timer);
        const hasSilence = /silence_end:|silence_start:/i.test(stderr);
        const hasSceneCut = /lavfi\.scd\.time:/i.test(stderr);
        resolve(hasSilence || hasSceneCut);
      });
    });
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
          ['-hide_banner', '-hwaccel', 'auto', '-skip_frame', 'nokey', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', 'scdet=threshold=14', '-f', 'null', '-'],
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

  private async probeRecentBufferAudioSpike(): Promise<number> {
    if (!fs.existsSync(BINS.ffmpeg)) return 0;
    const settings = getSettings();
    const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
    if (!fs.existsSync(bufferDir)) return 0;

    const segments = fs
      .readdirSync(bufferDir)
      .filter((f) => /^seg_\d+\.ts$/i.test(f))
      .sort()
      .slice(-5);
    if (segments.length === 0) return 0;

    const listPath = path.join(DATA_DIR, `.aud_${Date.now()}.txt`);
    ensureRuntimeDirs();
    fs.writeFileSync(
      listPath,
      segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );

    try {
      const maxVolumeDb = await new Promise<number>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          ['-hide_banner', '-hwaccel', 'auto', '-f', 'concat', '-safe', '0', '-i', listPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
          { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        let stderr = '';
        proc.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        proc.on('exit', () => {
          const match = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/i);
          resolve(match ? Number.parseFloat(match[1]) : -60);
        });
      });
      // Map [-30dB .. 0dB] -> [0 .. 1]
      const normalized = Math.min(1, Math.max(0, (maxVolumeDb + 30) / 28));
      return Math.round(normalized * 1000) / 1000;
    } finally {
      fs.rmSync(listPath, { force: true });
    }
  }

  private async runBurstWhisper(
    modelPath: string,
    pinnedFilePath: string | null = null,
    preferCpuFallback = false,
  ): Promise<string> {
    const wavPath = path.join(DATA_DIR, `.whisper_slice_${Date.now()}.wav`);
    ensureRuntimeDirs();

    let sourceArgs: string[];
    let listPath: string | null = null;
    if (pinnedFilePath && fs.existsSync(pinnedFilePath)) {
      sourceArgs = ['-i', pinnedFilePath];
    } else {
      const settings = getSettings();
      const bufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
      const segments = fs.existsSync(bufferDir)
        ? fs
            .readdirSync(bufferDir)
            .filter((f) => /^seg_\d+\.ts$/i.test(f))
            .sort()
            .slice(-23)
        : [];
      if (segments.length === 0 || !fs.existsSync(BINS.ffmpeg)) return '';
      listPath = path.join(DATA_DIR, `.whisper_list_${Date.now()}.txt`);
      fs.writeFileSync(
        listPath,
        segments.map((s) => `file '${path.join(bufferDir, s).replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8',
      );
      sourceArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
    }

    try {
      const wavOk = await new Promise<boolean>((resolve) => {
        const proc = spawn(
          BINS.ffmpeg,
          ['-y', '-hide_banner', '-loglevel', 'error', ...sourceArgs, '-vn', '-ar', '16000', '-ac', '1', wavPath],
          { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
        );
        setBelowNormalPriority(proc);
        proc.on('exit', (code) => resolve(code === 0 && fs.existsSync(wavPath)));
      });
      if (!wavOk) return '';

      // Burst inference: GPU-accelerated whisper-cli.exe (Vulkan/Tensor Cores), with CPU (-ng) fallback
      const runWhisper = (useGpu: boolean) =>
        new Promise<{ code: number | null; text: string }>((resolve) => {
          const wArgs = ['-m', modelPath, '-f', wavPath, '-nt', '-np'];
          if (!useGpu) wArgs.push('-ng');
          const proc = spawn(BINS.whisper, wArgs, {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
          });
          setBelowNormalPriority(proc);
          let out = '';
          proc.stdout?.on('data', (c: Buffer) => {
            out += c.toString('utf8');
          });
          proc.on('exit', (code) => resolve({ code, text: out.trim() }));
        });

      if (!preferCpuFallback) {
        const gpuRes = await runWhisper(true);
        if (gpuRes.code === 0) return gpuRes.text;
      }
      const cpuRes = await runWhisper(false);
      return cpuRes.text;
    } finally {
      if (listPath) fs.rmSync(listPath, { force: true });
      fs.rmSync(wavPath, { force: true });
    }
  }

  approve(id: number): { item: AiHighlightItem; weights: AiWeights; clip: ReturnType<typeof getPinnedClip> } | null {
    const existing = getAiHighlight(id);
    if (!existing) return null;
    const item = updateAiHighlightStatus(id, 'approved')!;
    let clip: ReturnType<typeof getPinnedClip> = null;
    if (existing.pinnedClipId) {
      clip = updatePinnedClipStatus(existing.pinnedClipId, 'approved');
      this.pinnedClips.emit('clipsUpdated', listPinnedClips());
    }
    const weights = adjustAiWeights(existing.signals, 0.08);
    this.emit('queueUpdated', listAiHighlights());
    this.emit('status', this.getStatus());
    return { item, weights, clip };
  }

  async quickAutoExport(id: number): Promise<{ item: AiHighlightItem; weights: AiWeights } | null> {
    const existing = getAiHighlight(id);
    if (!existing) return null;
    let exportPath = '';
    if (existing.pinnedClipId) {
      updatePinnedClipStatus(existing.pinnedClipId, 'approved');
      exportPath = await this.pinnedClips.quickExport(existing.pinnedClipId);
      this.pinnedClips.emit('clipsUpdated', listPinnedClips());
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
    if (existing.pinnedClipId) {
      const clip = getPinnedClip(existing.pinnedClipId);
      if (clip) {
        if (fs.existsSync(clip.filePath)) fs.rmSync(clip.filePath, { force: true });
        if (clip.srtPath && fs.existsSync(clip.srtPath)) fs.rmSync(clip.srtPath, { force: true });
      }
      updatePinnedClipStatus(existing.pinnedClipId, 'dismissed');
      this.pinnedClips.emit('clipsUpdated', listPinnedClips());
    }
    const weights = adjustAiWeights(existing.signals, -0.08);
    this.emit('queueUpdated', listAiHighlights());
    this.emit('status', this.getStatus());
    return { item, weights };
  }

  listQueue(): AiHighlightItem[] {
    return listAiHighlights();
  }

  async retryVisionModel(): Promise<{ ok: boolean; engineStatus: string }> {
    const res = await this.visualClassifier.retryModelSetup();
    this.emit('status', this.getStatus());
    return res;
  }

  getStatus(): AiFunnelStatus {
    const modelPath = this.resolveWhisperModel();
    const settings = getSettings();
    const threshold = this.getSensitivityThreshold(settings.aiSensitivity);
    return {
      monitoring: Boolean(this.monitorTimer),
      evaluating: this.evaluating,
      mode: settings.aiDetectionMode,
      sensitivity: settings.aiSensitivity,
      whisperAvailable: fs.existsSync(BINS.whisper) && Boolean(modelPath),
      whisperModelPath: modelPath,
      weights: getAiWeights(),
      lastAudioScore: this.lastAudioScore,
      lastVisualScore: this.lastVisualScore,
      audioScore: this.lastAudioScore,
      vocalScore: this.lastVocalScore,
      visualScore: this.lastVisualScore,
      combinedScore: this.lastCombinedScore,
      threshold,
      lastDecision: this.lastDecision,
      visualEngineStatus: this.visualClassifier.getEngineStatus(),
      visualEngineError: this.visualClassifier.getEngineError(),
      lastEvaluatedAt: this.lastEvaluatedAt,
    };
  }
}
