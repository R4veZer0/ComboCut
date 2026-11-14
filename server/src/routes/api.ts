import { Router } from 'express';
import {
  createRestreamTarget,
  deleteRestreamTarget,
  getAiWeights,
  getSettings,
  listRestreamTargets,
  listTimelineMarkers,
  updateRestreamTarget,
  updateSettings,
  type MarkerSource,
  type OffAirMode,
  type RestreamPlatform,
} from '../db/database.js';
import { detectGpuEncoder, getCachedGpuEncoder } from '../services/gpuDetector.js';
import type { MediaMtxManager } from '../services/mediaMtxManager.js';
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

export function createApiRouter(deps: {
  mediaMtx: MediaMtxManager;
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
}): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({
      gpu: getCachedGpuEncoder(),
      settings: getSettings(),
      ingest: deps.mediaMtx.getStatus(),
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
    });
  });

  router.post('/gpu/detect', async (_req, res) => {
    const result = await detectGpuEncoder(true);
    res.json(result);
  });

  router.get('/settings', (_req, res) => {
    res.json(getSettings());
  });

  router.patch('/settings', async (req, res) => {
    const body = req.body as Partial<{
      bufferMinutes: number;
      ramDiskEnabled: boolean;
      ramDiskPath: string;
    }>;
    const updated = updateSettings(body);
    await deps.hlsDvr.restart();
    res.json({ settings: updated, hls: deps.hlsDvr.getStatus() });
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
  router.get('/audio/devices', async (_req, res) => {
    try {
      const devices = await deps.wasapiAudio.listDevices();
      res.json({ devices });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/audio/start', (_req, res) => {
    res.json(deps.wasapiAudio.start());
  });

  router.post('/audio/stop', async (_req, res) => {
    await deps.wasapiAudio.stop();
    res.json(deps.wasapiAudio.getStatus());
  });

  // --- Off-Air Video Capture Engine ---
  router.get('/offair/devices', async (_req, res) => {
    try {
      const devices = await deps.offAir.listDshowDevices();
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

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

  router.delete('/clips/pinned/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid clip id' });
      return;
    }
    const deleted = deps.pinnedClips.removeClip(id);
    if (!deleted) {
      res.status(404).json({ error: 'Pinned clip not found' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- 4-Signal AI Highlight Funnel & Approval Queue ---
  router.get('/ai/status', (_req, res) => {
    res.json({
      funnel: deps.aiFunnel.getStatus(),
      chat: deps.chatMonitor.getStatus(),
      weights: getAiWeights(),
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

  return router;
}
