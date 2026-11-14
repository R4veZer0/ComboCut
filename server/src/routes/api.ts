import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import {
  createRestreamTarget,
  deleteRestreamTarget,
  getAiWeights,
  getPinnedClip,
  getSettings,
  listAllNonDismissedClips,
  listRestreamTargets,
  listTimelineMarkers,
  updatePinnedClipPaths,
  updateRestreamTarget,
  updateSettings,
  type MarkerSource,
  type OffAirMode,
  type RestreamPlatform,
  type SubtitleCue,
  type WhisperModelId,
} from '../db/database.js';
import { detectGpuEncoder, getCachedGpuEncoder } from '../services/gpuDetector.js';
import {
  ensureRuntimeDirs,
  resolveBufferDir,
  resolvePinnedDir,
  setCustomDvrDir,
  setCustomPinnedDir,
} from '../config/paths.js';
import { getLocalLanIp } from '../utils/process.js';
import {
  ensureWhisperModel,
  generateSubtitlesForClip,
  getWhisperDownloadState,
  listWhisperModels,
  saveEditedSubtitles,
  WHISPER_MODELS,
} from '../services/subtitleService.js';
import type { MediaMtxManager } from '../services/mediaMtxManager.js';
import type { ProgramRelayManager } from '../services/programRelayManager.js';
import type { DvrRetentionService } from '../services/dvrRetentionService.js';
import type { HlsDvrManager } from '../services/hlsDvrManager.js';
import type { RestreamManager } from '../services/restreamManager.js';
import type { WasapiAudioManager } from '../services/wasapiAudioManager.js';
import type { ObsWebSocketManager } from '../services/obsWebSocketManager.js';
import type { OffAirCaptureManager } from '../services/offAirCaptureManager.js';
import type { VodWatcherManager } from '../services/vodWatcherManager.js';
import type { PinnedClipManager } from '../services/pinnedClipManager.js';
import type { ChatMonitor } from '../services/chatMonitor.js';
import type { AiHighlightFunnel } from '../services/aiHighlightFunnel.js';
import type { ClipExportManager, ClipExportRequest } from '../services/clipExportManager.js';
import type { BatchExportQueue } from '../services/batchExportQueue.js';

export function createApiRouter(deps: {
  mediaMtx: MediaMtxManager;
  programRelay: ProgramRelayManager;
  dvrRetention: DvrRetentionService;
  hlsDvr: HlsDvrManager;
  restream: RestreamManager;
  wasapiAudio: WasapiAudioManager;
  obsWs: ObsWebSocketManager;
  offAir: OffAirCaptureManager;
  vodWatcher: VodWatcherManager;
  pinnedClips: PinnedClipManager;
  chatMonitor: ChatMonitor;
  aiFunnel: AiHighlightFunnel;
  clipExport: ClipExportManager;
  batchExport: BatchExportQueue;
}): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({
      gpu: getCachedGpuEncoder(),
      settings: getSettings(),
      lanIp: getLocalLanIp(),
      ingest: deps.mediaMtx.getStatus(),
      relay: deps.programRelay.getStatus(),
      dvrRetention: deps.dvrRetention.getStats(),
      hls: deps.hlsDvr.getStatus(),
      restreamWorkers: deps.restream.getWorkerStatuses(),
      audio: deps.wasapiAudio.getStatus(),
      offAir: deps.offAir.getStatus(),
      obs: deps.obsWs.getStatus(),
      vodWatcher: deps.vodWatcher.getWatcherStatus(),
      vodItems: deps.vodWatcher.listItems(),
      markers: listTimelineMarkers(50),
      pinnedClips: deps.pinnedClips.listClips(),
      chat: deps.chatMonitor.getStatus(),
      ai: deps.aiFunnel.getStatus(),
      aiQueue: deps.aiFunnel.listQueue(),
      demo: deps.clipExport.getDemoStatus(),
      whisperModels: listWhisperModels(),
      whisperDownload: getWhisperDownloadState(),
      batchExportQueue: deps.batchExport.listJobs(),
    });
  });

  router.post('/gpu/detect', async (_req, res) => {
    const result = await detectGpuEncoder(true);
    res.json(result);
  });

  router.get('/settings', (_req, res) => {
    res.json(getSettings());
  });

  const handleUpdateSettings = async (req: import('express').Request, res: import('express').Response) => {
    const body = req.body as Partial<{
      bufferMinutes: number;
      maxBufferGb: number;
      ramDiskEnabled: boolean;
      ramDiskPath: string;
      dvrStorageDir: string;
      pinnedClipsDir: string;
      aiDetectionMode: 'audio_visual' | 'audio_only' | 'visual_only' | 'off';
      aiVisualFocus: 'balanced' | 'clutch_heavy' | 'funny_reactions';
      aiSensitivity: 'high_recall' | 'balanced' | 'strict';
      aiMaxClipSec: number;
      brandWatermark: string;
      offAirFacecam: import('../db/database.js').OffAirFacecamConfig;
    }>;
    const updated = updateSettings(body);
    if (body.dvrStorageDir !== undefined) {
      setCustomDvrDir(updated.dvrStorageDir);
    }
    if (body.pinnedClipsDir !== undefined) {
      setCustomPinnedDir(updated.pinnedClipsDir);
    }
    const needsDvrRestart =
      body.bufferMinutes !== undefined ||
      body.maxBufferGb !== undefined ||
      body.ramDiskEnabled !== undefined ||
      body.ramDiskPath !== undefined ||
      body.dvrStorageDir !== undefined;
    if (needsDvrRestart) {
      ensureRuntimeDirs(resolveBufferDir(updated.ramDiskEnabled ? updated.ramDiskPath : null));
      await deps.hlsDvr.restart();
    }
    res.json({
      settings: updated,
      hls: deps.hlsDvr.getStatus(),
      dvrRetention: deps.dvrRetention.getStats(),
      ai: deps.aiFunnel.getStatus(),
    });
  };

  router.patch('/settings', handleUpdateSettings);
  router.post('/settings', handleUpdateSettings);

  router.post('/mode', async (req, res) => {
    const body = req.body as { mode?: 'onair' | 'offair' };
    const mode = body.mode === 'offair' ? 'offair' : 'onair';
    const updated = updateSettings({ appMode: mode });

    if (mode === 'onair') {
      await deps.offAir.stop();
      await deps.wasapiAudio.stop();
      deps.programRelay.start();
      deps.hlsDvr.start();
    } else {
      await deps.programRelay.stop();
      await deps.hlsDvr.stop();
      deps.wasapiAudio.start();
    }

    res.json({
      mode,
      settings: updated,
      audio: deps.wasapiAudio.getStatus(),
      offAir: deps.offAir.getStatus(),
      relay: deps.programRelay.getStatus(),
    });
  });

  router.post('/relay/tone', async (req, res) => {
    const body = req.body as { muted?: boolean };
    const status = await deps.programRelay.setToneMuted(Boolean(body.muted));
    res.json(status);
  });

  router.post('/settings/pinned-location', (req, res) => {
    const body = req.body as { path?: string; moveExisting?: boolean };
    const nextDir = typeof body.path === 'string' ? body.path.trim() : '';
    try {
      setCustomPinnedDir(nextDir);
      const updated = updateSettings({ pinnedClipsDir: nextDir });
      const activeBufferDir = resolveBufferDir(updated.ramDiskEnabled ? updated.ramDiskPath : null);
      ensureRuntimeDirs(activeBufferDir);
      const targetPinnedDir = resolvePinnedDir();

      let movedCount = 0;
      if (body.moveExisting) {
        const clips = listAllNonDismissedClips();
        for (const clip of clips) {
          let newMp4Path = clip.filePath;
          let newSrtPath = clip.srtPath;
          if (clip.filePath && fs.existsSync(clip.filePath)) {
            const destMp4 = path.join(targetPinnedDir, path.basename(clip.filePath));
            if (path.resolve(clip.filePath) !== path.resolve(destMp4)) {
              fs.copyFileSync(clip.filePath, destMp4);
              fs.unlinkSync(clip.filePath);
              newMp4Path = destMp4;
              movedCount++;
            }
          }
          if (clip.srtPath && fs.existsSync(clip.srtPath)) {
            const destSrt = path.join(targetPinnedDir, path.basename(clip.srtPath));
            if (path.resolve(clip.srtPath) !== path.resolve(destSrt)) {
              fs.copyFileSync(clip.srtPath, destSrt);
              fs.unlinkSync(clip.srtPath);
              newSrtPath = destSrt;
            }
          }
          if (newMp4Path !== clip.filePath || newSrtPath !== clip.srtPath) {
            updatePinnedClipPaths(clip.id, newMp4Path, newSrtPath);
          }
        }
      }

      res.json({
        settings: updated,
        movedCount,
        pinnedDir: targetPinnedDir,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/dvr/purge', (_req, res) => {
    const result = deps.dvrRetention.purgeBufferNow();
    res.json({
      ...result,
      stats: deps.dvrRetention.getStats(),
    });
  });

  router.post('/settings/dvr-location', async (req, res) => {
    const body = req.body as { path?: string };
    const nextDir = typeof body.path === 'string' ? body.path.trim() : '';
    try {
      setCustomDvrDir(nextDir);
      const updated = updateSettings({ dvrStorageDir: nextDir });
      const activeBufferDir = resolveBufferDir(updated.ramDiskEnabled ? updated.ramDiskPath : null);
      ensureRuntimeDirs(activeBufferDir);
      await deps.hlsDvr.restart();
      res.json({ settings: updated, hls: deps.hlsDvr.getStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/settings/audio', async (req, res) => {
    const body = req.body as Partial<{
      audioT1Device: string;
      audioT2Device: string;
      audioT3Device: string;
    }>;
    const updated = updateSettings({
      audioT1Device: body.audioT1Device ?? '',
      audioT2Device: body.audioT2Device ?? '',
      audioT3Device: body.audioT3Device ?? '',
    });
    if (deps.wasapiAudio.getStatus().running) {
      await deps.wasapiAudio.stop();
      deps.wasapiAudio.start();
    }
    res.json({ settings: updated, wasapi: deps.wasapiAudio.getStatus() });
  });

  router.get('/restream/targets', (_req, res) => {
    res.json({
      targets: listRestreamTargets(),
      workers: deps.restream.getWorkerStatuses(),
    });
  });

  router.post('/restream/targets', (req, res) => {
    const body = req.body as {
      name?: string;
      platform?: RestreamPlatform;
      rtmpUrl?: string;
      streamKey?: string;
      enabled?: boolean;
      twitchDownscale1080p60?: boolean;
    };

    if (!body.name || !body.platform || !body.rtmpUrl) {
      res.status(400).json({ error: 'name, platform, and rtmpUrl are required' });
      return;
    }

    const target = createRestreamTarget({
      name: body.name,
      platform: body.platform,
      rtmpUrl: body.rtmpUrl,
      streamKey: body.streamKey ?? '',
      enabled: body.enabled,
      twitchDownscale1080p60: body.twitchDownscale1080p60,
    });
    res.status(201).json(target);
  });

  router.patch('/restream/targets/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid target id' });
      return;
    }
    const updated = updateRestreamTarget(id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Target not found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/restream/targets/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid target id' });
      return;
    }
    await deps.restream.stopTarget(id);
    const deleted = deleteRestreamTarget(id);
    if (!deleted) {
      res.status(404).json({ error: 'Target not found' });
      return;
    }
    res.json({ deleted: true });
  });

  router.post('/restream/targets/:id/start', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid target id' });
      return;
    }
    try {
      const status = deps.restream.startTarget(id);
      res.json(status);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/restream/targets/:id/stop', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid target id' });
      return;
    }
    const status = await deps.restream.stopTarget(id);
    res.json(status ?? { targetId: id, state: 'stopped' });
  });

  router.post('/restream/start-all', (_req, res) => {
    deps.restream.startAllEnabled();
    res.json({ workers: deps.restream.getWorkerStatuses() });
  });

  router.post('/restream/stop-all', async (_req, res) => {
    await deps.restream.stopAll();
    res.json({ workers: deps.restream.getWorkerStatuses() });
  });

  // --- 3-Track WASAPI Audio Subsystem ---
  const handleListAudioDevices = async (_req: unknown, res: { json: (v: unknown) => void; status: (c: number) => { json: (v: unknown) => void } }) => {
    try {
      const devices = await deps.wasapiAudio.listDevices();
      res.json({ devices });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  router.get('/audio/devices', handleListAudioDevices);
  router.get('/devices/audio', handleListAudioDevices);

  router.post('/audio/start', (_req, res) => {
    res.json(deps.wasapiAudio.start());
  });

  router.post('/audio/stop', async (_req, res) => {
    await deps.wasapiAudio.stop();
    res.json(deps.wasapiAudio.getStatus());
  });

  // --- Off-Air Video Capture Engine ---
  const handleListVideoDevices = async (_req: unknown, res: { json: (v: unknown) => void; status: (c: number) => { json: (v: unknown) => void } }) => {
    try {
      const devices = await deps.offAir.listDshowDevices();
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  router.get('/offair/devices', handleListVideoDevices);
  router.get('/devices/video', handleListVideoDevices);

  router.post('/offair/start', (req, res) => {
    const body = req.body as Partial<{
      mode: OffAirMode;
      dshowVideoDevice: string;
      dshowAudioDevice: string;
      webcamDevice: string;
    }>;
    res.json(deps.offAir.start(body));
  });

  router.post('/offair/stop', async (_req, res) => {
    res.json(await deps.offAir.stop());
  });

  // --- OBS WebSocket v5 ---
  router.post('/obs/connect', async (req, res) => {
    const body = req.body as Partial<{ url: string; password: string }>;
    res.json(await deps.obsWs.connect(body.url, body.password));
  });

  router.post('/obs/disconnect', async (_req, res) => {
    await deps.obsWs.disconnect();
    res.json(deps.obsWs.getStatus());
  });

  router.get('/obs/presets', (_req, res) => {
    res.json({
      active: deps.obsWs.getActivePreset(),
      presets: deps.obsWs.listPresets(),
    });
  });

  router.get('/markers', (_req, res) => {
    res.json({ markers: listTimelineMarkers(100) });
  });

  // --- Instant /pinned Micro-Clip Extractor ---
  router.get('/clips', (_req, res) => {
    res.json({ clips: deps.pinnedClips.listClips() });
  });

  router.get('/clips/pinned', (_req, res) => {
    res.json({ clips: deps.pinnedClips.listClips() });
  });

  router.post('/clips/pin', async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      triggerSource: MarkerSource;
      triggerLabel: string;
      durationSec: number;
    }>;
    try {
      const clip = await deps.pinnedClips.pinFromBuffer(body);
      res.status(201).json(clip);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const handleDeleteClip = (req: { params: { id: string } }, res: { status: (c: number) => { json: (v: unknown) => void }; json: (v: unknown) => void }) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid clip id' });
      return;
    }
    const deleted = deps.pinnedClips.removeClip(id);
    if (!deleted) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    res.json({ deleted: true });
  };
  router.delete('/clips/:id', handleDeleteClip);
  router.delete('/clips/pinned/:id', handleDeleteClip);

  // --- Speech-to-Text Subtitles (whisper.cpp + .srt) ---
  router.get('/clips/:id/subtitles', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid clip id' });
      return;
    }
    const clip = getPinnedClip(id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    res.json({ cues: clip.subtitles, srtPath: clip.srtPath });
  });

  router.post('/clips/:id/subtitles/generate', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid clip id' });
      return;
    }
    try {
      const result = await generateSubtitlesForClip(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/clips/:id/subtitles', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid clip id' });
      return;
    }
    const body = req.body as { cues?: SubtitleCue[] };
    if (!Array.isArray(body.cues)) {
      res.status(400).json({ error: 'cues array is required' });
      return;
    }
    try {
      const result = saveEditedSubtitles(id, body.cues);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- 4-Signal AI Highlight Funnel & Approval Queue ---
  router.get('/ai/status', (_req, res) => {
    res.json({
      funnel: deps.aiFunnel.getStatus(),
      chat: deps.chatMonitor.getStatus(),
      weights: getAiWeights(),
    });
  });

  router.post('/ai/retry-vision-model', async (_req, res) => {
    const result = await deps.aiFunnel.retryVisionModel();
    res.json({
      ...result,
      ai: deps.aiFunnel.getStatus(),
    });
  });

  router.post('/ai/chat/start', (req, res) => {
    const body = req.body as { channel?: string; platform?: 'twitch' | 'youtube' };
    if (!body.channel) {
      res.status(400).json({ error: 'channel is required' });
      return;
    }
    res.json(deps.chatMonitor.start(body.channel, body.platform ?? 'twitch'));
  });

  router.post('/ai/chat/stop', (_req, res) => {
    res.json(deps.chatMonitor.stop());
  });

  router.post('/ai/chat/ingest', (req, res) => {
    const body = req.body as { text?: string };
    if (body.text) deps.chatMonitor.ingestMessage(body.text);
    res.json(deps.chatMonitor.getStatus());
  });

  router.get('/ai/queue', (_req, res) => {
    res.json({
      items: deps.aiFunnel.listQueue(),
      weights: getAiWeights(),
    });
  });

  router.post('/ai/evaluate', async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      chatScore: number;
      audioScore: number;
      visualScore: number;
      pinDurationSec: number;
      forceQueue: boolean;
    }>;
    const item = await deps.aiFunnel.evaluateCandidate(body);
    res.json({ item, weights: getAiWeights() });
  });

  router.post('/ai/queue/:id/approve', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid highlight id' });
      return;
    }
    const result = deps.aiFunnel.approve(id);
    if (!result) {
      res.status(404).json({ error: 'Highlight not found' });
      return;
    }
    res.json(result);
  });

  router.post('/ai/queue/:id/export', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid highlight id' });
      return;
    }
    try {
      const result = await deps.aiFunnel.quickAutoExport(id);
      if (!result) {
        res.status(404).json({ error: 'Highlight not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/ai/queue/:id/dismiss', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid highlight id' });
      return;
    }
    const result = deps.aiFunnel.dismiss(id);
    if (!result) {
      res.status(404).json({ error: 'Highlight not found' });
      return;
    }
    res.json(result);
  });

  // --- VOD Fast-Scanner & Replay Folder Watcher ---
  router.get('/vod', (_req, res) => {
    res.json({
      watcher: deps.vodWatcher.getWatcherStatus(),
      items: deps.vodWatcher.listItems(),
    });
  });

  router.post('/vod/scan', async (req, res) => {
    const body = req.body as { filePath?: string; sourceType?: 'drop' | 'replay' };
    if (!body.filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }
    try {
      const item = await deps.vodWatcher.scanFile(body.filePath, body.sourceType ?? 'drop');
      res.json(item);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/vod/watch', (req, res) => {
    const body = req.body as { watchDir?: string; stop?: boolean };
    if (body.stop) {
      deps.vodWatcher.stopWatcher();
      res.json(deps.vodWatcher.getWatcherStatus());
      return;
    }
    if (body.watchDir !== undefined) {
      updateSettings({ replayWatchDir: body.watchDir });
    }
    res.json(deps.vodWatcher.startWatcher(body.watchDir));
  });

  router.delete('/vod/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid vod id' });
      return;
    }
    const deleted = deps.vodWatcher.removeItem(id);
    if (!deleted) {
      res.status(404).json({ error: 'VOD item not found' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Built-in Demo Stream & Single-Pass FFmpeg Export ---
  router.post('/demo/start', (_req, res) => {
    try {
      res.json(deps.clipExport.startDemoStream());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/demo/stop', async (_req, res) => {
    res.json(await deps.clipExport.stopDemoStream());
  });

  router.post('/clips/export', async (req, res) => {
    try {
      const result = await deps.clipExport.exportClip(req.body as ClipExportRequest);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Whisper Model Switcher & Batch Export Queue ---
  router.get('/whisper/models', (_req, res) => {
    res.json({
      models: listWhisperModels(),
      download: getWhisperDownloadState(),
    });
  });

  router.post('/whisper/model', (req, res) => {
    const body = req.body as { model?: WhisperModelId; downloadNow?: boolean };
    const modelId = body.model;
    if (!modelId || !WHISPER_MODELS[modelId]) {
      res.status(400).json({ error: 'Invalid whisper model id' });
      return;
    }
    const updated = updateSettings({ whisperModel: modelId });
    if (body.downloadNow !== false) {
      void ensureWhisperModel(modelId).catch((err) => {
        console.warn('[Subtitles] Model pre-download failed:', err instanceof Error ? err.message : String(err));
      });
    }
    res.json({
      settings: updated,
      models: listWhisperModels(),
      download: getWhisperDownloadState(),
    });
  });

  router.get('/clips/export/queue', (_req, res) => {
    res.json({ jobs: deps.batchExport.listJobs() });
  });

  router.post('/clips/export/batch', (req, res) => {
    const body = req.body as {
      items?: Array<{ pinnedClipId: number; request: ClipExportRequest }>;
    };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }
    const prepared = body.items.map((item) => {
      const clip = getPinnedClip(item.pinnedClipId);
      return {
        pinnedClipId: item.pinnedClipId,
        label: clip?.triggerLabel || clip?.filename || `Clip #${item.pinnedClipId}`,
        request: { ...item.request, pinnedClipId: item.pinnedClipId },
      };
    });
    const added = deps.batchExport.enqueue(prepared);
    res.status(201).json({
      added,
      jobs: deps.batchExport.listJobs(),
    });
  });

  router.delete('/clips/export/queue/:jobId', (req, res) => {
    if (req.params.jobId === 'completed') {
      deps.batchExport.clearCompleted();
      res.json({ jobs: deps.batchExport.listJobs() });
      return;
    }
    const removed = deps.batchExport.removeJob(req.params.jobId);
    if (!removed) {
      res.status(404).json({ error: 'Job not found or currently running' });
      return;
    }
    res.json({ jobs: deps.batchExport.listJobs() });
  });

  router.post('/feedback', async (req, res) => {
    const body = req.body as {
      category?: string;
      details?: string;
      handle?: string;
      diagnostics?: string;
    };

    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (!details) {
      res.status(400).json({ ok: false, error: 'Feedback details are required.' });
      return;
    }

    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Bug Report / Crash';
    const handle = typeof body.handle === 'string' && body.handle.trim() ? body.handle.trim() : 'Anonymous';
    const diagnostics = typeof body.diagnostics === 'string' ? body.diagnostics.trim() : '';

    const params = new URLSearchParams();
    params.set('entry.1002976204', category);
    params.set('entry.55595861', details);
    params.set('entry.94588325', handle);
    params.set('entry.210789531', diagnostics);

    const formResponseUrl =
      'https://docs.google.com/forms/d/e/1FAIpQLScvFtxFP5VNPmXfpCD2TVraARn2lu01ZGckajkMXcRupW2edw/formResponse';
    const fallbackUrl = 'https://forms.gle/AgcZhtAgxkM3UJxG7';

    try {
      const response = await fetch(formResponseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: params.toString(),
      });

      if (response.status === 200) {
        res.json({ ok: true, status: response.status });
      } else {
        res.status(502).json({
          ok: false,
          status: response.status,
          error: `Google Forms returned HTTP ${response.status}. Opening browser fallback.`,
          fallbackUrl,
        });
      }
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Network error reaching Google Forms',
        fallbackUrl,
      });
    }
  });

  return router;
}
