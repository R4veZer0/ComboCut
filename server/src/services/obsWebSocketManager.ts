import { EventEmitter } from 'node:events';
import OBSWebSocket from 'obs-websocket-js';
import {
  createTimelineMarker,
  getObsScenePreset,
  getSettings,
  listObsScenePresets,
  upsertObsScenePreset,
  type NormalizedRect,
  type ObsScenePreset,
} from '../db/database.js';

export interface ObsWebSocketStatus {
  connected: boolean;
  connecting: boolean;
  url: string;
  currentScene: string | null;
  activePreset: ObsScenePreset | null;
  error?: string;
}

interface SceneItemEntry {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled?: boolean;
}

interface SceneItemTransform {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  scaleX?: number;
  scaleY?: number;
}

export class ObsWebSocketManager extends EventEmitter {
  private obs: OBSWebSocket | null = null;
  private connected = false;
  private connecting = false;
  private currentScene: string | null = null;
  private activePreset: ObsScenePreset | null = null;
  private lastError: string | undefined;
  private activeUrl = 'ws://127.0.0.1:4455';
  private activePassword = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && !this.connecting && !this.manualDisconnect) {
        void this.connect(this.activeUrl, this.activePassword);
      }
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async connect(urlOverride?: string, passwordOverride?: string): Promise<ObsWebSocketStatus> {
    const settings = getSettings();
    const url = (urlOverride ?? settings.obsWsUrl) || 'ws://127.0.0.1:4455';
    const password = passwordOverride ?? settings.obsWsPassword ?? '';

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    await this.disconnectInternal(false);
    this.activeUrl = url;
    this.activePassword = password;
    this.connecting = true;
    this.lastError = undefined;
    this.emit('status', this.getStatus());

    const client = new OBSWebSocket();
    this.obs = client;

    client.on('ConnectionClosed', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      if (this.obs === client) {
        this.obs = null;
      }
      if (wasConnected) {
        console.log('[OBS-WS] Disconnected (auto-reconnecting in 5s)');
        this.emit('disconnected');
      }
      this.emit('status', this.getStatus());
      this.scheduleReconnect();
    });

    client.on('ConnectionError', (err) => {
      this.lastError = err.message;
      this.connecting = false;
      this.connected = false;
      this.emit('status', this.getStatus());
      this.scheduleReconnect();
    });

    client.on('CurrentProgramSceneChanged', (data) => {
      if (data?.sceneName) {
        void this.handleSceneSwitch(data.sceneName);
      }
    });

    try {
      await client.connect(url, password || undefined);
      this.connecting = false;
      this.connected = true;
      this.lastError = undefined;
      console.log(`[OBS-WS] Connected to ${url}`);
      this.emit('connected');

      try {
        const current = await client.call('GetCurrentProgramScene');
        if (current?.currentProgramSceneName) {
          await this.handleSceneSwitch(current.currentProgramSceneName);
        }
      } catch (err) {
        console.warn('[OBS-WS] Could not query initial scene:', err instanceof Error ? err.message : String(err));
      }

      this.emit('status', this.getStatus());
    } catch (err) {
      this.connecting = false;
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.obs = null;
      this.emit('status', this.getStatus());
      this.scheduleReconnect();
    }

    return this.getStatus();
  }

  private async handleSceneSwitch(sceneName: string): Promise<void> {
    this.currentScene = sceneName;

    const marker = createTimelineMarker({
      source: 'obs',
      label: `Scene: ${sceneName}`,
      sceneName,
    });
    this.emit('markerCreated', marker);

    const preset = await this.importScenePreset(sceneName);
    if (preset) {
      this.activePreset = preset;
      this.emit('cropPresetChanged', preset);
    } else {
      const saved = getObsScenePreset(sceneName);
      if (saved) {
        this.activePreset = saved;
        this.emit('cropPresetChanged', saved);
      }
    }

    this.emit('sceneChanged', sceneName);
    this.emit('status', this.getStatus());
  }

  private async importScenePreset(sceneName: string): Promise<ObsScenePreset | null> {
    if (!this.obs || !this.connected) return null;

    try {
      const video = (await this.obs.call('GetVideoSettings')) as {
        baseWidth: number;
        baseHeight: number;
      };
      const baseW = Math.max(1, video.baseWidth || 1920);
      const baseH = Math.max(1, video.baseHeight || 1080);

      const listRes = (await this.obs.call('GetSceneItemList', { sceneName })) as unknown as {
        sceneItems: SceneItemEntry[];
      };

      const items = listRes.sceneItems ?? [];
      const camItem = items.find(
        (it) =>
          it.sceneItemEnabled !== false &&
          /cam|webcam|facecam|camera|sony|elgato/i.test(it.sourceName),
      );

      let webcamSource = '';
      let webcamRect: NormalizedRect | null = null;
      let layoutMode: 'split_2box' | 'fullscreen_gameplay' | 'fullscreen_cam' = 'fullscreen_gameplay';

      if (camItem) {
        const trRes = (await this.obs.call('GetSceneItemTransform', {
          sceneName,
          sceneItemId: camItem.sceneItemId,
        })) as unknown as { sceneItemTransform: SceneItemTransform };

        const tr = trRes.sceneItemTransform;
        const w = tr.width || (tr.sourceWidth ?? 0) * (tr.scaleX ?? 1);
        const h = tr.height || (tr.sourceHeight ?? 0) * (tr.scaleY ?? 1);

        if (w > 0 && h > 0) {
          webcamSource = camItem.sourceName;
          webcamRect = {
            x: clamp01(tr.positionX / baseW),
            y: clamp01(tr.positionY / baseH),
            width: clamp01(w / baseW),
            height: clamp01(h / baseH),
          };
          const areaRatio = webcamRect.width * webcamRect.height;
          layoutMode = areaRatio >= 0.75 ? 'fullscreen_cam' : 'split_2box';
        }
      }

      return upsertObsScenePreset({
        sceneName,
        webcamSource,
        webcamRect,
        layoutMode,
      });
    } catch (err) {
      console.warn(
        `[OBS-WS] Failed to import scene transforms for "${sceneName}":`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    await this.disconnectInternal(true);
  }

  private async disconnectInternal(emitStatus: boolean): Promise<void> {
    if (this.obs) {
      try {
        await this.obs.disconnect();
      } catch {
        // ignore
      }
      this.obs = null;
    }
    this.connected = false;
    this.connecting = false;
    if (emitStatus) {
      this.emit('status', this.getStatus());
    }
  }

  listPresets(): ObsScenePreset[] {
    return listObsScenePresets();
  }

  getActivePreset(): ObsScenePreset | null {
    return this.activePreset;
  }

  getStatus(): ObsWebSocketStatus {
    return {
      connected: this.connected,
      connecting: this.connecting,
      url: this.activeUrl,
      currentScene: this.currentScene,
      activePreset: this.activePreset,
      error: this.lastError,
    };
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
}
