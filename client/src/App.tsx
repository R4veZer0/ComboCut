import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, FolderOpen, X } from 'lucide-react';
import { TopStatusBar } from './components/TopStatusBar';
import { LeftRail } from './components/LeftRail';
import { DualViewport } from './components/DualViewport';
import { RightInspector } from './components/RightInspector';
import { TimelineDock } from './components/TimelineDock';
import {
  CleanFeedModal,
  FeedbackModal,
  HelpSetupModal,
  SetupWizardModal,
  StorageSettingsModal,
  type HelpSetupTab,
} from './components/Modals';
import { RestreamPanel } from './components/RestreamPanel';
import {
  DEFAULT_OFF_AIR_FACECAM,
  type AiDetectionMode,
  type AiHighlightItem,
  type AiSensitivity,
  type AiVisualFocus,
  type AudioDeviceInfo,
  type ColorPreset,
  type ControlRoomState,
  type DesktopUpdateStatus,
  type DshowDeviceList,
  type LayoutMode,
  type NormalizedRect,
  type OffAirFacecamConfig,
  type PinnedClip,
  type RestreamTarget,
  type SafeZonePlatform,
  type SubtitleCue,
  type SubtitleStyle,
  type WhisperModelId,
} from './types';

export function App() {
  const [state, setState] = useState<ControlRoomState | null>(null);
  const [targets, setTargets] = useState<RestreamTarget[]>([]);
  const [mode, setMode] = useState<'onair' | 'offair'>('onair');
  const [pinning, setPinning] = useState(false);

  // Loaded clip vs Live DVR
  const [loadedClip, setLoadedClip] = useState<PinnedClip | null>(null);
  const [previewingAiItem, setPreviewingAiItem] = useState<AiHighlightItem | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watermarkHydratedRef = useRef(false);

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
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 52,
    colorHex: '#facc15',
    verticalPos: 'bottom',
  });
  const [generatingSubtitles, setGeneratingSubtitles] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
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
  const [showHelp, setShowHelp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [exportToast, setExportToast] = useState<{
    filename: string;
    exportDir: string;
    hookTitle: string;
    hashtags: string;
  } | null>(null);
  const [copiedHook, setCopiedHook] = useState(false);
  const seenBatchDoneRef = useRef<Set<string>>(new Set());
  const [helpTab, setHelpTab] = useState<HelpSetupTab>('obs');
  const [showCleanFeed, setShowCleanFeed] = useState(false);
  const [showRestream, setShowRestream] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [refreshingAudio, setRefreshingAudio] = useState(false);
  const [videoDevices, setVideoDevices] = useState<DshowDeviceList>({ video: [], audio: [] });
  const [refreshingVideo, setRefreshingVideo] = useState(false);
  const [selectedCaptureSource, setSelectedCaptureSource] = useState<string>('ddagrab');
  const [selectedWebcam, setSelectedWebcam] = useState<string>('');
  const [offAirFacecam, setOffAirFacecam] = useState<OffAirFacecamConfig>(DEFAULT_OFF_AIR_FACECAM);
  const facecamHydratedRef = useRef(false);

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
      if (data.settings?.appMode) {
        setMode(data.settings.appMode);
      }
      if (!watermarkHydratedRef.current && data.settings?.brandWatermark !== undefined) {
        watermarkHydratedRef.current = true;
        setWatermarkText(data.settings.brandWatermark);
      }
      if (!facecamHydratedRef.current && data.settings?.offAirFacecam) {
        facecamHydratedRef.current = true;
        setOffAirFacecam(data.settings.offAirFacecam);
      }
    }
  }, []);

  // Debounced 400ms persistence of Off-Air Facecam Framing to studio.db
  useEffect(() => {
    if (!facecamHydratedRef.current) return;
    const timer = setTimeout(() => {
      void fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offAirFacecam }),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [offAirFacecam]);

  // Debounced 400ms persistence of Brand Watermark to studio.db
  useEffect(() => {
    if (!watermarkHydratedRef.current) return;
    const timer = setTimeout(() => {
      void fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandWatermark: watermarkText }),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [watermarkText]);

  const fetchAudioDevices = useCallback(async () => {
    setRefreshingAudio(true);
    try {
      const res = await fetch('/api/devices/audio');
      if (res.ok) {
        const data = (await res.json()) as { devices: AudioDeviceInfo[] };
        setAudioDevices(data.devices ?? []);
      }
    } finally {
      setRefreshingAudio(false);
    }
  }, []);

  const fetchVideoDevices = useCallback(async () => {
    setRefreshingVideo(true);
    try {
      const res = await fetch('/api/devices/video');
      if (res.ok) {
        const data = (await res.json()) as DshowDeviceList;
        setVideoDevices({ video: data.video ?? [], audio: data.audio ?? [] });
      }
    } finally {
      setRefreshingVideo(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchTargets();
    void fetchAudioDevices();
    void fetchVideoDevices();

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
  }, [fetchStatus, fetchTargets, fetchAudioDevices, fetchVideoDevices]);

  useEffect(() => {
    const api = window.combocutDesktop;
    if (!api) return;
    return api.onUpdateStatus((status) => setUpdateStatus(status));
  }, []);

  useEffect(() => {
    const jobs = state?.batchExportQueue ?? [];
    for (const job of jobs) {
      if (job.status === 'done' && !seenBatchDoneRef.current.has(job.jobId)) {
        seenBatchDoneRef.current.add(job.jobId);
        if (job.filename && job.exportDir) {
          setExportToast({
            filename: job.filename,
            exportDir: job.exportDir,
            hookTitle: job.hookTitle || job.label,
            hashtags: job.hashtags || '#gaming #clips #shorts',
          });
        }
      }
    }
  }, [state?.batchExportQueue]);

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
    await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    });
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

  async function handleGenerateSubtitles(targetClipId?: number) {
    const id = targetClipId ?? loadedClip?.id;
    if (!id) return;
    setGeneratingSubtitles(true);
    setSubtitleError(null);
    try {
      const res = await fetch(`/api/clips/${id}/subtitles/generate`, { method: 'POST' });
      const data = (await res.json()) as { cues?: SubtitleCue[]; error?: string };
      if (!res.ok) {
        setSubtitleError(data.error ?? 'Failed to generate subtitles');
        return;
      }
      setSubtitleCues(data.cues ?? []);
      void fetchStatus();
    } catch (err) {
      setSubtitleError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingSubtitles(false);
    }
  }

  function handleLoadClip(clip: PinnedClip) {
    setLoadedClip(clip);
    setInSec(0);
    setOutSec(clip.durationSec || 45);
    setSubtitleError(null);
    const existingCues = clip.subtitles ?? [];
    setSubtitleCues(existingCues);
    if (existingCues.length === 0) {
      void handleGenerateSubtitles(clip.id);
    }
  }

  function handleUpdateSubtitleCue(id: number, text: string) {
    setSubtitleCues((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }

  async function handleSaveSubtitles() {
    if (!loadedClip) return;
    setSubtitleError(null);
    const res = await fetch(`/api/clips/${loadedClip.id}/subtitles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: subtitleCues }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setSubtitleError(data.error ?? 'Failed to save subtitles');
      return;
    }
    void fetchStatus();
  }

  async function handleDeleteClip(clip: PinnedClip) {
    const res = await fetch(`/api/clips/${clip.id}`, { method: 'DELETE' });
    if (res.ok) {
      if (loadedClip?.id === clip.id) {
        setLoadedClip(null);
        setSubtitleCues([]);
      }
      void fetchStatus();
    }
  }

  async function handleApproveAi(item: AiHighlightItem) {
    const res = await fetch(`/api/ai/queue/${item.id}/approve`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { clip?: PinnedClip | null };
      if (data.clip) {
        handleLoadClip(data.clip);
      }
    }
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
          subtitleCues,
          subtitleStyle: { ...subtitleStyle, colorHex: speakerColor },
          speakerColor,
          watermarkText,
          colorPreset,
          speed,
          zoomScale,
        }),
      });
      const data = (await res.json()) as {
        downloadUrl?: string;
        filename?: string;
        exportDir?: string;
        hookTitle?: string;
        hashtags?: string;
        error?: string;
      };
      if (!res.ok) {
        setExportError(data.error ?? 'Export failed');
      } else if (data.downloadUrl) {
        setLastExportUrl(data.downloadUrl);
        setExportToast({
          filename: data.filename || 'export.mp4',
          exportDir: data.exportDir || '',
          hookTitle: data.hookTitle || 'Insane Highlight Moment!',
          hashtags: data.hashtags || '#gaming #clips #shorts',
        });
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

  const handleSelectAudioDevice = async (track: 't1' | 't2' | 't3', deviceId: string) => {
    const current = state?.settings;
    await fetch('/api/settings/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioT1Device: track === 't1' ? deviceId : (current?.audioT1Device ?? ''),
        audioT2Device: track === 't2' ? deviceId : (current?.audioT2Device ?? ''),
        audioT3Device: track === 't3' ? deviceId : (current?.audioT3Device ?? ''),
      }),
    });
    await fetchStatus();
  };

  const handleToggleOffAir = async () => {
    if (state?.offAir.running) {
      await fetch('/api/offair/stop', { method: 'POST' });
    } else {
      const isDshow = selectedCaptureSource.startsWith('dshow:');
      const dshowVideoDevice = isDshow ? selectedCaptureSource.slice('dshow:'.length) : '';
      await fetch('/api/offair/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: isDshow ? 'dshow' : 'ddagrab',
          dshowVideoDevice,
          webcamDevice: selectedWebcam,
        }),
      });
    }
    await fetchStatus();
  };

  const handleChangeDvrLocation = async () => {
    let chosenPath: string | null = null;
    if (window.combocutDesktop?.selectDirectory) {
      chosenPath = await window.combocutDesktop.selectDirectory(state?.hls.bufferDir);
    } else {
      chosenPath = window.prompt('Enter DVR Buffer & Exports folder path (e.g. D:\\ComboCutDVR):', state?.hls.bufferDir ?? '');
    }
    if (!chosenPath) return;
    await fetch('/api/settings/dvr-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: chosenPath }),
    });
    await fetchStatus();
  };

  const handleOpenDvrFolder = async () => {
    if (!state?.hls.bufferDir) return;
    await window.combocutDesktop?.openFolder?.(state.hls.bufferDir);
  };

  const handleChangePinnedLocation = async (moveExisting: boolean) => {
    let chosenPath: string | null = null;
    if (window.combocutDesktop?.selectDirectory) {
      chosenPath = await window.combocutDesktop.selectDirectory(state?.settings.pinnedClipsDir || state?.hls.bufferDir);
    } else {
      chosenPath = window.prompt('Enter Pinned Clips folder path (e.g. D:\\ComboCutClips):', state?.settings.pinnedClipsDir ?? '');
    }
    if (!chosenPath) return;
    await fetch('/api/settings/pinned-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: chosenPath, moveExisting }),
    });
    await fetchStatus();
  };

  const handleUpdateRetention = async (patch: {
    bufferMinutes?: number;
    maxBufferGb?: number;
    aiDetectionMode?: AiDetectionMode;
    aiVisualFocus?: AiVisualFocus;
    aiSensitivity?: AiSensitivity;
    aiMaxClipSec?: number;
  }) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await fetchStatus();
  };

  const handlePreviewAi = (item: AiHighlightItem) => {
    if (!item.clipFilename) return;
    const dur = item.clipDurationSec ?? 45;
    setPreviewingAiItem(item);
    setLoadedClip({
      id: item.pinnedClipId ?? -item.id,
      filePath: '',
      filename: item.clipFilename,
      triggerSource: 'ai',
      triggerLabel: item.signals.reasons[0] ?? `AI Candidate #${item.id}`,
      durationSec: dur,
      cropPreset: null,
      status: 'pending',
      createdAt: item.createdAt,
    });
    setInSec(0);
    setOutSec(Math.round(dur));
    setSubtitleCues([]);
    setLastExportUrl(null);
    setExportError(null);
  };

  const handlePurgeBuffer = async () => {
    await fetch('/api/dvr/purge', { method: 'POST' });
    await fetchStatus();
  };

  const handleToggleToneMuted = async () => {
    const nextMuted = !(state?.relay?.toneMuted ?? true);
    await fetch('/api/relay/tone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: nextMuted }),
    });
    await fetchStatus();
  };

  const handleSelectWhisperModel = async (modelId: WhisperModelId) => {
    await fetch('/api/whisper/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, downloadNow: true }),
    });
    await fetchStatus();
  };

  const handleBatchExport = async (clipIds: number[]) => {
    if (clipIds.length === 0) return;
    const items = clipIds.map((pinnedClipId) => ({
      pinnedClipId,
      request: {
        pinnedClipId,
        layoutMode,
        gameplayRect,
        facecamRect,
        audioGains,
        normalizeLufs,
        captionsEnabled,
        speakerColor,
        subtitleStyle,
        watermarkText,
        colorPreset,
        speed,
        zoomScale,
      },
    }));
    await fetch('/api/clips/export/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    await fetchStatus();
  };

  const handleClearBatchCompleted = async () => {
    await fetch('/api/clips/export/queue/completed', { method: 'DELETE' });
    await fetchStatus();
  };

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
        onOpenHelp={() => {
          setHelpTab('obs');
          setShowHelp(true);
        }}
        onOpenFeedback={() => setShowFeedback(true)}
        onOpenStorage={() => setShowStorage(true)}
        onChangeDvrLocation={() => void handleChangeDvrLocation()}
        onOpenDvrFolder={() => void handleOpenDvrFolder()}
        videoDevices={videoDevices}
        selectedCaptureSource={selectedCaptureSource}
        onCaptureSourceChange={setSelectedCaptureSource}
        selectedWebcam={selectedWebcam}
        onWebcamChange={setSelectedWebcam}
        offAirFacecam={offAirFacecam}
        onOffAirFacecamChange={(next) => {
          setOffAirFacecam(next);
          setFacecamRect((prev) => ({
            ...prev,
            x: next.x,
            y: next.y,
            width: next.widthPct / 100,
          }));
        }}
        onRefreshVideoDevices={() => void fetchVideoDevices()}
        refreshingVideo={refreshingVideo}
        onToggleOffAir={() => void handleToggleOffAir()}
        updateStatus={updateStatus}
        onCheckUpdates={() => void handleCheckUpdates()}
        onInstallUpdate={() => void handleInstallUpdate()}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftRail
          aiQueue={state?.aiQueue ?? []}
          aiDetectionMode={state?.settings.aiDetectionMode ?? 'audio_visual'}
          aiStatus={state?.ai}
          gpuAdapterName={state?.gpu?.adapterName}
          onChangeAiDetectionMode={(aiDetectionMode) => void handleUpdateRetention({ aiDetectionMode })}
          onRetryVisionModel={() => {
            void fetch('/api/ai/retry-vision-model', { method: 'POST' }).then(() => fetchStatus());
          }}
          pinnedClips={state?.pinnedClips ?? []}
          vodItems={state?.vodItems ?? []}
          batchExportQueue={state?.batchExportQueue ?? []}
          activeClipId={loadedClip?.id ?? null}
          onSelectLiveDvr={() => {
            setPreviewingAiItem(null);
            setLoadedClip(null);
            setSubtitleCues([]);
          }}
          onSelectClip={(clip) => {
            setPreviewingAiItem(null);
            handleLoadClip(clip);
          }}
          onDeleteClip={(clip) => void handleDeleteClip(clip)}
          onBatchExport={(ids) => void handleBatchExport(ids)}
          onClearBatchCompleted={() => void handleClearBatchCompleted()}
          onPreviewAi={handlePreviewAi}
          onApproveAi={(item) => {
            if (previewingAiItem?.id === item.id) {
              setPreviewingAiItem(null);
              setLoadedClip(null);
            }
            void handleApproveAi(item);
          }}
          onAutoExportAi={(item) => void handleAutoExportAi(item)}
          onDismissAi={(item) => {
            if (previewingAiItem?.id === item.id) {
              setPreviewingAiItem(null);
              setLoadedClip(null);
            }
            void handleDismissAi(item);
          }}
          onTriggerAiTest={() => void handleTriggerAiTest()}
          onOpenAiFaq={() => {
            setHelpTab('ai_faq');
            setShowHelp(true);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {previewingAiItem && (
            <div className="flex items-center justify-between border-b border-cyan-500/30 bg-cyan-950/50 px-3 py-1.5 text-xs">
              <div className="flex items-center gap-2 text-cyan-200">
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                  Previewing Pending AI Clip
                </span>
                <span className="font-medium text-zinc-100">
                  #{previewingAiItem.id} · Score {previewingAiItem.score.toFixed(2)}
                </span>
                {previewingAiItem.signals.reasons[0] && (
                  <span className="text-[11px] text-zinc-400">
                    ({previewingAiItem.signals.reasons[0]})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const item = previewingAiItem;
                    setPreviewingAiItem(null);
                    setLoadedClip(null);
                    void handleApproveAi(item);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                >
                  <Check className="h-3 w-3" />
                  Approve to Clip Bin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const item = previewingAiItem;
                    setPreviewingAiItem(null);
                    setLoadedClip(null);
                    void handleDismissAi(item);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                >
                  <X className="h-3 w-3" />
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <DualViewport
            mode={mode}
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
            subtitleCues={subtitleCues}
            subtitleStyle={subtitleStyle}
            speakerColor={speakerColor}
            watermarkText={watermarkText}
            colorPreset={colorPreset}
            zoomScale={zoomScale}
            toneMuted={state?.relay?.toneMuted ?? true}
            onToggleToneMuted={() => void handleToggleToneMuted()}
            onOpenObsGuide={() => {
              setHelpTab('obs');
              setShowHelp(true);
            }}
            offAirFacecam={offAirFacecam}
            onOffAirFacecamChange={setOffAirFacecam}
            hasOffAirWebcam={Boolean(selectedWebcam)}
          />
        </div>

        <RightInspector
          mode={mode}
          audioStatus={state?.audio}
          audioDevices={audioDevices}
          selectedAudioDevices={{
            t1: state?.settings.audioT1Device ?? '',
            t2: state?.settings.audioT2Device ?? '',
            t3: state?.settings.audioT3Device ?? '',
          }}
          onSelectAudioDevice={(track, id) => void handleSelectAudioDevice(track, id)}
          onRefreshAudioDevices={() => void fetchAudioDevices()}
          refreshingAudio={refreshingAudio}
          audioGains={audioGains}
          onAudioGainsChange={setAudioGains}
          normalizeLufs={normalizeLufs}
          onNormalizeLufsChange={setNormalizeLufs}
          captionsEnabled={captionsEnabled}
          onCaptionsEnabledChange={setCaptionsEnabled}
          hasLoadedClip={loadedClip !== null}
          subtitleCues={subtitleCues}
          generatingSubtitles={generatingSubtitles}
          subtitleError={subtitleError}
          whisperModel={state?.settings.whisperModel ?? 'base.en'}
          whisperModels={state?.whisperModels ?? []}
          whisperDownload={state?.whisperDownload}
          onSelectWhisperModel={(m) => void handleSelectWhisperModel(m)}
          onGenerateSubtitles={() => void handleGenerateSubtitles()}
          onUpdateSubtitleCue={handleUpdateSubtitleCue}
          onSaveSubtitles={() => void handleSaveSubtitles()}
          subtitleStyle={subtitleStyle}
          onSubtitleStyleChange={setSubtitleStyle}
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

      <HelpSetupModal
        open={showHelp}
        initialTab={helpTab}
        lanIp={state?.lanIp}
        onClose={() => setShowHelp(false)}
      />

      <FeedbackModal
        open={showFeedback}
        state={state}
        onClose={() => setShowFeedback(false)}
      />

      {exportToast && (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-emerald-500/40 bg-zinc-900/95 p-3 text-xs shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-emerald-300">Export Ready: {exportToast.filename}</div>
            <button
              type="button"
              onClick={() => setExportToast(null)}
              className="text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
            <div className="font-medium text-zinc-100">{exportToast.hookTitle}</div>
            <div className="mt-0.5 text-[10px] text-cyan-300">{exportToast.hashtags}</div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`${exportToast.hookTitle}\n\n${exportToast.hashtags}`);
                setCopiedHook(true);
                setTimeout(() => setCopiedHook(false), 1500);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-indigo-600 px-2 py-1 font-medium text-white hover:bg-indigo-500"
            >
              {copiedHook ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedHook ? 'Copied!' : 'Copy Hook Title'}
            </button>
            {exportToast.exportDir && (
              <button
                type="button"
                onClick={() => void window.combocutDesktop?.openFolder?.(exportToast.exportDir)}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700"
              >
                <FolderOpen className="h-3 w-3 text-cyan-400" />
                Open Folder
              </button>
            )}
          </div>
        </div>
      )}

      <StorageSettingsModal
        open={showStorage}
        state={state}
        onClose={() => setShowStorage(false)}
        onChangeDvrLocation={() => void handleChangeDvrLocation()}
        onChangePinnedLocation={(moveExisting) => void handleChangePinnedLocation(moveExisting)}
        onUpdateRetention={(patch) => void handleUpdateRetention(patch)}
        onPurgeBuffer={() => handlePurgeBuffer()}
      />

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
