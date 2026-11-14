import { useState } from 'react';
import { Play, Square, Plus, Trash2, Radio } from 'lucide-react';
import type { RestreamPlatform, RestreamTarget, RestreamWorkerStatus } from '../types';

interface RestreamPanelProps {
  targets: RestreamTarget[];
  workers: RestreamWorkerStatus[];
  onRefresh: () => void;
}

const PLATFORM_PRESETS: Record<RestreamPlatform, { label: string; defaultUrl: string }> = {
  twitch: { label: 'Twitch', defaultUrl: 'rtmps://live.twitch.tv/app' },
  youtube: { label: 'YouTube Live', defaultUrl: 'rtmps://a.rtmps.youtube.com/live2' },
  kick: { label: 'Kick', defaultUrl: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app' },
  custom: { label: 'Custom RTMPS', defaultUrl: 'rtmps://' },
};

export function RestreamPanel({ targets, workers, onRefresh }: RestreamPanelProps) {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<RestreamPlatform>('twitch');
  const [rtmpUrl, setRtmpUrl] = useState(PLATFORM_PRESETS.twitch.defaultUrl);
  const [streamKey, setStreamKey] = useState('');
  const [twitchDownscale, setTwitchDownscale] = useState(false);

  const workerByTarget = new Map(workers.map((w) => [w.targetId, w]));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !rtmpUrl.trim()) return;
    await fetch('/api/restream/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        platform,
        rtmpUrl,
        streamKey,
        twitchDownscale1080p60: platform === 'twitch' ? twitchDownscale : false,
      }),
    });
    setName('');
    setStreamKey('');
    onRefresh();
  }

  async function toggleWorker(targetId: number, isRunning: boolean) {
    await fetch(`/api/restream/targets/${targetId}/${isRunning ? 'stop' : 'start'}`, {
      method: 'POST',
    });
    onRefresh();
  }

  async function removeTarget(targetId: number) {
    await fetch(`/api/restream/targets/${targetId}`, { method: 'DELETE' });
    onRefresh();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Isolated RTMPS Restream Workers</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetch('/api/restream/start-all', { method: 'POST' }).then(onRefresh)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Start All
          </button>
          <button
            onClick={() => fetch('/api/restream/stop-all', { method: 'POST' }).then(onRefresh)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Stop All
          </button>
        </div>
      </div>

      <form onSubmit={handleAdd} className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 md:grid-cols-5">
        <select
          value={platform}
          onChange={(e) => {
            const p = e.target.value as RestreamPlatform;
            setPlatform(p);
            setRtmpUrl(PLATFORM_PRESETS[p].defaultUrl);
          }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
        >
          {Object.entries(PLATFORM_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Label (e.g. Main Twitch)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
        />
        <input
          type="text"
          placeholder="RTMPS Ingest URL"
          value={rtmpUrl}
          onChange={(e) => setRtmpUrl(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
        />
        <input
          type="password"
          placeholder="Stream Key"
          value={streamKey}
          onChange={(e) => setStreamKey(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100"
        />
        <button
          type="submit"
          className="flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" /> Add Target
        </button>

        {platform === 'twitch' && (
          <label className="col-span-full flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={twitchDownscale}
              onChange={(e) => setTwitchDownscale(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900"
            />
            GPU Downscale to 1080p60 @ 7500 kbps for Twitch (when ingesting 1440p/4K)
          </label>
        )}
      </form>

      <div className="space-y-2">
        {targets.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-500">No restream targets configured yet.</p>
        ) : (
          targets.map((target) => {
            const worker = workerByTarget.get(target.id);
            const isRunning = worker?.state === 'live' || worker?.state === 'starting' || worker?.state === 'reconnecting';
            return (
              <div
                key={target.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-100">{target.name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">
                      {target.platform}
                    </span>
                    <span className="rounded bg-zinc-800/70 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {target.platform === 'twitch' && target.twitchDownscale1080p60
                        ? `1080p60 (${worker?.encoder ?? 'gpu'})`
                        : '-c copy'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{target.rtmpUrl}</p>
                  {worker?.lastError && (
                    <p className="mt-0.5 text-[11px] text-amber-400">{worker.lastError}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                      worker?.state === 'live'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : worker?.state === 'reconnecting'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {worker?.state ?? 'stopped'}
                  </span>
                  <button
                    onClick={() => void toggleWorker(target.id, isRunning)}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                      isRunning
                        ? 'bg-rose-600/90 text-white hover:bg-rose-500'
                        : 'bg-emerald-600/90 text-white hover:bg-emerald-500'
                    }`}
                  >
                    {isRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {isRunning ? 'Stop' : 'Start'}
                  </button>
                  <button
                    onClick={() => void removeTarget(target.id)}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400"
                    title="Delete target"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
