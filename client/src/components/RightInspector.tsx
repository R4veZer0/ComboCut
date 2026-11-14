import { Download, Mic, MessageSquare, Stamp, Subtitles, Volume2 } from 'lucide-react';
import type { WasapiAudioStatus } from '../types';

interface RightInspectorProps {
  audioStatus: WasapiAudioStatus | undefined;
  audioGains: { t1: number; t2: number; t3: number };
  onAudioGainsChange: (next: { t1: number; t2: number; t3: number }) => void;
  normalizeLufs: boolean;
  onNormalizeLufsChange: (val: boolean) => void;
  captionsEnabled: boolean;
  onCaptionsEnabledChange: (val: boolean) => void;
  captionText: string;
  onCaptionTextChange: (val: string) => void;
  speakerColor: string;
  onSpeakerColorChange: (val: string) => void;
  watermarkText: string;
  onWatermarkTextChange: (val: string) => void;
  exporting: boolean;
  lastExportUrl: string | null;
  exportError: string | null;
  onExportClip: () => void;
}

export function RightInspector({
  audioStatus,
  audioGains,
  onAudioGainsChange,
  normalizeLufs,
  onNormalizeLufsChange,
  captionsEnabled,
  onCaptionsEnabledChange,
  captionText,
  onCaptionTextChange,
  speakerColor,
  onSpeakerColorChange,
  watermarkText,
  onWatermarkTextChange,
  exporting,
  lastExportUrl,
  exportError,
  onExportClip,
}: RightInspectorProps) {
  const meters = audioStatus?.meters ?? { t1: 0, t2: 0, t3: 0 };

  return (
    <aside className="flex w-72 shrink-0 flex-col justify-between border-l border-zinc-800 bg-zinc-900/50 p-3 text-xs">
      <div className="space-y-4 overflow-y-auto">
        {/* 3-Track Audio Mixer */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
              3-Track Audio Mixer
            </h2>
            <label className="flex items-center gap-1 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={normalizeLufs}
                onChange={(e) => onNormalizeLufsChange(e.target.checked)}
                className="rounded border-zinc-700"
              />
              -14 LUFS
            </label>
          </div>

          <TrackFader
            label="Track 1: Game / System"
            icon={<Volume2 className="h-3 w-3 text-cyan-400" />}
            value={audioGains.t1}
            rms={meters.t1}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t1: v })}
          />
          <TrackFader
            label="Track 2: Discord / Party"
            icon={<MessageSquare className="h-3 w-3 text-indigo-400" />}
            value={audioGains.t2}
            rms={meters.t2}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t2: v })}
          />
          <TrackFader
            label="Track 3: User Mic"
            icon={<Mic className="h-3 w-3 text-amber-400" />}
            value={audioGains.t3}
            rms={meters.t3}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t3: v })}
          />
        </section>

        {/* Speaker-Colored GPU Captions */}
        <section className="space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Subtitles className="h-3.5 w-3.5 text-yellow-400" />
              GPU Captions
            </h2>
            <input
              type="checkbox"
              checked={captionsEnabled}
              onChange={(e) => onCaptionsEnabledChange(e.target.checked)}
            />
          </div>

          <input
            type="text"
            value={captionText}
            onChange={(e) => onCaptionTextChange(e.target.value)}
            placeholder="Caption overlay / Whisper text..."
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          />

          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>Speaker Color</span>
            <div className="flex items-center gap-1.5">
              {[
                { label: 'Streamer', hex: '#facc15' },
                { label: 'Party', hex: '#38bdf8' },
                { label: 'Hype', hex: '#fb7185' },
              ].map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => onSpeakerColorChange(c.hex)}
                  style={{ backgroundColor: c.hex }}
                  className={`h-4 w-4 rounded-full border ${
                    speakerColor === c.hex ? 'border-white ring-1 ring-white' : 'border-zinc-700'
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Brand Watermark */}
        <section className="space-y-2 border-t border-zinc-800 pt-3">
          <h2 className="flex items-center gap-1.5 font-semibold text-zinc-200">
            <Stamp className="h-3.5 w-3.5 text-rose-400" />
            Brand Watermark
          </h2>
          <input
            type="text"
            value={watermarkText}
            onChange={(e) => onWatermarkTextChange(e.target.value)}
            placeholder="@YourHandle"
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          />
        </section>
      </div>

      {/* Single-Pass FFmpeg GPU Export */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <button
          type="button"
          onClick={onExportClip}
          disabled={exporting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Rendering GPU MP4...' : 'Export 9:16 MP4'}
        </button>

        {exportError && (
          <div className="rounded bg-rose-500/15 px-2 py-1 text-[11px] text-rose-300">
            {exportError}
          </div>
        )}

        {lastExportUrl && (
          <a
            href={lastExportUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded bg-emerald-500/15 px-2 py-1.5 text-center text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
          >
            Download Rendered MP4
          </a>
        )}
      </div>
    </aside>
  );
}

function TrackFader({
  label,
  icon,
  value,
  rms,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  rms: number;
  onChange: (val: number) => void;
}) {
  const meterPct = Math.min(100, Math.round(rms * 300));
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-zinc-300">
          {icon}
          {label}
        </span>
        <span className="font-mono text-zinc-400">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full accent-indigo-500"
      />
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${meterPct}%` }} />
      </div>
    </div>
  );
}
