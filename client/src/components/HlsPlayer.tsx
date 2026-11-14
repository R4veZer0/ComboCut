import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { BookOpen, Check, Copy, Monitor, Radio } from 'lucide-react';

interface HlsPlayerProps {
  playlistUrl: string;
  active: boolean;
  segmentCount: number;
  mode?: 'onair' | 'offair';
  toneMuted?: boolean;
  onOpenObsGuide?: () => void;
}

const SMPTE_TOP_BARS = [
  '#c0c0c0', // 75% White
  '#c0c000', // Yellow
  '#00c0c0', // Cyan
  '#00c000', // Green
  '#c000c0', // Magenta
  '#c00000', // Red
  '#0000c0', // Blue
];

const SMPTE_MID_BARS = [
  '#0000c0',
  '#131313',
  '#c000c0',
  '#131313',
  '#00c0c0',
  '#131313',
  '#c0c0c0',
];

export function HlsPlayer({
  playlistUrl,
  active,
  segmentCount,
  mode = 'onair',
  toneMuted = true,
  onOpenObsGuide,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<'server' | 'key' | null>(null);

  const isLive = active && segmentCount > 0;

  const copyValue = (which: 'server' | 'key', value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(which);
    setTimeout(() => setCopiedKey((prev) => (prev === which ? null : prev)), 1500);
  };

  // Attach HLS stream when live segments are available
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isLive) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 6,
      });
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {});
      });
      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      void video.play().catch(() => {});
    }
  }, [playlistUrl, isLive]);

  // Looping SMPTE HD Color Bars on <canvas> during On-Air Standby
  useEffect(() => {
    if (isLive || mode !== 'onair') return;
    let rafId = 0;
    const startMs = performance.now();

    const drawBars = (now: number) => {
      const canvas = barsCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const topH = Math.round(h * 0.67);
          const midH = Math.round(h * 0.08);
          const botY = topH + midH;
          const botH = h - botY;
          const barW = w / 7;

          for (let i = 0; i < 7; i++) {
            ctx.fillStyle = SMPTE_TOP_BARS[i];
            ctx.fillRect(i * barW, 0, Math.ceil(barW), topH);
            ctx.fillStyle = SMPTE_MID_BARS[i];
            ctx.fillRect(i * barW, topH, Math.ceil(barW), midH);
          }

          // Bottom PLUGE / reference blocks
          const botBlocks: Array<[number, string]> = [
            [0.18, '#00214c'],
            [0.18, '#ffffff'],
            [0.18, '#32006a'],
            [0.24, '#131313'],
            [0.07, '#090909'],
            [0.07, '#131313'],
            [0.08, '#1d1d1d'],
          ];
          let bx = 0;
          for (const [frac, color] of botBlocks) {
            const bw = Math.ceil(w * frac);
            ctx.fillStyle = color;
            ctx.fillRect(bx, botY, bw, botH);
            bx += bw;
          }

          // Subtle animated scanline sweep to show active standby loop
          const elapsedSec = (now - startMs) / 1000;
          const sweepX = ((elapsedSec * 160) % (w + 40)) - 20;
          const grad = ctx.createLinearGradient(sweepX - 20, 0, sweepX + 20, 0);
          grad.addColorStop(0, 'rgba(255,255,255,0)');
          grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(sweepX - 20, 0, 40, h);

          // Top-left SMPTE status badge
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(14, 14, 245, 24);
          ctx.fillStyle = '#e4e4e7';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`SMPTE HD BARS · ${toneMuted ? 'TONE MUTED' : '440Hz/1kHz TONE'}`, 22, 30);
        }
      }
      rafId = requestAnimationFrame(drawBars);
    };

    rafId = requestAnimationFrame(drawBars);
    return () => cancelAnimationFrame(rafId);
  }, [isLive, mode, toneMuted]);

  // 440Hz / 1kHz reference tone during On-Air Standby when unmuted
  useEffect(() => {
    if (isLive || mode !== 'onair' || toneMuted) return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc440 = ctx.createOscillator();
    const osc1k = ctx.createOscillator();
    const gain = ctx.createGain();

    osc440.type = 'sine';
    osc440.frequency.value = 440;
    osc1k.type = 'sine';
    osc1k.frequency.value = 1000;
    gain.gain.value = 0.05;

    osc440.connect(gain);
    osc1k.connect(gain);
    gain.connect(ctx.destination);

    osc440.start();
    osc1k.start();

    return () => {
      try {
        osc440.stop();
        osc1k.stop();
        void ctx.close();
      } catch {
        // ignore close errors
      }
    };
  }, [isLive, mode, toneMuted]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
      {isLive ? (
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          className="h-full w-full object-contain"
        />
      ) : mode === 'onair' ? (
        <>
          <canvas ref={barsCanvasRef} width={960} height={540} className="h-full w-full object-cover opacity-80" />
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-black/45 px-4 backdrop-blur-[1px]"
          >
            <div className="flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-950/90 px-3 py-1 text-xs font-semibold text-zinc-100 shadow">
              <Radio className="h-3.5 w-3.5 text-cyan-400" />
              On-Air Standby · Waiting for OBS Studio
            </div>

            <div className="flex w-full max-w-md flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/80 bg-zinc-950/90 px-3 py-1.5 text-xs shadow">
                <div className="min-w-0">
                  <span className="mr-2 text-[10px] uppercase tracking-wide text-zinc-400">Server</span>
                  <code className="font-mono text-cyan-300">rtmp://127.0.0.1:1935/live</code>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('server', 'rtmp://127.0.0.1:1935/live')}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
                >
                  {copiedKey === 'server' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'server' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/80 bg-zinc-950/90 px-3 py-1.5 text-xs shadow">
                <div className="min-w-0">
                  <span className="mr-2 text-[10px] uppercase tracking-wide text-zinc-400">Stream Key</span>
                  <code className="font-mono text-cyan-300">program</code>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('key', 'program')}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
                >
                  {copiedKey === 'key' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'key' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {onOpenObsGuide && (
              <button
                type="button"
                onClick={onOpenObsGuide}
                className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/50 bg-zinc-950/90 px-3 py-1.5 text-xs font-medium text-cyan-200 shadow hover:bg-zinc-900"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Open OBS Setup Guide
              </button>
            )}
          </div>
        </>
      ) : (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="relative z-20 flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-zinc-400"
        >
          <Monitor className="h-9 w-9 text-emerald-400/60" />
          <p className="text-sm font-semibold text-zinc-200">Off-Air Capture Standby</p>
          <p className="max-w-sm text-[11px] text-zinc-400">
            Select <strong>Desktop Screen (DXGI)</strong> or a connected <strong>Capture Card</strong> in the Off-Air bar above, then click <strong>Start Off-Air Capture</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
