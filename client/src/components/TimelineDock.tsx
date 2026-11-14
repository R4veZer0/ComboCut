import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Palette,
  Pause,
  Play,
  Rewind,
  Scissors,
  Sparkles,
  Volume2,
  ZoomIn,
} from 'lucide-react';
import type { ColorPreset, TimelineMarker } from '../types';

interface TimelineDockProps {
  durationSec: number;
  currentTimeSec: number;
  onSeek: (sec: number) => void;
  inSec: number;
  outSec: number;
  onInSecChange: (sec: number) => void;
  onOutSecChange: (sec: number) => void;
  shuttleRate: number;
  onShuttleChange: (rate: number) => void;
  markers: TimelineMarker[];
  expanded: boolean;
  onToggleExpanded: () => void;
  colorPreset: ColorPreset;
  onColorPresetChange: (preset: ColorPreset) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  zoomScale: number;
  onZoomScaleChange: (zoom: number) => void;
}

export function TimelineDock({
  durationSec,
  currentTimeSec,
  onSeek,
  inSec,
  outSec,
  onInSecChange,
  onOutSecChange,
  shuttleRate,
  onShuttleChange,
  markers,
  expanded,
  onToggleExpanded,
  colorPreset,
  onColorPresetChange,
  speed,
  onSpeedChange,
  zoomScale,
  onZoomScaleChange,
}: TimelineDockProps) {
  const [splits, setSplits] = useState<number[]>([]);
  const [sfxLabel, setSfxLabel] = useState<string>('Vine Boom');
  const [overlayLabel, setOverlayLabel] = useState<string>('PNG / Text Overlay');

  const safeDur = Math.max(1, durationSec);

  function addSplitAtPlayhead() {
    const rounded = Math.round(currentTimeSec * 10) / 10;
    if (!splits.includes(rounded)) {
      setSplits((prev) => [...prev, rounded].sort((a, b) => a - b));
    }
  }

  // Keyboard shortcuts: J/K/L, I/O, Ctrl+K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        addSplitAtPlayhead();
        return;
      }
      if (e.key.toLowerCase() === 'j') {
        onShuttleChange(-2);
      } else if (e.key.toLowerCase() === 'k') {
        onShuttleChange(0);
      } else if (e.key.toLowerCase() === 'l') {
        onShuttleChange(shuttleRate === 1 ? 2 : 1);
      } else if (e.key.toLowerCase() === 'i') {
        onInSecChange(Math.round(currentTimeSec * 10) / 10);
      } else if (e.key.toLowerCase() === 'o') {
        onOutSecChange(Math.round(currentTimeSec * 10) / 10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/95 px-4 py-2 text-xs">
      {/* Quick Clip Scrubber Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onShuttleChange(-2)}
            className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700"
            title="Shuttle Back (J)"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onShuttleChange(shuttleRate === 0 ? 1 : 0)}
            className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-200 hover:bg-zinc-700"
            title="Pause / Play (K)"
          >
            {shuttleRate === 0 ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onShuttleChange(shuttleRate === 1 ? 2 : 1)}
            className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700"
            title="Shuttle Forward (L)"
          >
            <FastForward className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[11px] text-zinc-400">
            {currentTimeSec.toFixed(1)}s / {safeDur.toFixed(1)}s ({shuttleRate}x)
          </span>
        </div>

        {/* In/Out + Markers */}
        <div className="flex flex-1 items-center gap-3">
          <button
            type="button"
            onClick={() => onInSecChange(Math.round(currentTimeSec * 10) / 10)}
            className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300"
            title="Set In Point (I)"
          >
            IN {inSec.toFixed(1)}s
          </button>

          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={safeDur}
              step={0.1}
              value={Math.min(safeDur, currentTimeSec)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            {/* Split ticks */}
            {splits.map((s) => (
              <span
                key={s}
                style={{ left: `${(s / safeDur) * 100}%` }}
                className="pointer-events-none absolute top-0 h-3 w-0.5 bg-rose-400"
                title={`Split @ ${s}s`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => onOutSecChange(Math.round(currentTimeSec * 10) / 10)}
            className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300"
            title="Set Out Point (O)"
          >
            OUT {outSec.toFixed(1)}s
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-zinc-500 lg:inline">
            Markers: {markers.length} • Keys: J/K/L, I/O, Ctrl+K
          </span>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-500/25"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            Studio Mini-Editor
          </button>
        </div>
      </div>

      {/* Expandable CapCut/Edits-Style Stacked Multi-Track Mini-Editor */}
      {expanded && (
        <div className="mt-3 space-y-2.5 border-t border-zinc-800 pt-3">
          {/* Mini-Editor Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addSplitAtPlayhead}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
              >
                <Scissors className="h-3 w-3 text-rose-400" />
                Blade Split (Ctrl+K)
              </button>

              <label className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300">
                <ZoomIn className="h-3 w-3 text-cyan-400" />
                Punch-In Zoom
                <input
                  type="range"
                  min={1}
                  max={1.6}
                  step={0.05}
                  value={zoomScale}
                  onChange={(e) => onZoomScaleChange(Number(e.target.value))}
                  className="w-16 accent-cyan-500"
                />
                <span className="font-mono">{zoomScale.toFixed(2)}x</span>
              </label>

              <label className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300">
                <Sparkles className="h-3 w-3 text-amber-400" />
                Speed Ramp
                <select
                  value={speed}
                  onChange={(e) => onSpeedChange(Number(e.target.value))}
                  className="bg-transparent text-zinc-200 outline-none"
                >
                  <option value={0.5} className="bg-zinc-900">0.5x Slow-Mo</option>
                  <option value={1} className="bg-zinc-900">1.0x Normal</option>
                  <option value={1.25} className="bg-zinc-900">1.25x Fast</option>
                  <option value={1.5} className="bg-zinc-900">1.5x Hype</option>
                  <option value={2} className="bg-zinc-900">2.0x Ramp</option>
                </select>
              </label>

              <label className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300">
                <Palette className="h-3 w-3 text-purple-400" />
                Color
                <select
                  value={colorPreset}
                  onChange={(e) => onColorPresetChange(e.target.value as ColorPreset)}
                  className="bg-transparent text-zinc-200 outline-none"
                >
                  <option value="none" className="bg-zinc-900">Natural</option>
                  <option value="vibrant" className="bg-zinc-900">Vibrant</option>
                  <option value="cinematic" className="bg-zinc-900">Cinematic</option>
                  <option value="crisp" className="bg-zinc-900">Crisp Sharp</option>
                </select>
              </label>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <select
                value={sfxLabel}
                onChange={(e) => setSfxLabel(e.target.value)}
                className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300"
              >
                <option value="Vine Boom">SFX: Vine Boom</option>
                <option value="Whoosh Transition">SFX: Whoosh</option>
                <option value="Hitmarker">SFX: Hitmarker</option>
              </select>
              <input
                type="text"
                value={overlayLabel}
                onChange={(e) => setOverlayLabel(e.target.value)}
                className="w-36 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300"
                placeholder="Overlay label..."
              />
            </div>
          </div>

          {/* Stacked Multi-Track Lanes */}
          <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
            <TrackLane name="Gameplay" color="bg-cyan-500/25 border-cyan-500/50 text-cyan-200" detail={`Crop + ${colorPreset}`} />
            <TrackLane name="Facecam" color="bg-amber-500/25 border-amber-500/50 text-amber-200" detail={`Zoom ${zoomScale.toFixed(2)}x`} />
            <TrackLane name="Captions" color="bg-yellow-500/20 border-yellow-500/40 text-yellow-200" detail="Speaker-Colored Burn-In" />
            <TrackLane name="Overlays" color="bg-purple-500/20 border-purple-500/40 text-purple-200" detail={overlayLabel} />
            <TrackLane
              name="SFX"
              color="bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
              detail={sfxLabel}
              icon={<Volume2 className="h-3 w-3" />}
            />
          </div>
        </div>
      )}
    </footer>
  );
}

function TrackLane({
  name,
  color,
  detail,
  icon,
}: {
  name: string;
  color: string;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 shrink-0 text-[11px] font-medium text-zinc-400">{name}</div>
      <div className={`flex flex-1 items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${color}`}>
        {icon}
        <span className="truncate">{detail}</span>
      </div>
    </div>
  );
}
