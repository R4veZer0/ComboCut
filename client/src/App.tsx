import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TopStatusBar } from './components/TopStatusBar';
import { LeftRail } from './components/LeftRail';
import { DualViewport } from './components/DualViewport';
import { RightInspector } from './components/RightInspector';
import { TimelineDock } from './components/TimelineDock';
import { CleanFeedModal, SetupWizardModal } from './components/Modals';
import { RestreamPanel } from './components/RestreamPanel';
import type {
  AiHighlightItem,
  ColorPreset,
  ControlRoomState,
  DesktopUpdateStatus,
  LayoutMode,
  NormalizedRect,
  PinnedClip,
  RestreamTarget,
  SafeZonePlatform,
} from './types';

export function App() {
  const [state, setState] = useState<ControlRoomState | null>(null);
  const [targets, setTargets] = useState<RestreamTarget[]>([]);
  const [mode, setMode] = useState<'onair' | 'offair'>('onair');
  const [pinning, setPinning] = useState(false);

  // Loaded clip vs Live DVR
  const [loadedClip, setLoadedClip] = useState<PinnedClip | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Dual-Viewport & Cropper state
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split_2box');
  const [gameplayRect, setGameplayRect] = useState<NormalizedRect>({
    x: 0.2,
    y: 0.05,
    width: 0.6,
    height: 0.9,
  });
  const [facecamRect, setFacecamRect] = useState<NormalizedRect>({
    x: 0.74,
    y: 0.64,
    width: 0.24,
    height: 0.32,
  });
  const [safeZone, setSafeZone] = useState<SafeZonePlatform>('tiktok');

  // Right Inspector state
  const [audioGains, setAudioGains] = useState({ t1: 1.0, t2: 1.0, t3: 1.15 });
  const [normalizeLufs, setNormalizeLufs] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionText, setCaptionText] = useState('NO WAY WE HIT THAT!');
  const [speakerColor, setSpeakerColor] = useState('#facc15');
  const [watermarkText, setWatermarkText] = useState('@ComboCut');
  const [exporting, setExporting] = useState(false);
  const [lastExportUrl, setLastExportUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Timeline & Studio Mini-Editor state
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(45);
  const [shuttleRate, setShuttleRate] = useState(1);
  const [colorPreset, setColorPreset] = useState<ColorPreset>('none');
  const [speed, setSpeed] = useState(1);
  const [zoomScale, setZoomScale] = useState(1);

  // Modals & Auto-Updater
  const [showWizard, setShowWizard] = useState(() => !localStorage.getItem('combocut_wizard_seen'));
  const [showCleanFeed, setShowCleanFeed] = useState(false);
  const [showRestream, setShowRestream] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);

  const fetchTargets = useCallback(async () => {
    const res = await fetch('/api/restream/targets');
    if (res.ok) {
      const data = (await res.json()) as { targets: RestreamTarget[] };
      setTargets(data.targets);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = (await res.json()) as ControlRoomState;
      setState(data);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchTargets();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; data: ControlRoomState };
        if (msg.type === 'state') {
          setState(msg.data);
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [fetchStatus, fetchTargets]);

  useEffect(() => {
    const api = window.combocutDesktop;
    if (!api) return;
    return api.onUpdateStatus((status) => setUpdateStatus(status));
  }, []);

  async function handleCheckUpdates() {
    if (window.combocutDesktop) {
      const res = await window.combocutDesktop.checkForUpdates();
      setUpdateStatus(res);
    } else {
      setUpdateStatus({
        state: 'up-to-date',
        message: 'Running in browser dev mode. Auto-updates are active in the Windows installer.',
      });
    }
  }

  async function handleInstallUpdate() {
    if (window.combocutDesktop) {
      await window.combocutDesktop.installUpdate();
    }
  }

  async function handleModeChange(next: 'onair' | 'offair') {
    setMode(next);
    if (next === 'offair') {
      await fetch('/api/offair/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: state?.settings.offAirMode ?? 'ddagrab' }),
      });
    } else {
      await fetch('/api/offair/stop', { method: 'POST' });
    }
    void fetchStatus();
  }

  async function handlePinHighlight() {
    setPinning(true);
    try {
      const res = await fetch('/api/clips/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerSource: 'hotkey',
          triggerLabel: 'Manual Highlight Pin',
          durationSec: 60,
        }),
      });
      if (res.ok) {
        const clip = (await res.json()) as PinnedClip;
        setLoadedClip(clip);
        setOutSec(clip.durationSec || 60);
      }
      void fetchStatus();
    } finally {
      setPinning(false);
    }
  }

  async function handleToggleDemo() {
    if (state?.demo?.running) {
      await fetch('/api/demo/stop', { method: 'POST' });
    } else {
      await fetch('/api/demo/start', { method: 'POST' });
    }
    void fetchStatus();
  }

  async function handleImportFromObs() {
    const res = await fetch('/api/obs/presets');
    if (res.ok) {
      const data = (await res.json()) as {
        active: { webcamRect: NormalizedRect | null; layoutMode: LayoutMode } | null;
      };
      if (data.active?.webcamRect) {
        setFacecamRect(data.active.webcamRect);
        setLayoutMode(data.active.layoutMode);
        return;
      }
    }
    // Fallback preset if OBS isn't connected
    setFacecamRect({ x: 0.74, y: 0.64, width: 0.24, height: 0.32 });
    setLayoutMode('split_2box');
  }

  function handleAiFaceSnap() {
    // Snap facecam to clean 16:9 top-right or bottom-right portrait crop
    setFacecamRect({ x: 0.72, y: 0.06, width: 0.24, height: 0.32 });
    setGameplayRect({ x: 0.22, y: 0.05, width: 0.56, height: 0.9 });
    setLayoutMode('split_2box');
  }

  async function handleApproveAi(item: AiHighlightItem) {
    await fetch(`/api/ai/queue/${item.id}/approve`, { method: 'POST' });
    if (item.pinnedClipId && state) {
      const match = state.pinnedClips.find((c) => c.id === item.pinnedClipId);
      if (match) setLoadedClip(match);
    }
    if (item.transcript) setCaptionText(item.transcript);
    void fetchStatus();
  }

  async function handleAutoExportAi(item: AiHighlightItem) {
    await fetch(`/api/ai/queue/${item.id}/export`, { method: 'POST' });
    void fetchStatus();
  }

  async function handleDismissAi(item: AiHighlightItem) {
    await fetch(`/api/ai/queue/${item.id}/dismiss`, { method: 'POST' });
    void fetchStatus();
  }

  async function handleTriggerAiTest() {
    await fetch('/api/ai/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioScore: 0.85, visualScore: 0.75, forceQueue: true }),
    });
    void fetchStatus();
  }

  async function handleExportClip() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/clips/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinnedClipId: loadedClip?.id,
          inSec,
          outSec,
          layoutMode,
          gameplayRect,
          facecamRect: layoutMode === 'fullscreen_gameplay' ? null : facecamRect,
          audioGains,
          normalizeLufs,
          captionsEnabled,
          captionText,
          speakerColor,
          watermarkText,
          colorPreset,
          speed,
          zoomScale,
        }),
      });
      const data = (await res.json()) as { downloadUrl?: string; error?: string };
      if (!res.ok) {
        setExportError(data.error ?? 'Export failed');
      } else if (data.downloadUrl) {
        setLastExportUrl(data.downloadUrl);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  function handleSeek(sec: number) {
    setCurrentTimeSec(sec);
    const v = videoRef.current ?? document.querySelector('video');
    if (v) v.currentTime = sec;
  }

  function handleShuttle(rate: number) {
    setShuttleRate(rate);
    const v = videoRef.current ?? document.querySelector('video');
    if (!v) return;
    if (rate === 0) {
      v.pause();
    } else if (rate > 0) {
      v.playbackRate = rate;
      void v.play().catch(() => {});
    } else {
      v.currentTime = Math.max(0, v.currentTime - 2);
    }
  }

  const hlsActive = Boolean(state?.hls.running || (state?.hls.segmentCount ?? 0) > 0);
  const clipDuration = loadedClip?.durationSec || Math.max(45, (state?.hls.segmentCount ?? 0) * 2);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <TopStatusBar
        state={state}
        mode={mode}
        onModeChange={(m) => void handleModeChange(m)}
        onPinHighlight={() => void handlePinHighlight()}
        pinning={pinning}
        onToggleDemo={() => void handleToggleDemo()}
        onOpenRestream={() => setShowRestream(true)}
        onOpenCleanFeed={() => setShowCleanFeed(true)}
        onOpenWizard={() => setShowWizard(true)}
        updateStatus={updateStatus}
        onCheckUpdates={() => void handleCheckUpdates()}
        onInstallUpdate={() => void handleInstallUpdate()}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftRail
          aiQueue={state?.aiQueue ?? []}
          pinnedClips={state?.pinnedClips ?? []}
          vodItems={state?.vodItems ?? []}
          activeClipId={loadedClip?.id ?? null}
          onSelectLiveDvr={() => setLoadedClip(null)}
          onSelectClip={(clip) => {
            setLoadedClip(clip);
            setInSec(0);
            setOutSec(clip.durationSec || 45);
          }}
          onApproveAi={(item) => void handleApproveAi(item)}
          onAutoExportAi={(item) => void handleAutoExportAi(item)}
          onDismissAi={(item) => void handleDismissAi(item)}
          onTriggerAiTest={() => void handleTriggerAiTest()}
        />

        <DualViewport
          hlsPlaylistUrl={state?.hls.playlistUrl ?? '/buffer/live.m3u8'}
          hlsActive={hlsActive}
          segmentCount={state?.hls.segmentCount ?? 0}
          loadedClip={loadedClip}
          videoRef={videoRef}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          gameplayRect={gameplayRect}
          onGameplayRectChange={setGameplayRect}
          facecamRect={facecamRect}
          onFacecamRectChange={setFacecamRect}
          safeZone={safeZone}
          onSafeZoneChange={setSafeZone}
          onImportFromObs={() => void handleImportFromObs()}
          onAiFaceSnap={handleAiFaceSnap}
          captionsEnabled={captionsEnabled}
          captionText={captionText}
          speakerColor={speakerColor}
          watermarkText={watermarkText}
          colorPreset={colorPreset}
          zoomScale={zoomScale}
        />

        <RightInspector
          audioStatus={state?.audio}
          audioGains={audioGains}
          onAudioGainsChange={setAudioGains}
          normalizeLufs={normalizeLufs}
          onNormalizeLufsChange={setNormalizeLufs}
          captionsEnabled={captionsEnabled}
          onCaptionsEnabledChange={setCaptionsEnabled}
          captionText={captionText}
          onCaptionTextChange={setCaptionText}
          speakerColor={speakerColor}
          onSpeakerColorChange={setSpeakerColor}
          watermarkText={watermarkText}
          onWatermarkTextChange={setWatermarkText}
          exporting={exporting}
          lastExportUrl={lastExportUrl}
          exportError={exportError}
          onExportClip={() => void handleExportClip()}
        />
      </div>

      <TimelineDock
        durationSec={clipDuration}
        currentTimeSec={currentTimeSec}
        onSeek={handleSeek}
        inSec={inSec}
        outSec={outSec}
        onInSecChange={setInSec}
        onOutSecChange={setOutSec}
        shuttleRate={shuttleRate}
        onShuttleChange={handleShuttle}
        markers={state?.markers ?? []}
        expanded={editorExpanded}
        onToggleExpanded={() => setEditorExpanded((v) => !v)}
        colorPreset={colorPreset}
        onColorPresetChange={setColorPreset}
        speed={speed}
        onSpeedChange={setSpeed}
        zoomScale={zoomScale}
        onZoomScaleChange={setZoomScale}
      />

      <SetupWizardModal
        open={showWizard}
        state={state}
        onClose={() => {
          localStorage.setItem('combocut_wizard_seen', '1');
          setShowWizard(false);
        }}
        onStartDemo={() => void handleToggleDemo()}
      />

      <CleanFeedModal open={showCleanFeed} onClose={() => setShowCleanFeed(false)} />

      {showRestream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="text-sm font-bold text-zinc-100">Multi-Destination Restreamers</h2>
              <button
                type="button"
                onClick={() => setShowRestream(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <RestreamPanel
              targets={targets}
              workers={state?.restreamWorkers ?? []}
              onRefresh={() => {
                void fetchTargets();
                void fetchStatus();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
