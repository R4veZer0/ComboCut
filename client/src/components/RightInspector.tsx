import { Download, Mic, MessageSquare, RefreshCw, Save, Sparkles, Stamp, Subtitles, Volume2 } from 'lucide-react';
import type {
  AudioDeviceInfo,
  SubtitleCue,
  SubtitleStyle,
  WasapiAudioStatus,
  WhisperDownloadState,
  WhisperModelId,
  WhisperModelInfo,
} from '../types';

interface RightInspectorProps {
  mode: 'onair' | 'offair';
  audioStatus: WasapiAudioStatus | undefined;
  audioDevices: AudioDeviceInfo[];
  selectedAudioDevices: { t1: string; t2: string; t3: string };
  onSelectAudioDevice: (track: 't1' | 't2' | 't3', deviceId: string) => void;
  onRefreshAudioDevices: () => void;
  refreshingAudio?: boolean;
  audioGains: { t1: number; t2: number; t3: number };
  onAudioGainsChange: (next: { t1: number; t2: number; t3: number }) => void;
  normalizeLufs: boolean;
  onNormalizeLufsChange: (val: boolean) => void;
  captionsEnabled: boolean;
  onCaptionsEnabledChange: (val: boolean) => void;
  hasLoadedClip: boolean;
  subtitleCues: SubtitleCue[];
  generatingSubtitles: boolean;
  subtitleError: string | null;
  whisperModel?: WhisperModelId;
  whisperModels?: WhisperModelInfo[];
  whisperDownload?: WhisperDownloadState;
  onSelectWhisperModel?: (modelId: WhisperModelId) => void;
  onGenerateSubtitles: () => void;
  onUpdateSubtitleCue: (id: number, text: string) => void;
  onSaveSubtitles: () => void;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyleChange: (next: SubtitleStyle) => void;
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
  mode,
  audioStatus,
  audioDevices,
  selectedAudioDevices,
  onSelectAudioDevice,
  onRefreshAudioDevices,
  refreshingAudio,
  audioGains,
  onAudioGainsChange,
  normalizeLufs,
  onNormalizeLufsChange,
  captionsEnabled,
  onCaptionsEnabledChange,
  hasLoadedClip,
  subtitleCues,
  generatingSubtitles,
  subtitleError,
  whisperModel = 'base.en',
  whisperModels = [],
  whisperDownload,
  onSelectWhisperModel,
  onGenerateSubtitles,
  onUpdateSubtitleCue,
  onSaveSubtitles,
  subtitleStyle,
  onSubtitleStyleChange,
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
  const isOnAir = mode === 'onair';

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRefreshAudioDevices}
                disabled={isOnAir}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                title="Refresh Audio Devices"
              >
                <RefreshCw className={`h-2.5 w-2.5 ${refreshingAudio ? 'animate-spin' : ''}`} />
                Refresh
              </button>
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
          </div>

          <div
            className={`rounded border px-2 py-1.5 text-[10px] font-medium ${
              isOnAir
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            }`}
          >
            {isOnAir
              ? 'On-Air Mode: Using OBS Studio Audio Mix (WASAPI capture paused)'
              : 'Off-Air Mode: Using ComboCut 3-Track WASAPI Audio'}
          </div>

          <TrackFader
            label="Track 1: Game / Capture"
            icon={<Volume2 className="h-3 w-3 text-cyan-400" />}
            value={audioGains.t1}
            rms={meters.t1}
            devices={audioDevices}
            selectedDeviceId={selectedAudioDevices.t1}
            disabled={isOnAir}
            onDeviceChange={(id) => onSelectAudioDevice('t1', id)}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t1: v })}
          />
          <TrackFader
            label="Track 2: Discord / Party"
            icon={<MessageSquare className="h-3 w-3 text-indigo-400" />}
            value={audioGains.t2}
            rms={meters.t2}
            devices={audioDevices.filter((d) => d.flow === 'render')}
            selectedDeviceId={selectedAudioDevices.t2}
            disabled={isOnAir}
            onDeviceChange={(id) => onSelectAudioDevice('t2', id)}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t2: v })}
          />
          <TrackFader
            label="Track 3: User Mic"
            icon={<Mic className="h-3 w-3 text-amber-400" />}
            value={audioGains.t3}
            rms={meters.t3}
            devices={audioDevices.filter((d) => d.flow === 'capture')}
            selectedDeviceId={selectedAudioDevices.t3}
            disabled={isOnAir}
            onDeviceChange={(id) => onSelectAudioDevice('t3', id)}
            onChange={(v) => onAudioGainsChange({ ...audioGains, t3: v })}
          />
        </section>

        {/* Speech-to-Text Subtitles (whisper.cpp) */}
        <section className="space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Subtitles className="h-3.5 w-3.5 text-yellow-400" />
              Subtitles (Speech-to-Text)
            </h2>
            <label className="flex items-center gap-1 text-[10px] text-zinc-300" title="Burn-In Subtitles on Export">
              <input
                type="checkbox"
                checked={captionsEnabled}
                onChange={(e) => onCaptionsEnabledChange(e.target.checked)}
              />
              Burn-In
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasLoadedClip || generatingSubtitles}
              onClick={onGenerateSubtitles}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-yellow-500/40 bg-yellow-500/15 px-2 py-1 text-[11px] font-medium text-yellow-200 hover:bg-yellow-500/25 disabled:opacity-40"
            >
              <Sparkles className={`h-3 w-3 ${generatingSubtitles ? 'animate-spin' : ''}`} />
              {generatingSubtitles ? 'Transcribing...' : 'Generate Subtitles'}
            </button>
            {subtitleCues.length > 0 && (
              <button
                type="button"
                onClick={onSaveSubtitles}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                title="Save edited subtitle cues & .srt"
              >
                <Save className="h-3 w-3 text-emerald-400" />
                Save
              </button>
            )}
          </div>

          {subtitleError && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 p-1.5 text-[10px] text-rose-300">
              {subtitleError}
            </div>
          )}

          {/* Whisper Model Switcher */}
          <div className="space-y-1 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-400">
            <div className="flex items-center justify-between">
              <span>Whisper Model</span>
              {whisperDownload?.downloading && (
                <span className="font-mono text-cyan-300">
                  Downloading {whisperDownload.model}: {whisperDownload.percent}%
                </span>
              )}
            </div>
            <select
              value={whisperModel}
              onChange={(e) => onSelectWhisperModel?.(e.target.value as WhisperModelId)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-200"
            >
              {(whisperModels.length > 0
                ? whisperModels
                : [
                    { id: 'base.en', label: 'Base English (Fast, ~148 MB)', downloaded: false },
                    { id: 'small', label: 'Small Multilingual (~488 MB)', downloaded: false },
                    { id: 'large-v3-turbo', label: 'Large v3 Turbo (~574 MB)', downloaded: false },
                  ]
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} {m.downloaded ? '✓' : ''}
                </option>
              ))}
            </select>
            {whisperDownload?.downloading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${whisperDownload.percent}%` }}
                />
              </div>
            )}
          </div>

          {/* Style Controls */}
          <div className="grid grid-cols-2 gap-1.5 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-400">
            <label className="flex flex-col gap-0.5">
              <span>Size ({subtitleStyle.fontSize}px)</span>
              <input
                type="range"
                min={28}
                max={76}
                step={2}
                value={subtitleStyle.fontSize}
                onChange={(e) =>
                  onSubtitleStyleChange({ ...subtitleStyle, fontSize: Number(e.target.value) })
                }
                className="h-1 w-full accent-yellow-400"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span>Position</span>
              <select
                value={subtitleStyle.verticalPos}
                onChange={(e) =>
                  onSubtitleStyleChange({
                    ...subtitleStyle,
                    verticalPos: e.target.value as 'top' | 'middle' | 'bottom',
                  })
                }
                className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-200"
              >
                <option value="bottom">Bottom</option>
                <option value="middle">Middle</option>
                <option value="top">Top</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>Highlight Color</span>
            <div className="flex items-center gap-1.5">
              {[
                { label: 'Streamer', hex: '#facc15' },
                { label: 'Party', hex: '#38bdf8' },
                { label: 'Hype', hex: '#fb7185' },
                { label: 'Clean', hex: '#ffffff' },
              ].map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => {
                    onSpeakerColorChange(c.hex);
                    onSubtitleStyleChange({ ...subtitleStyle, colorHex: c.hex });
                  }}
                  style={{ backgroundColor: c.hex }}
                  className={`h-4 w-4 rounded-full border ${
                    speakerColor === c.hex ? 'border-white ring-1 ring-white' : 'border-zinc-700'
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Scrollable Editable Timestamped Cues */}
          <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/70 p-1.5">
            {!hasLoadedClip ? (
              <p className="py-2 text-center text-[10px] text-zinc-500">
                Load a clip from the Clip Bin to transcribe speech.
              </p>
            ) : subtitleCues.length === 0 ? (
              <p className="py-2 text-center text-[10px] text-zinc-500">
                {generatingSubtitles
                  ? 'Running whisper.cpp speech-to-text...'
                  : 'No subtitles yet. Click Generate Subtitles.'}
              </p>
            ) : (
              subtitleCues.map((cue) => (
                <div key={cue.id} className="space-y-0.5 rounded border border-zinc-800/80 bg-zinc-900/70 p-1">
                  <div className="font-mono text-[9px] text-zinc-500">
                    {cue.startSec.toFixed(1)}s &rarr; {cue.endSec.toFixed(1)}s
                  </div>
                  <input
                    type="text"
                    value={cue.text}
                    onChange={(e) => onUpdateSubtitleCue(cue.id, e.target.value)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200"
                  />
                </div>
              ))
            )}
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
  devices,
  selectedDeviceId,
  disabled,
  onDeviceChange,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  rms: number;
  devices: AudioDeviceInfo[];
  selectedDeviceId: string;
  disabled?: boolean;
  onDeviceChange: (deviceId: string) => void;
  onChange: (val: number) => void;
}) {
  const meterPct = Math.min(100, Math.round(rms * 300));
  return (
    <div className={`rounded border border-zinc-800 bg-zinc-950/70 p-2 ${disabled ? 'opacity-65' : ''}`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-zinc-300">
          {icon}
          {label}
        </span>
        <span className="font-mono text-zinc-400">{Math.round(value * 100)}%</span>
      </div>
      <select
        value={selectedDeviceId}
        disabled={disabled}
        onChange={(e) => onDeviceChange(e.target.value)}
        className="mt-1.5 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Auto (Windows Default)</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.flow === 'capture' ? '[In] ' : '[Out] '}
            {d.name}
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-1.5 w-full accent-indigo-500"
      />
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${meterPct}%` }} />
      </div>
    </div>
  );
}
