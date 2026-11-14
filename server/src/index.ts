import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CLIENT_DIST_DIR,
  ensureRuntimeDirs,
  resolveBufferDir,
  resolveExportsDir,
  resolvePinnedDir,
  setCustomDvrDir,
  setCustomPinnedDir,
} from './config/paths.js';
import { getDb, getSettings, listTimelineMarkers, updateSettings } from './db/database.js';
import { getLocalLanIp } from './utils/process.js';
import { detectGpuEncoder, getCachedGpuEncoder } from './services/gpuDetector.js';
import { MediaMtxManager } from './services/mediaMtxManager.js';
import { ProgramRelayManager } from './services/programRelayManager.js';
import { DvrRetentionService } from './services/dvrRetentionService.js';
import { HlsDvrManager } from './services/hlsDvrManager.js';
import { RestreamManager } from './services/restreamManager.js';
import { WasapiAudioManager } from './services/wasapiAudioManager.js';
import { ObsWebSocketManager } from './services/obsWebSocketManager.js';
import { OffAirCaptureManager } from './services/offAirCaptureManager.js';
import { VodWatcherManager } from './services/vodWatcherManager.js';
import { PinnedClipManager } from './services/pinnedClipManager.js';
import { ChatMonitor } from './services/chatMonitor.js';
import { AiHighlightFunnel } from './services/aiHighlightFunnel.js';
import { ClipExportManager } from './services/clipExportManager.js';
import { BatchExportQueue } from './services/batchExportQueue.js';
import { getWhisperDownloadState, listWhisperModels, subtitleEvents } from './services/subtitleService.js';
import { createApiRouter } from './routes/api.js';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);

async function bootstrap() {
  getDb();
  // Always boot into On-Air Live Standby (no stale Off-Air restore on startup)
  const settings = updateSettings({ appMode: 'onair' });
  setCustomDvrDir(settings.dvrStorageDir);
  setCustomPinnedDir(settings.pinnedClipsDir);
  const initialBufferDir = resolveBufferDir(settings.ramDiskEnabled ? settings.ramDiskPath : null);
  ensureRuntimeDirs(initialBufferDir);

  await detectGpuEncoder();

  const mediaMtx = new MediaMtxManager();
  const programRelay = new ProgramRelayManager(mediaMtx);
  const dvrRetention = new DvrRetentionService();
  const hlsDvr = new HlsDvrManager();
  const restream = new RestreamManager();
  const wasapiAudio = new WasapiAudioManager();
  const obsWs = new ObsWebSocketManager();
  const offAir = new OffAirCaptureManager(wasapiAudio);
  const vodWatcher = new VodWatcherManager();
  const pinnedClips = new PinnedClipManager(obsWs);
  const chatMonitor = new ChatMonitor();
  const aiFunnel = new AiHighlightFunnel(chatMonitor, wasapiAudio, pinnedClips);
  const clipExport = new ClipExportManager();
  const batchExport = new BatchExportQueue(clipExport);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve dynamic buffer dir (supports RAM-disk path switching at runtime)
  app.use('/buffer', (req, res, next) => {
    const currentSettings = getSettings();
    const activeDir = resolveBufferDir(
      currentSettings.ramDiskEnabled ? currentSettings.ramDiskPath : null,
    );
    express.static(activeDir, {
      setHeaders: (response) => {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      },
    })(req, res, next);
  });

  app.use('/pinned', (req, res, next) => {
    express.static(resolvePinnedDir())(req, res, next);
  });
  app.use('/exports', (req, res, next) => {
    express.static(resolveExportsDir())(req, res, next);
  });

  app.use(
    '/api',
    createApiRouter({
      mediaMtx,
      programRelay,
      dvrRetention,
      hlsDvr,
      restream,
      wasapiAudio,
      obsWs,
      offAir,
      vodWatcher,
      pinnedClips,
      chatMonitor,
      aiFunnel,
      clipExport,
      batchExport,
    }),
  );

  // Serve built React client in packaged Electron / production mode
  const clientIndex = path.join(CLIENT_DIST_DIR, 'index.html');
  if (process.env.COMBOCUT_SERVE_CLIENT === 'true' && fs.existsSync(clientIndex)) {
    app.use(express.static(CLIENT_DIST_DIR));
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/buffer') ||
        req.path.startsWith('/pinned') ||
        req.path.startsWith('/exports') ||
        req.path.startsWith('/ws')
      ) {
        next();
        return;
      }
      res.sendFile(clientIndex);
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function getStateSnapshot() {
    return {
      gpu: getCachedGpuEncoder(),
      settings: getSettings(),
      lanIp: getLocalLanIp(),
      ingest: mediaMtx.getStatus(),
      relay: programRelay.getStatus(),
      dvrRetention: dvrRetention.getStats(),
      hls: hlsDvr.getStatus(),
      restreamWorkers: restream.getWorkerStatuses(),
      audio: wasapiAudio.getStatus(),
      offAir: offAir.getStatus(),
      obs: obsWs.getStatus(),
      vodWatcher: vodWatcher.getWatcherStatus(),
      vodItems: vodWatcher.listItems(),
      markers: listTimelineMarkers(50),
      pinnedClips: pinnedClips.listClips(),
      chat: chatMonitor.getStatus(),
      ai: aiFunnel.getStatus(),
      aiQueue: aiFunnel.listQueue(),
      demo: clipExport.getDemoStatus(),
      whisperModels: listWhisperModels(),
      whisperDownload: getWhisperDownloadState(),
      batchExportQueue: batchExport.listJobs(),
    };
  }

  function broadcastState() {
    if (wss.clients.size === 0) return;
    const payload = JSON.stringify({
      type: 'state',
      data: getStateSnapshot(),
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'state',
        data: getStateSnapshot(),
      }),
    );
  });

  mediaMtx.on('status', broadcastState);
  programRelay.on('status', broadcastState);
  hlsDvr.on('status', broadcastState);
  restream.on('status', broadcastState);
  wasapiAudio.on('status', broadcastState);
  offAir.on('status', broadcastState);
  obsWs.on('status', broadcastState);
  vodWatcher.on('status', broadcastState);
  vodWatcher.on('vodUpdated', broadcastState);
  pinnedClips.on('clipsUpdated', broadcastState);
  pinnedClips.on('markerCreated', broadcastState);
  obsWs.on('markerCreated', broadcastState);
  chatMonitor.on('status', broadcastState);
  aiFunnel.on('status', broadcastState);
  aiFunnel.on('queueUpdated', broadcastState);
  aiFunnel.on('markerCreated', broadcastState);
  clipExport.on('demoStatus', broadcastState);
  batchExport.on('updated', broadcastState);
  subtitleEvents.on('download', broadcastState);

  let isProgramOnline = false;
  obsWs.on('connected', () => {
    chatMonitor.setOnAir(true);
    void offAir.releaseForOnAir('OBS WebSocket connected');
  });

  obsWs.on('disconnected', () => {
    chatMonitor.setOnAir(isProgramOnline);
  });

  mediaMtx.on('programOnline', () => {
    isProgramOnline = true;
    chatMonitor.setOnAir(true);
    console.log('[Broadcast] live/program is ONLINE -> releasing Off-Air & switching relay to live OBS');
    void offAir.releaseForOnAir('RTMP live/program became active').then(async () => {
      if (getSettings().appMode === 'onair') {
        await wasapiAudio.stop();
        programRelay.start();
        hlsDvr.start();
      }
    });
  });

  mediaMtx.on('programOffline', () => {
    isProgramOnline = false;
    chatMonitor.setOnAir(obsWs.getStatus().connected);
    console.log('[Broadcast] live/program is OFFLINE -> failing over relay to standby bars & keeping HLS DVR alive');
  });

  mediaMtx.start();
  dvrRetention.start();
  aiFunnel.setActiveSourceCheck(() => isProgramOnline || offAir.getStatus().running);
  await wasapiAudio.stop();
  programRelay.start();
  setTimeout(() => {
    if (getSettings().appMode === 'onair') {
      hlsDvr.start();
    }
  }, 1500);
  void obsWs.connect();
  aiFunnel.startMonitoring();
  if (settings.replayWatchDir) {
    vodWatcher.startWatcher(settings.replayWatchDir);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Server] ComboCut Control Room API listening on http://127.0.0.1:${PORT}`);
  });

  async function shutdown() {
    console.log('\n[Server] Shutting down...');
    dvrRetention.stop();
    aiFunnel.stopMonitoring();
    chatMonitor.stop();
    vodWatcher.stopWatcher();
    await clipExport.stopDemoStream();
    await obsWs.disconnect();
    await restream.stopAll();
    await offAir.stop();
    await wasapiAudio.stop();
    await hlsDvr.stop();
    await programRelay.stop();
    await mediaMtx.stop();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
