import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  FolderSync,
  HardDrive,
  HelpCircle,
  Keyboard,
  Layers,
  MessageSquarePlus,
  Monitor,
  Play,
  Radio,
  Send,
  Sparkles,
  Trash2,
  Tv,
  Wrench,
  X,
} from 'lucide-react';
import type { AiDetectionMode, AiSensitivity, AiVisualFocus, ControlRoomState } from '../types';
import { FEEDBACK_CATEGORIES, FEEDBACK_FORM_CONFIG, type FeedbackCategory } from '../config/feedbackForm';

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

export type HelpSetupTab = 'obs' | 'offair' | 'dualpc' | 'shortcuts' | 'ai_faq';

export function HelpSetupModal({
  open,
  initialTab = 'obs',
  lanIp,
  onClose,
}: {
  open: boolean;
  initialTab?: HelpSetupTab;
  lanIp?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<HelpSetupTab>(initialTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  if (!open) return null;

  const copyValue = (key: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
  };

  const tabs: Array<{ id: HelpSetupTab; label: string; icon: typeof Radio }> = [
    { id: 'obs', label: 'OBS Studio Live', icon: Radio },
    { id: 'offair', label: 'Off-Air Single-PC', icon: Monitor },
    { id: 'dualpc', label: 'Dual-PC & Capture Card', icon: Tv },
    { id: 'shortcuts', label: 'Shortcuts & Fixes', icon: Keyboard },
    { id: 'ai_faq', label: 'AI Scoring & Queue FAQ', icon: Sparkles },
  ];

  const CopyRow = ({ id, label, value }: { id: string; label: string; value: string }) => (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="truncate font-mono text-xs text-cyan-300">{value}</div>
      </div>
      <button
        type="button"
        onClick={() => copyValue(id, value)}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
      >
        {copiedKey === id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        {copiedKey === id ? 'Copied' : 'Copy'}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-zinc-100">ComboCut Setup &amp; User Guide</h2>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 bg-zinc-950/60 px-5 py-2.5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 text-zinc-300">
          {tab === 'obs' && (
            <div className="space-y-3">
              <p className="text-zinc-400">
                Point OBS Studio at ComboCut&apos;s local RTMP server so ComboCut can record your rolling DVR buffer,
                auto-detect highlights, and restream to Twitch, YouTube, or Kick simultaneously.
              </p>
              <div className="space-y-2">
                <CopyRow id="obs-server" label="OBS Settings -> Stream -> Service: Custom... -> Server" value="rtmp://127.0.0.1:1935/live" />
                <CopyRow id="obs-key" label="Stream Key" value="program" />
                <CopyRow id="obs-ws" label="OBS WebSocket v5 (Tools -> WebSocket Server Settings)" value="ws://127.0.0.1:4455" />
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                <div className="font-semibold">Required: 2-Second Keyframe Interval</div>
                <p className="mt-1 text-[11px] text-amber-200/80">
                  In <strong>OBS Settings -&gt; Output -&gt; Streaming</strong>, set <strong>Keyframe Interval</strong> to{' '}
                  <code className="rounded bg-black/40 px-1 py-0.5 font-mono">2 s</code>. ComboCut splits the DVR ring buffer
                  into 2-second HLS segments so instant scrubbing and highlight slicing stay frame-accurate.
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400">
                <strong className="text-zinc-200">Optional OBS WebSocket Sync:</strong> Enabling OBS WebSocket on port{' '}
                <code className="text-cyan-300">4455</code> automatically logs scene switches as timeline markers and lets you
                import your exact facecam box with <strong>Import Cam from OBS</strong>.
              </div>
            </div>
          )}

          {tab === 'offair' && (
            <div className="space-y-3">
              <p className="text-zinc-400">
                Not streaming live? Switch the top bar to <strong className="text-emerald-300">Off-Air</strong> to clip
                single-PC gameplay with zero OBS setup and zero virtual audio cables.
              </p>
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="font-semibold text-zinc-100">How Off-Air Single-PC Capture Works</div>
                <ul className="list-disc space-y-1.5 pl-4 text-[11px] text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">GPU Screen Capture:</strong> Uses hardware DXGI Desktop Duplication (
                    <code className="text-cyan-300">ddagrab</code>) encoded on your GPU (<code className="text-cyan-300">NVENC</code> /{' '}
                    <code className="text-cyan-300">AMF</code> / <code className="text-cyan-300">QSV</code>).
                  </li>
                  <li>
                    <strong className="text-zinc-200">3-Track WASAPI Audio:</strong> Automatically separates{' '}
                    <strong>Game/System</strong>, <strong>Discord/Party Chat</strong>, and <strong>Microphone</strong> so you can
                    re-balance or mute Discord after clipping.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Rolling DVR &amp; Instant Pin:</strong> Keeps the last 15–30 minutes in a
                    self-pruning buffer. Click <strong>Mark Highlight</strong> (or press the global hotkey) to protect a 45–90s clip.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {tab === 'dualpc' && (
            <div className="space-y-3">
              <p className="text-zinc-400">
                Use ComboCut on your dedicated streaming/clipping PC with a capture card or receive an RTMP feed from your
                Gaming PC over your home network.
              </p>
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="font-semibold text-zinc-100">Elgato / AVerMedia / UVC Capture Cards</div>
                <ul className="list-disc space-y-1.5 pl-4 text-[11px] text-zinc-400">
                  <li>
                    Switch ComboCut to <strong>Off-Air</strong> and select your DirectShow (<code className="text-cyan-300">dshow</code>)
                    capture card device (plus optional webcam).
                  </li>
                  <li>
                    <strong className="text-emerald-300">Automatic Capture-Card Handoff:</strong> If you later launch OBS or start
                    pushing to <code className="text-cyan-300">/live/program</code>, ComboCut immediately releases the Windows capture-card
                    device handle so OBS never hits a &ldquo;Device in Use&rdquo; conflict.
                  </li>
                </ul>
              </div>
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-[11px] text-indigo-200 space-y-2">
                <div className="font-semibold">Dual-PC OBS Over LAN Tip</div>
                <p className="text-indigo-200/80">
                  If OBS runs on your Gaming PC and ComboCut runs on your Stream PC, replace{' '}
                  <code className="rounded bg-black/40 px-1 py-0.5 font-mono">127.0.0.1</code> with this PC&apos;s local IP
                  and allow TCP port <code className="rounded bg-black/40 px-1 py-0.5 font-mono">1935</code> in Windows Firewall.
                </p>
                {lanIp && (
                  <CopyRow
                    id="dualpc-lan-ip"
                    label="Stream PC LAN RTMP Server"
                    value={`rtmp://${lanIp}:1935/live`}
                  />
                )}
              </div>
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['J / K / L', 'Shuttle backward / pause / forward'],
                  ['I / O', 'Set clip In and Out points'],
                  ['Ctrl + K', 'Blade split active track in Mini-Editor'],
                  ['Space', 'Play / Pause DVR or Mini-Editor preview'],
                ].map(([keys, desc]) => (
                  <div key={keys} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                    <div className="font-mono text-xs font-semibold text-cyan-300">{keys}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">{desc}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                  <Wrench className="h-3.5 w-3.5 text-amber-400" />
                  Troubleshooting
                </div>
                <p>
                  <strong className="text-zinc-200">OBS won&apos;t connect:</strong> Verify Server is{' '}
                  <code className="text-cyan-300">rtmp://127.0.0.1:1935/live</code>, Stream Key is{' '}
                  <code className="text-cyan-300">program</code>, and Keyframe Interval is <code className="text-cyan-300">2 s</code>.
                </p>
                <p>
                  <strong className="text-zinc-200">Windows SmartScreen:</strong> Unsigned open-source beta builds show &ldquo;Windows
                  protected your PC&rdquo; on first launch—click <strong>More info -&gt; Run anyway</strong>.
                </p>
                <p>
                  <strong className="text-zinc-200">Startup logs:</strong> Check{' '}
                  <code className="text-cyan-300">%APPDATA%\combocut\startup.log</code> if the local backend fails to start.
                </p>
              </div>
            </div>
          )}

          {tab === 'ai_faq' && (
            <div className="space-y-3 text-zinc-300">
              <p className="text-zinc-400">
                ComboCut&apos;s 100% local AI funnel watches your rolling DVR buffer every 6 seconds and automatically
                slices dynamic <strong>15s–180s</strong> clips when multiple signals align.
              </p>

              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="font-semibold text-amber-300">1. What does the Total Score &amp; Confidence Badge mean?</div>
                <p className="text-[11px] text-zinc-400">
                  Each card&apos;s score is a weighted sum of the 4 signals below.{' '}
                  <span className="text-emerald-300 font-semibold">Strong Match (&ge; 1.50)</span> means multiple signals
                  peaked together; <span className="text-amber-300 font-semibold">Good Match (1.00–1.49)</span> is a
                  solid highlight; <span className="text-zinc-200 font-semibold">Possible (&lt; 1.00)</span> is a
                  borderline candidate.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-indigo-300">Chat (0.0 – 1.0)</div>
                  <div className="mt-0.5 text-zinc-400">Measures live chat message velocity &amp; emote/hype spikes (On-Air).</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-emerald-300">Audio (0.0 – 1.0)</div>
                  <div className="mt-0.5 text-zinc-400">Tracks Mic/Discord RMS peaks, laughter bursts, and jump-scare volume spikes.</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-cyan-300">Vis (0.0 – 1.0)</div>
                  <div className="mt-0.5 text-zinc-400">FFmpeg scdet + DirectML visual scoring for Clutch, Visual Chaos &amp; Facecam reactions.</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="font-semibold text-purple-300">Whisper (0.0 – 1.0)</div>
                  <div className="mt-0.5 text-zinc-400">Background whisper.cpp speech hype keywords, exclamations &amp; quote hooks.</div>
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400">
                <div className="font-semibold text-zinc-200">2. How Approve &amp; Dismiss train your local AI</div>
                <p>
                  Clicking <strong className="text-emerald-300">Approve</strong> nudges the weights of active signals up
                  (+0.08) in your local <code className="text-cyan-300">studio.db</code>. Clicking{' '}
                  <strong className="text-rose-300">Dismiss</strong> lowers them (-0.08) so ComboCut adapts to your
                  personal content style.
                </p>
              </div>

              <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400">
                <div className="font-semibold text-zinc-200">3. AI Hardware Modes</div>
                <p><strong className="text-amber-200">Audio + Visual:</strong> ~1.2–1.8 GB VRAM | ~10–15% GPU (DirectML + Whisper + Audio).</p>
                <p><strong className="text-emerald-200">Audio Only:</strong> ~250–400 MB VRAM | &lt; 3% GPU (Skips DirectML; great for GTX 10-series / RX 580).</p>
                <p><strong className="text-cyan-200">Visual Only:</strong> ~900 MB–1.3 GB VRAM | ~8–12% GPU (No mic/Whisper; ideal for music/no-mic streams).</p>
                <p><strong className="text-zinc-300">Off (Manual Only):</strong> 0 MB VRAM | 0% Background Load (Hotkey &amp; Mark Highlight stay active).</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageSettingsModal({
  open,
  state,
  onClose,
  onChangeDvrLocation,
  onChangePinnedLocation,
  onUpdateRetention,
  onPurgeBuffer,
}: {
  open: boolean;
  state: ControlRoomState | null;
  onClose: () => void;
  onChangeDvrLocation: () => void;
  onChangePinnedLocation: (moveExisting: boolean) => void;
  onUpdateRetention: (patch: {
    bufferMinutes?: number;
    maxBufferGb?: number;
    aiDetectionMode?: AiDetectionMode;
    aiVisualFocus?: AiVisualFocus;
    aiSensitivity?: AiSensitivity;
    aiMaxClipSec?: number;
  }) => void;
  onPurgeBuffer: () => Promise<void>;
}) {
  const [moveExisting, setMoveExisting] = useState(true);
  const [purging, setPurging] = useState(false);

  if (!open) return null;

  const stats = state?.dvrRetention;
  const bufferMinutes = state?.settings.bufferMinutes ?? 20;
  const maxBufferGb = state?.settings.maxBufferGb ?? 25;
  const aiDetectionMode: AiDetectionMode = state?.settings.aiDetectionMode ?? 'audio_visual';
  const aiVisualFocus: AiVisualFocus = state?.settings.aiVisualFocus ?? 'balanced';
  const aiSensitivity: AiSensitivity = state?.settings.aiSensitivity ?? 'balanced';
  const aiMaxClipSec = state?.settings.aiMaxClipSec ?? 180;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-zinc-100">DVR Storage, Pinned Clips & Auto-Purge</h2>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 py-4">
          {stats?.lowDiskWarning && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Drive free space is under 5 GB. Low-disk safety guard is auto-pruning oldest DVR segments.
              </span>
            </div>
          )}

          {/* Rolling DVR Buffer Path */}
          <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200">Rolling DVR Buffer & Exports Folder</span>
              <button
                type="button"
                onClick={onChangeDvrLocation}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-indigo-300 hover:bg-zinc-800"
              >
                <FolderSync className="h-3 w-3" />
                Change DVR Folder
              </button>
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-400" title={state?.hls.bufferDir}>
              {state?.hls.bufferDir ?? 'Default workspace /buffer'}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span>Used: {fmtSize(stats?.bufferBytes ?? state?.hls.totalBytes)}</span>
              <span>Segments: {stats?.segmentCount ?? state?.hls.segmentCount ?? 0}</span>
              <span>Drive Free: {fmtSize(stats?.freeDriveBytes ?? state?.hls.freeBytes)}</span>
            </div>
          </div>

          {/* Pinned Clips Folder */}
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200">Pinned Clips & AI Queue Folder</span>
              <button
                type="button"
                onClick={() => onChangePinnedLocation(moveExisting)}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-cyan-300 hover:bg-zinc-800"
              >
                <FolderSync className="h-3 w-3" />
                Change Pinned Folder
              </button>
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-400" title={state?.settings.pinnedClipsDir || 'Default /pinned'}>
              {state?.settings.pinnedClipsDir || 'Default workspace /pinned'}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={moveExisting}
                onChange={(e) => setMoveExisting(e.target.checked)}
                className="rounded border-zinc-700"
              />
              Move existing pinned clips to the new folder automatically
            </label>
          </div>

          {/* Retention Limits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">Rolling Duration</div>
              <select
                value={bufferMinutes}
                onChange={(e) => onUpdateRetention({ bufferMinutes: Number(e.target.value) })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value={20}>20 minutes (Default)</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={240}>4 hours</option>
              </select>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">Max Buffer Cap</div>
              <select
                value={maxBufferGb}
                onChange={(e) => onUpdateRetention({ maxBufferGb: Number(e.target.value) })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value={10}>10 GB</option>
                <option value={25}>25 GB</option>
                <option value={50}>50 GB</option>
              </select>
            </div>
          </div>

          {/* AI Highlight Settings */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">AI Detection Mode</div>
              <select
                value={aiDetectionMode}
                onChange={(e) => onUpdateRetention({ aiDetectionMode: e.target.value as AiDetectionMode })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value="audio_visual">Audio + Visual</option>
                <option value="audio_only">Audio Only</option>
                <option value="visual_only">Visual Only</option>
                <option value="off">Off (Manual Only)</option>
              </select>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">AI Sensitivity</div>
              <select
                value={aiSensitivity}
                onChange={(e) => onUpdateRetention({ aiSensitivity: e.target.value as AiSensitivity })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value="high_recall">High Recall (0.85)</option>
                <option value="balanced">Balanced (1.05)</option>
                <option value="strict">Strict (1.25)</option>
              </select>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">Visual AI Focus</div>
              <select
                value={aiVisualFocus}
                onChange={(e) => onUpdateRetention({ aiVisualFocus: e.target.value as AiVisualFocus })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value="balanced">Balanced</option>
                <option value="clutch_heavy">Clutch-Heavy</option>
                <option value="funny_reactions">Funny &amp; Reactions</option>
              </select>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-1.5 font-semibold text-zinc-200">Max AI Clip Length</div>
              <select
                value={aiMaxClipSec}
                onChange={(e) => onUpdateRetention({ aiMaxClipSec: Number(e.target.value) })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200"
              >
                <option value={60}>60 seconds</option>
                <option value={90}>90 seconds</option>
                <option value={120}>2 minutes (120s)</option>
                <option value={180}>3 minutes (180s)</option>
              </select>
            </div>
          </div>

          {/* Manual Purge */}
          <div className="flex items-center justify-between rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
            <div className="text-[11px] text-zinc-300">
              Immediately delete old unpinned DVR buffer segments (keeps active live head).
            </div>
            <button
              type="button"
              disabled={purging}
              onClick={async () => {
                setPurging(true);
                try {
                  await onPurgeBuffer();
                } finally {
                  setPurging(false);
                }
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {purging ? 'Purging...' : 'Purge Buffer Now'}
            </button>
          </div>
        </div>

        <div className="flex justify-end border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-800 px-4 py-1.5 font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackModal({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: ControlRoomState | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('Bug Report / Crash');
  const [details, setDetails] = useState('');
  const [handle, setHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const diagnostics = [
    'ComboCut v0.2.0',
    `GPU: ${state?.gpu?.selected ?? 'unknown'}${state?.gpu?.adapterName ? ` (${state.gpu.adapterName})` : ''}`,
    `Mode: ${state?.settings.appMode ?? 'onair'}`,
    `Whisper: ${state?.settings.whisperModel ?? 'base.en'}`,
    `Buffer: ${state?.hls.bufferDir ?? 'default'}`,
  ].join(' | ');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!details.trim()) {
      setError('Please enter your feedback or steps to reproduce.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        category,
        details: details.trim(),
        handle: handle.trim() || 'Anonymous',
        diagnostics,
      };

      if (window.combocutDesktop?.submitFeedback) {
        const result = await window.combocutDesktop.submitFeedback(payload);
        if (result.ok) {
          setSubmitted(true);
          setDetails('');
        } else {
          setError(result.error ?? 'Could not submit directly. Opened form in browser.');
        }
      } else {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; fallbackUrl?: string };
        if (res.ok && data.ok) {
          setSubmitted(true);
          setDetails('');
        } else {
          setError(data.error ?? 'Could not submit directly. Opening form in browser...');
          window.open(data.fallbackUrl || FEEDBACK_FORM_CONFIG.fallbackUrl, '_blank', 'noopener,noreferrer');
        }
      }
    } catch {
      setError('Offline or server unreachable. Opening form in browser...');
      window.open(FEEDBACK_FORM_CONFIG.fallbackUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold text-zinc-100">Send ComboCut Beta Feedback</h2>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="space-y-4 py-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <Check className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold text-zinc-100">Thank you! Feedback sent.</div>
            <p className="text-zinc-400">
              Your report and GPU/system diagnostics were submitted to the ComboCut beta form.
            </p>
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                onClose();
              }}
              className="rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-500"
            >
              Back to Control Room
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-4">
            <div>
              <label className="mb-1 block font-medium text-zinc-300">Feedback Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-200"
              >
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-zinc-300">
                Feedback Details &amp; Steps to Reproduce
              </label>
              <textarea
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Tell us what happened or what you'd like to see in v0.2.0..."
                className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-zinc-300">
                Discord or GitHub Handle (optional)
              </label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@yourhandle"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-200"
              />
            </div>

            <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[10px] text-zinc-400">
              <div className="font-semibold text-zinc-300">Attached System &amp; GPU Diagnostics</div>
              <div className="mt-0.5 break-all font-mono text-cyan-300/80">{diagnostics}</div>
            </div>

            {error && (
              <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
              <a
                href={FEEDBACK_FORM_CONFIG.fallbackUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-cyan-400 hover:underline"
              >
                Open in Browser
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md bg-zinc-800 px-3 py-1.5 font-medium text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? 'Sending...' : 'Submit Feedback'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
