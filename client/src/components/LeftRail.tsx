import { Check, Film, FolderKanban, Sparkles, Upload, X } from 'lucide-react';
import type { AiHighlightItem, PinnedClip, VodItem } from '../types';

interface LeftRailProps {
  aiQueue: AiHighlightItem[];
  pinnedClips: PinnedClip[];
  vodItems: VodItem[];
  activeClipId: number | null;
  onSelectLiveDvr: () => void;
  onSelectClip: (clip: PinnedClip) => void;
  onApproveAi: (item: AiHighlightItem) => void;
  onAutoExportAi: (item: AiHighlightItem) => void;
  onDismissAi: (item: AiHighlightItem) => void;
  onTriggerAiTest: () => void;
}

export function LeftRail({
  aiQueue,
  pinnedClips,
  vodItems,
  activeClipId,
  onSelectLiveDvr,
  onSelectClip,
  onApproveAi,
  onAutoExportAi,
  onDismissAi,
  onTriggerAiTest,
}: LeftRailProps) {
  const pendingAi = aiQueue.filter((i) => i.status === 'pending');

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50">
      {/* AI Approval Queue */}
      <div className="flex flex-1 flex-col overflow-hidden border-b border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            AI Approval Queue
            {pendingAi.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                {pendingAi.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onTriggerAiTest}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
            title="Run 4-Signal AI Scan Now"
          >
            Scan Now
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
          {pendingAi.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500">
              4-signal AI funnel is monitoring Chat, 3-Track Audio, Visual `scdet`, and Burst Whisper.
            </div>
          ) : (
            pendingAi.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-300">
                    Score {item.score.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-zinc-500">#{item.id}</span>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                    Chat {item.signals.chat.toFixed(1)}
                  </span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Audio {item.signals.audio.toFixed(1)}
                  </span>
                  <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300">
                    SCD {item.signals.visual.toFixed(1)}
                  </span>
                  {item.signals.whisperAvailable && (
                    <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                      Whisper {item.signals.transcript.toFixed(1)}
                    </span>
                  )}
                </div>

                {item.transcript && (
                  <p className="mt-1.5 line-clamp-2 text-[11px] italic text-zinc-400">
                    "{item.transcript}"
                  </p>
                )}

                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApproveAi(item)}
                    className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                  >
                    <Check className="h-3 w-3" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onAutoExportAi(item)}
                    className="flex items-center justify-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                    title="Quick Auto-Export"
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissAi(item)}
                    className="flex items-center justify-center rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                    title="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Clip Bin */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <FolderKanban className="h-3.5 w-3.5 text-cyan-400" />
            Clip Bin ({pinnedClips.length})
          </div>
          {activeClipId !== null && (
            <button
              type="button"
              onClick={onSelectLiveDvr}
              className="rounded bg-cyan-600/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300 hover:bg-cyan-600/30"
            >
              Live DVR
            </button>
          )}
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
          {pinnedClips.length === 0 && vodItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500">
              Click <strong>Mark Highlight</strong> to pin a 45–90s micro-clip from the DVR buffer.
            </div>
          ) : (
            <>
              {pinnedClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => onSelectClip(clip)}
                  className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs transition ${
                    activeClipId === clip.id
                      ? 'border-indigo-500 bg-indigo-500/15'
                      : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                  }`}
                >
                  <Film className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-zinc-200">{clip.triggerLabel}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>{clip.durationSec.toFixed(1)}s</span>
                      <span className="uppercase">{clip.triggerSource}</span>
                    </div>
                  </div>
                </button>
              ))}

              {vodItems.map((vod) => (
                <div
                  key={`vod-${vod.id}`}
                  className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2 text-xs"
                >
                  <Film className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-zinc-300">{vod.filename}</div>
                    <div className="text-[10px] text-zinc-500">
                      VOD ({vod.durationSec.toFixed(0)}s) • {vod.status}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
