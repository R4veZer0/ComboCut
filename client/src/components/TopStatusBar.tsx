import {
  BookmarkPlus,
  Cpu,
  HardDrive,
  Layers,
  Play,
  Radio,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Tv,
} from 'lucide-react';
import type { ControlRoomState, DesktopUpdateStatus } from '../types';

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
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
}: TopStatusBarProps) {
  const programReady = state?.ingest.paths.find((p) => p.name === 'live/program')?.ready ?? false;
  const gpuEncoder = state?.gpu?.selected ?? 'detecting...';
  const hlsBytes = state?.hls.totalBytes ?? 0;
  const maxEstBytes = (state?.settings.bufferMinutes ?? 20) * 60 * 1024 * 1024 * 0.9; // ~7.2 Mbps estimate
  const gaugePct = Math.min(100, Math.round((hlsBytes / Math.max(1, maxEstBytes)) * 100));
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
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              mode === 'offair'
                ? 'bg-amber-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            Off-Air
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
          <HardDrive className="h-3.5 w-3.5 text-cyan-400" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-300">
                DVR {formatBytes(hlsBytes)} ({state?.hls.segmentCount ?? 0} segs)
              </span>
              {state?.hls.ramDiskActive && (
                <span className="rounded bg-cyan-500/20 px-1 text-[10px] text-cyan-300">RAM</span>
              )}
            </div>
            <div className="mt-0.5 h-1 w-28 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${Math.max(4, gaugePct)}%` }}
              />
            </div>
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
