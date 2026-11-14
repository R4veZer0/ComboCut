import { useState } from 'react';
import { Check, Download, Eye, Film, FolderKanban, HelpCircle, Layers, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AiDetectionMode, AiHighlightItem, BatchExportJob, ControlRoomState, PinnedClip, VodItem } from '../types';

const AI_MODE_META: Record<
  AiDetectionMode,
  { label: string; vram: string; gpu: string; note: string; badgeClass: string }
> = {
  audio_visual: {
    label: 'Audio + Visual',
    vram: '~1.2-1.8 GB VRAM',
    gpu: '~10-15% GPU',
    note: 'RTX 20-series / RX 5700+ recommended',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  },
  audio_only: {
    label: 'Audio Only',
    vram: '~250-400 MB VRAM',
    gpu: '< 3% GPU',
    note: 'Great for older GPUs / GTX 10-series / RX 580',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  },
  visual_only: {
    label: 'Visual Only',
    vram: '~900 MB-1.3 GB VRAM',
    gpu: '~8-12% GPU',
    note: 'Best for no-mic / music streams',
    badgeClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  },
  off: {
    label: 'Off (Manual Only)',
    vram: '0 MB VRAM',
    gpu: '0% Background Load',
    note: 'Manual Mark Highlight & hotkey active',
    badgeClass: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  },
};

function formatClipDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '0:45';
  const total = Math.max(1, Math.round(sec));
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

function getConfidenceBadge(score: number): { label: string; cls: string; tip: string } {
  if (score >= 1.5) {
    return {
      label: `Strong Match · ${score.toFixed(2)}`,
      cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      tip: 'Multiple high-confidence signals (audio, visual, or transcript) aligned on this moment.',
    };
  }
  if (score >= 1.0) {
    return {
      label: `Good Match · ${score.toFixed(2)}`,
      cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      tip: 'Solid highlight candidate above your weighted threshold.',
    };
  }
  return {
    label: `Possible · ${score.toFixed(2)}`,
    cls: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    tip: 'Borderline candidate. Approve to boost similar signals or Dismiss to train AI weights down.',
  };
}

interface LeftRailProps {
  aiQueue: AiHighlightItem[];
  aiDetectionMode?: AiDetectionMode;
  gpuAdapterName?: string;
  onChangeAiDetectionMode?: (mode: AiDetectionMode) => void;
  pinnedClips: PinnedClip[];
  vodItems: VodItem[];
  batchExportQueue?: BatchExportJob[];
  aiStatus?: ControlRoomState['ai'];
  activeClipId: number | null;
  onSelectLiveDvr: () => void;
  onSelectClip: (clip: PinnedClip) => void;
  onDeleteClip: (clip: PinnedClip) => void;
  onBatchExport?: (clipIds: number[]) => void;
  onClearBatchCompleted?: () => void;
  onPreviewAi?: (item: AiHighlightItem) => void;
  onApproveAi: (item: AiHighlightItem) => void;
  onAutoExportAi: (item: AiHighlightItem) => void;
  onDismissAi: (item: AiHighlightItem) => void;
  onTriggerAiTest: () => void;
  onRetryVisionModel?: () => void;
  onOpenAiFaq?: () => void;
}

export function LeftRail({
  aiQueue,
  aiDetectionMode = 'audio_visual',
  gpuAdapterName,
  onChangeAiDetectionMode,
  pinnedClips,
  vodItems,
  batchExportQueue = [],
  aiStatus,
  activeClipId,
  onSelectLiveDvr,
  onSelectClip,
  onDeleteClip,
  onBatchExport,
  onClearBatchCompleted,
  onPreviewAi,
  onApproveAi,
  onAutoExportAi,
  onDismissAi,
  onTriggerAiTest,
  onRetryVisionModel,
  onOpenAiFaq,
}: LeftRailProps) {
  const pendingAi = aiQueue.filter((i) => i.status === 'pending');
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const modeMeta = AI_MODE_META[aiDetectionMode] ?? AI_MODE_META.audio_visual;

  const toggleBatchId = (id: number) => {
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50">
      {/* AI Approval Queue */}
      <div className="flex flex-1 flex-col overflow-hidden border-b border-zinc-800">
        <div className="space-y-1.5 border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              AI Approval Queue
              {pendingAi.length > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                  {pendingAi.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {onOpenAiFaq && (
                <button
                  type="button"
                  onClick={onOpenAiFaq}
                  className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                  title="AI Scoring & Queue FAQ"
                >
                  <HelpCircle className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={onTriggerAiTest}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
                title="Run AI Scan Now"
              >
                Scan Now
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={aiDetectionMode}
              onChange={(e) => onChangeAiDetectionMode?.(e.target.value as AiDetectionMode)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-200"
              title="AI Detection Mode"
            >
              <option value="audio_visual">Audio + Visual (Default)</option>
              <option value="audio_only">Audio Only (Low GPU)</option>
              <option value="visual_only">Visual Only (No-Mic)</option>
              <option value="off">Off (Manual Only)</option>
            </select>
          </div>

          <div className={`rounded border px-2 py-1 text-[10px] leading-tight ${modeMeta.badgeClass}`}>
            <div className="font-semibold">
              {modeMeta.vram} | {modeMeta.gpu}
            </div>
            <div className="opacity-85">{modeMeta.note}</div>
            {gpuAdapterName && aiDetectionMode !== 'off' && (
              <div className="mt-0.5 truncate font-mono text-[9px] text-cyan-300/90" title={gpuAdapterName}>
                GPU Offload: DirectML · {gpuAdapterName}
              </div>
            )}
            {aiDetectionMode !== 'off' && aiStatus && (
              <div className="mt-1 rounded border border-zinc-800/80 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
                <div className="flex items-center justify-between gap-1">
                  <span>
                    Aud {(aiStatus.audioScore ?? 0).toFixed(2)} | Voc {(aiStatus.vocalScore ?? 0).toFixed(2)} | Vis{' '}
                    <span title={aiStatus.visualEngineError ?? aiStatus.visualEngineStatus ?? 'Visual Engine'}>
                      {(aiStatus.visualScore ?? 0).toFixed(2)}
                    </span>{' '}
                    {'->'}{' '}
                    <span className="font-semibold text-amber-300">
                      {(aiStatus.combinedScore ?? 0).toFixed(2)}
                    </span>{' '}
                    / {(aiStatus.threshold ?? 1.05).toFixed(2)}
                  </span>
                </div>
                {aiStatus.visualEngineStatus && (
                  <div className="flex items-center justify-between gap-1">
                    <div
                      className={`truncate text-[8.5px] ${
                        /fail|error/i.test(aiStatus.visualEngineStatus) ? 'text-amber-300' : 'text-cyan-300/85'
                      }`}
                      title={aiStatus.visualEngineError ?? aiStatus.visualEngineStatus}
                    >
                      Vis Engine: {aiStatus.visualEngineStatus}
                    </div>
                    {/fail|error/i.test(aiStatus.visualEngineStatus) && onRetryVisionModel && (
                      <button
                        type="button"
                        onClick={onRetryVisionModel}
                        className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0 text-[8.5px] font-semibold text-amber-200 hover:bg-amber-500/30"
                        title="Retry loading/downloading CLIP vision model"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {aiStatus.lastDecision && (
                  <div className="truncate text-zinc-400" title={aiStatus.lastDecision}>
                    {aiStatus.lastDecision}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
          {pendingAi.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500">
              {aiDetectionMode === 'off'
                ? 'Background AI scanning is paused. Use Mark Highlight or your hotkey anytime.'
                : '6s incremental AI funnel is monitoring rolling DVR segments for highlights (15s–180s).'}
            </div>
          ) : (
            pendingAi.map((item) => {
              const badge = getConfidenceBadge(item.score);
              const headline = item.signals.headline || item.signals.reasons[0] || `AI Moment #${item.id}`;
              const tags = item.signals.tags ?? [];
              return (
              <div
                key={item.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                    title={badge.tip}
                  >
                    {badge.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-200">
                      {formatClipDuration(item.clipDurationSec)}
                    </span>
                    <span className="text-[10px] text-zinc-500">#{item.id}</span>
                  </div>
                </div>

                <div className="mt-1.5 font-semibold leading-snug text-zinc-100">
                  {headline}
                </div>

                {tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {item.signals.summary && (
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                    {item.signals.summary}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                    Chat {item.signals.chat.toFixed(1)}
                  </span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Audio {item.signals.audio.toFixed(1)}
                  </span>
                  <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300">
                    Vis {item.signals.visual.toFixed(1)}
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
                  {item.clipFilename && onPreviewAi && (
                    <button
                      type="button"
                      onClick={() => onPreviewAi(item)}
                      className="flex items-center justify-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25"
                      title="Preview pending AI clip in center player"
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                  )}
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
              );
            })
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
          <div className="flex items-center gap-1">
            {selectedBatchIds.length > 0 && onBatchExport && (
              <button
                type="button"
                onClick={() => {
                  onBatchExport(selectedBatchIds);
                  setSelectedBatchIds([]);
                }}
                className="inline-flex items-center gap-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-indigo-500"
                title="Queue selected clips for sequential 9:16 GPU export"
              >
                <Layers className="h-2.5 w-2.5" />
                Batch ({selectedBatchIds.length})
              </button>
            )}
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
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
          {pinnedClips.length === 0 && vodItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500">
              Click <strong>Mark Highlight</strong> to pin a 45–90s micro-clip from the DVR buffer.
            </div>
          ) : (
            <>
              {pinnedClips.map((clip) => (
                <div
                  key={clip.id}
                  onClick={() => onSelectClip(clip)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelectClip(clip);
                  }}
                  className={`group flex w-full cursor-pointer items-start gap-2 rounded-lg border p-2 text-left text-xs transition ${
                    activeClipId === clip.id
                      ? 'border-indigo-500 bg-indigo-500/15'
                      : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedBatchIds.includes(clip.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleBatchId(clip.id)}
                    className="mt-0.5 rounded border-zinc-700"
                    title="Select for Batch Export"
                  />
                  <Film className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-zinc-200">{clip.triggerLabel}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>{clip.durationSec.toFixed(1)}s</span>
                      <span className="uppercase">{clip.triggerSource}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClip(clip);
                    }}
                    className="rounded p-1 text-zinc-500 opacity-70 hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
                    title="Delete Clip (.mp4 & .srt)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
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

        {batchExportQueue.length > 0 && (
          <div className="border-t border-zinc-800 bg-zinc-950/70 p-2 text-[10px]">
            <div className="mb-1 flex items-center justify-between font-semibold text-zinc-300">
              <span>Batch Export Queue ({batchExportQueue.length})</span>
              {onClearBatchCompleted && (
                <button
                  type="button"
                  onClick={onClearBatchCompleted}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  Clear Done
                </button>
              )}
            </div>
            <div className="max-h-24 space-y-1 overflow-y-auto">
              {batchExportQueue.map((job) => (
                <div key={job.jobId} className="flex items-center justify-between gap-1 rounded bg-zinc-900 px-1.5 py-1">
                  <span className="truncate text-zinc-300">{job.label}</span>
                  {job.status === 'done' && job.downloadUrl ? (
                    <a
                      href={job.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-0.5 text-emerald-400 hover:underline"
                    >
                      <Download className="h-2.5 w-2.5" />
                      MP4
                    </a>
                  ) : (
                    <span
                      className={
                        job.status === 'running'
                          ? 'text-amber-300'
                          : job.status === 'error'
                            ? 'text-rose-400'
                            : 'text-zinc-500'
                      }
                    >
                      {job.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
