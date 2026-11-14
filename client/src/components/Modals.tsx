import { useState } from 'react';
import { Check, Copy, Cpu, Layers, Play, Radio, Sparkles, X } from 'lucide-react';
import type { ControlRoomState } from '../types';

export function SetupWizardModal({
  open,
  state,
  onClose,
  onStartDemo,
}: {
  open: boolean;
  state: ControlRoomState | null;
  onClose: () => void;
  onStartDemo: () => void;
}) {
  const [step, setStep] = useState(1);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-zinc-100">
              ComboCut 60-Second Setup Wizard ({step}/3)
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-4">
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Cpu className="h-4 w-4 text-indigo-400" />
                Step 1: Hardware GPU & Storage Check
              </div>
              <p className="text-zinc-400">
                ComboCut auto-probed your system and selected{' '}
                <strong className="text-indigo-300">{state?.gpu?.selected ?? 'h264_nvenc'}</strong>{' '}
                for zero-lag clipping and restreaming.
              </p>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300">
                Rolling DVR Buffer: <strong>{state?.settings.bufferMinutes ?? 20} minutes</strong>{' '}
                (2-second segments) in <code>{state?.hls.bufferDir ?? '/buffer'}</code>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Radio className="h-4 w-4 text-emerald-400" />
                Step 2: Choose On-Air (OBS) or Off-Air Capture
              </div>
              <p className="text-zinc-400">
                In <strong>On-Air Mode</strong>, point OBS Studio to{' '}
                <code className="text-emerald-300">rtmp://127.0.0.1:1935/live/program</code>. In{' '}
                <strong>Off-Air Mode</strong>, ComboCut captures directly via DXGI (<code>ddagrab</code>)
                or DirectShow capture cards + 3-track WASAPI audio.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Play className="h-4 w-4 text-rose-400" />
                Step 3: Try Built-In Demo Stream or Go Live
              </div>
              <p className="text-zinc-400">
                No OBS open right now? Launch the built-in 1080p60 synthetic Demo Stream to test
                DVR scrubbing, dual-viewport cropping, and instant <code>/pinned</code> clipping.
              </p>
              <button
                type="button"
                onClick={() => {
                  onStartDemo();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500"
              >
                <Play className="h-3.5 w-3.5" />
                Launch Demo Stream & Enter Studio
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200"
          >
            Skip Wizard
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-zinc-200"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="rounded bg-indigo-600 px-3 py-1 font-medium text-white hover:bg-indigo-500"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500"
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CleanFeedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  if (!open) return null;

  const recipes = [
    {
      title: 'Master Program Feed (Tier 1)',
      url: 'rtmp://127.0.0.1:1935/live/program',
      desc: 'Primary OBS/vMix broadcast output routed to DVR buffer & Twitch/YouTube/Kick restreamers.',
    },
    {
      title: 'Clean Facecam Feed (Tier 2)',
      url: 'rtmp://127.0.0.1:1935/live/cam',
      desc: 'OBS Source Record / Secondary RTMP output for uncropped 1080p full-frame facecam.',
    },
    {
      title: 'Clean Gameplay Feed (Tier 2)',
      url: 'rtmp://127.0.0.1:1935/live/clean',
      desc: 'HUD-free or overlay-free gameplay feed for ultra-clean vertical Shorts/TikTok edits.',
    },
  ];

  function copy(url: string) {
    void navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-zinc-100">Tier-2 Clean-Feed Recipe Cards</h2>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {recipes.map((r) => (
            <div key={r.url} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="font-semibold text-zinc-100">{r.title}</div>
              <p className="mt-0.5 text-[11px] text-zinc-400">{r.desc}</p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-cyan-300">
                <span>{r.url}</span>
                <button
                  type="button"
                  onClick={() => copy(r.url)}
                  className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700"
                >
                  {copiedUrl === r.url ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedUrl === r.url ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
