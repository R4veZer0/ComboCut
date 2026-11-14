import {
  BookmarkPlus,
  Cpu,
  FolderOpen,
  FolderSync,
  HardDrive,
  HelpCircle,
  Layers,
  MessageSquarePlus,
  Monitor,
  Play,
  Radio,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Tv,
} from 'lucide-react';
import type { ControlRoomState, DesktopUpdateStatus, DshowDeviceList, OffAirFacecamConfig } from '../types';

interface TopStatusBarProps {
  state: ControlRoomState | null;
  mode: 'onair' | 'offair';
  onModeChange: (mode: 'onair' | 'offair') => void;
  onPinHighlight: () => void;
  pinning: boolean;
  onToggleDemo: () => void;
  onOpenRestream: () => void;
  onOpenCleanFeed: () => void;
  onOpenWizard: () => void;
  onOpenHelp: () => void;
  onOpenFeedback: () => void;
  onOpenStorage: () => void;
  onChangeDvrLocation: () => void;
  onOpenDvrFolder: () => void;
  videoDevices: DshowDeviceList;
  selectedCaptureSource: string;
  onCaptureSourceChange: (source: string) => void;
  selectedWebcam: string;
  onWebcamChange: (device: string) => void;
  offAirFacecam?: OffAirFacecamConfig;
  onOffAirFacecamChange?: (next: OffAirFacecamConfig) => void;
  onRefreshVideoDevices: () => void;
  refreshingVideo?: boolean;
  onToggleOffAir: () => void;
  updateStatus: DesktopUpdateStatus | null;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function TopStatusBar({
  state,
  mode,
  onModeChange,
  onPinHighlight,
  pinning,
  onToggleDemo,
  onOpenRestream,
  onOpenCleanFeed,
  onOpenWizard,
  onOpenHelp,
  onOpenFeedback,
  onOpenStorage,
  onChangeDvrLocation,
  onOpenDvrFolder,
  videoDevices,
  selectedCaptureSource,
  onCaptureSourceChange,
  selectedWebcam,
  onWebcamChange,
  offAirFacecam,
  onOffAirFacecamChange,
  onRefreshVideoDevices,
  refreshingVideo,
  onToggleOffAir,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
}: TopStatusBarProps) {
  const programReady = state?.ingest.paths.find((p) => p.name === 'live/program')?.ready ?? false;
  const gpuEncoder = state?.gpu?.selected ?? 'detecting...';
  const hlsBytes = state?.hls.totalBytes ?? 0;
  const demoRunning = state?.demo?.running ?? false;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/95 px-4 py-2">
      {/* Brand + Mode Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-black text-white">
            CC
          </div>
          <span className="text-sm font-bold tracking-tight text-zinc-100">ComboCut</span>
        </div>

        <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onModeChange('onair')}
            title="On-Air OBS / RTMP Mode (Recommended for v0.2.0)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              mode === 'onair'
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            On-Air
          </button>
          <button
            type="button"
            onClick={() => onModeChange('offair')}
            title="Off-Air Capture (v0.3.0 Preview — On-Air OBS mode is recommended for v0.2.0)"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              mode === 'offair'
                ? 'bg-amber-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            Off-Air
            <span className="rounded bg-zinc-800/80 px-1 py-0.2 text-[9px] font-normal text-amber-300/90">
              v0.3.0 Preview
            </span>
          </button>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            programReady || state?.offAir.running
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              programReady || state?.offAir.running ? 'animate-pulse bg-emerald-400' : 'bg-zinc-500'
            }`}
          />
          {programReady ? 'RTMP Live' : state?.offAir.running ? `Off-Air (${state.offAir.mode})` : 'Standby'}
        </span>
      </div>

      {/* Telemetry: GPU Badge + DVR Storage Gauge */}
      <div className="flex items-center gap-3 text-xs">
        <div
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1"
          title="Active Hardware GPU Encoder"
        >
          <Cpu className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-mono text-zinc-200">{gpuEncoder}</span>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1">
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-300">
                DVR {formatBytes(hlsBytes)} ({state?.hls.segmentCount ?? 0} segs)
              </span>
              {state?.hls.freeBytes != null && (
                <span className="text-zinc-400">· {formatBytes(state.hls.freeBytes)} free</span>
              )}
              {state?.hls.ramDiskActive && (
                <span className="rounded bg-cyan-500/20 px-1 text-[10px] text-cyan-300">RAM</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="max-w-[180px] truncate font-mono" title={state?.hls.bufferDir ?? ''}>
                {state?.hls.bufferDir ?? '...'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 border-l border-zinc-800 pl-2">
            <button
              type="button"
              onClick={onOpenDvrFolder}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              title="Open DVR Buffer Folder"
            >
              <FolderOpen className="h-3 w-3 text-cyan-400" />
              Open
            </button>
            <button
              type="button"
              onClick={onChangeDvrLocation}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              title="Change DVR Location (e.g. D:\)"
            >
              <FolderSync className="h-3 w-3 text-indigo-400" />
              Change DVR
            </button>
            <button
              type="button"
              onClick={onOpenStorage}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${
                state?.dvrRetention?.lowDiskWarning
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
              title="Pinned Clips Folder, Retention & Purge Buffer"
            >
              <HardDrive className="h-3 w-3 text-emerald-400" />
              Storage
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPinHighlight}
          disabled={pinning}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          {pinning ? 'Pinning...' : 'Mark Highlight'}
        </button>

        <button
          type="button"
          onClick={onToggleDemo}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
            demoRunning
              ? 'border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          {demoRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {demoRunning ? 'Stop Demo' : 'Demo Stream'}
        </button>

        <button
          type="button"
          onClick={onOpenRestream}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          title="Restream Targets"
        >
          <Sliders className="h-3.5 w-3.5" />
          Restream
        </button>

        <button
          type="button"
          onClick={onOpenCleanFeed}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          title="Tier-2 Clean-Feed Recipes"
        >
          <Layers className="h-3.5 w-3.5" />
          Clean-Feed
        </button>

        <button
          type="button"
          onClick={onOpenWizard}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/25"
          title="60-Second Setup Wizard"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Wizard
        </button>

        <button
          type="button"
          onClick={onOpenHelp}
          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
          title="OBS, Off-Air & Dual-PC Setup Guide"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Help / Setup
        </button>

        <button
          type="button"
          onClick={onOpenFeedback}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
          title="Send Beta Feedback or Bug Report"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Feedback
        </button>

        {updateStatus?.state === 'downloaded' ? (
          <button
            type="button"
            onClick={onInstallUpdate}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Restart to Install
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheckUpdates}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
            title="Check for Updates"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${updateStatus?.state === 'checking' ? 'animate-spin' : ''}`} />
            Check for Updates
          </button>
        )}
      </div>

      {mode === 'offair' && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
              <Monitor className="h-3.5 w-3.5" />
              Off-Air Source:
            </span>
            <select
              value={selectedCaptureSource}
              onChange={(e) => onCaptureSourceChange(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="ddagrab">Desktop Screen (DXGI Hardware)</option>
              {videoDevices.video.map((dev) => (
                <option key={dev} value={`dshow:${dev}`}>
                  Capture Card / Cam: {dev}
                </option>
              ))}
            </select>

            <span className="text-zinc-400">Facecam:</span>
            <select
              value={selectedWebcam}
              onChange={(e) => onWebcamChange(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">None</option>
              {videoDevices.video.map((dev) => (
                <option key={dev} value={dev}>
                  {dev}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onRefreshVideoDevices}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              title="Refresh DirectShow Capture Cards & Webcams"
            >
              <RefreshCw className={`h-3 w-3 ${refreshingVideo ? 'animate-spin' : ''}`} />
              Scan Cards
            </button>
          </div>

          <div className="flex items-center gap-2">
            {state?.offAir.lastAutoReleaseReason && (
              <span className="text-[11px] text-amber-300">
                Auto-released ({state.offAir.lastAutoReleaseReason})
              </span>
            )}
            <button
              type="button"
              onClick={onToggleOffAir}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold ${
                state?.offAir.running
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {state?.offAir.running ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {state?.offAir.running ? 'Stop Off-Air Capture' : 'Start Off-Air Capture'}
            </button>
          </div>
        </div>
      )}

      {mode === 'offair' && selectedWebcam && offAirFacecam && onOffAirFacecamChange && (
        <div className="flex w-full flex-wrap items-center gap-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] text-zinc-200">
          <span className="font-semibold text-amber-300">Facecam Framing:</span>

          {/* Corner Presets */}
          <div className="flex items-center gap-1">
            <span className="text-zinc-400">Corner:</span>
            {(
              [
                { label: 'BR', x: 1 - offAirFacecam.widthPct / 100 - 0.02, y: 0.68, title: 'Bottom-Right' },
                { label: 'BL', x: 0.02, y: 0.68, title: 'Bottom-Left' },
                { label: 'TR', x: 1 - offAirFacecam.widthPct / 100 - 0.02, y: 0.04, title: 'Top-Right' },
                { label: 'TL', x: 0.02, y: 0.04, title: 'Top-Left' },
              ] as const
            ).map((pos) => (
              <button
                key={pos.label}
                type="button"
                title={pos.title}
                onClick={() =>
                  onOffAirFacecamChange({
                    ...offAirFacecam,
                    x: Math.max(0, Math.min(0.85, pos.x)),
                    y: pos.y,
                  })
                }
                className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-800"
              >
                {pos.label}
              </button>
            ))}
          </div>

          {/* Size Slider (15% - 50%) */}
          <label className="flex items-center gap-1.5">
            <span className="text-zinc-400">Size {offAirFacecam.widthPct}%</span>
            <input
              type="range"
              min={15}
              max={50}
              step={1}
              value={offAirFacecam.widthPct}
              onChange={(e) =>
                onOffAirFacecamChange({ ...offAirFacecam, widthPct: Number(e.target.value) })
              }
              className="w-20 accent-amber-400"
            />
          </label>

          {/* Zoom Slider (1.0x - 2.0x) */}
          <label className="flex items-center gap-1.5">
            <span className="text-zinc-400">Zoom {offAirFacecam.zoom.toFixed(1)}x</span>
            <input
              type="range"
              min={1.0}
              max={2.0}
              step={0.1}
              value={offAirFacecam.zoom}
              onChange={(e) =>
                onOffAirFacecamChange({ ...offAirFacecam, zoom: Number(e.target.value) })
              }
              className="w-16 accent-amber-400"
            />
          </label>

          {/* Mirror Toggle */}
          <button
            type="button"
            onClick={() =>
              onOffAirFacecamChange({ ...offAirFacecam, mirror: !offAirFacecam.mirror })
            }
            className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
              offAirFacecam.mirror
                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Mirror
          </button>

          {/* Shape Selector */}
          <select
            value={offAirFacecam.shape}
            onChange={(e) =>
              onOffAirFacecamChange({
                ...offAirFacecam,
                shape: e.target.value as OffAirFacecamConfig['shape'],
              })
            }
            className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200"
          >
            <option value="rectangle">Rectangle</option>
            <option value="rounded">Rounded</option>
            <option value="circle">Circle</option>
          </select>

          {/* Border Toggle */}
          <label className="flex items-center gap-1 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              checked={offAirFacecam.border}
              onChange={(e) =>
                onOffAirFacecamChange({ ...offAirFacecam, border: e.target.checked })
              }
              className="rounded border-zinc-700"
            />
            Border
          </label>
        </div>
      )}

      {updateStatus && updateStatus.state !== 'idle' && (
        <div
          className={`flex w-full items-center justify-between rounded-md px-3 py-1 text-[11px] ${
            updateStatus.state === 'error'
              ? 'bg-rose-500/15 text-rose-300'
              : updateStatus.state === 'downloaded' || updateStatus.state === 'available'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-indigo-500/15 text-indigo-300'
          }`}
        >
          <span>{updateStatus.message}</span>
          {updateStatus.state === 'downloaded' && (
            <button
              type="button"
              onClick={onInstallUpdate}
              className="font-semibold underline hover:text-white"
            >
              Restart to Install
            </button>
          )}
        </div>
      )}
    </header>
  );
}
