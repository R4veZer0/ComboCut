import { useEffect, useRef, useState } from 'react';
import { Camera, Crosshair, LayoutGrid, Maximize2, Shield } from 'lucide-react';
import { HlsPlayer } from './HlsPlayer';
import type {
  ColorPreset,
  LayoutMode,
  NormalizedRect,
  PinnedClip,
  SafeZonePlatform,
} from '../types';

interface DualViewportProps {
  hlsPlaylistUrl: string;
  hlsActive: boolean;
  segmentCount: number;
  loadedClip: PinnedClip | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  gameplayRect: NormalizedRect;
  onGameplayRectChange: (rect: NormalizedRect) => void;
  facecamRect: NormalizedRect;
  onFacecamRectChange: (rect: NormalizedRect) => void;
  safeZone: SafeZonePlatform;
  onSafeZoneChange: (sz: SafeZonePlatform) => void;
  onImportFromObs: () => void;
  onAiFaceSnap: () => void;
  captionsEnabled: boolean;
  captionText: string;
  speakerColor: string;
  watermarkText: string;
  colorPreset: ColorPreset;
  zoomScale: number;
}

type DragTarget = 'gameplay' | 'facecam' | null;

export function DualViewport({
  hlsPlaylistUrl,
  hlsActive,
  segmentCount,
  loadedClip,
  videoRef,
  layoutMode,
  onLayoutModeChange,
  gameplayRect,
  onGameplayRectChange,
  facecamRect,
  onFacecamRectChange,
  safeZone,
  onSafeZoneChange,
  onImportFromObs,
  onAiFaceSnap,
  captionsEnabled,
  captionText,
  speakerColor,
  watermarkText,
  colorPreset,
  zoomScale,
}: DualViewportProps) {
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Live 60fps 9:16 Canvas compositor reading from active <video>
  useEffect(() => {
    let rafId = 0;
    const render = () => {
      const canvas = previewCanvasRef.current;
      const container = sourceContainerRef.current;
      const video = container?.querySelector('video') ?? videoRef.current;

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#09090b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (video && video.readyState >= 2 && video.videoWidth > 0) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            ctx.save();
            if (colorPreset === 'vibrant') ctx.filter = 'saturate(1.25) contrast(1.08)';
            else if (colorPreset === 'cinematic') ctx.filter = 'saturate(0.92) contrast(1.14) brightness(0.98)';
            else if (colorPreset === 'crisp') ctx.filter = 'contrast(1.06) brightness(1.02)';

            if (zoomScale > 1.01) {
              const cx = canvas.width / 2;
              const cy = canvas.height / 2;
              ctx.translate(cx, cy);
              ctx.scale(zoomScale, zoomScale);
              ctx.translate(-cx, -cy);
            }

            if (layoutMode === 'split_2box') {
              // Top 35% Facecam (270 x 168), Bottom 65% Gameplay (270 x 312)
              drawCroppedCover(
                ctx,
                video,
                facecamRect.x * vw,
                facecamRect.y * vh,
                facecamRect.width * vw,
                facecamRect.height * vh,
                0,
                0,
                canvas.width,
                Math.round(canvas.height * 0.35),
              );
              drawCroppedCover(
                ctx,
                video,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                Math.round(canvas.height * 0.35),
                canvas.width,
                Math.round(canvas.height * 0.65),
              );
            } else {
              const rect = layoutMode === 'fullscreen_cam' ? facecamRect : gameplayRect;
              drawCroppedCover(
                ctx,
                video,
                rect.x * vw,
                rect.y * vh,
                rect.width * vw,
                rect.height * vh,
                0,
                0,
                canvas.width,
                canvas.height,
              );
            }
            ctx.restore();
          } else {
            ctx.fillStyle = '#3f3f46';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('9:16 Live Preview', canvas.width / 2, canvas.height / 2);
          }

          if (watermarkText.trim()) {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(10, 10, Math.min(180, watermarkText.length * 7 + 16), 20);
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(watermarkText.trim(), 16, 23);
            ctx.restore();
          }

          if (captionsEnabled && captionText.trim()) {
            ctx.save();
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.strokeText(captionText.trim(), canvas.width / 2, canvas.height * 0.72);
            ctx.fillStyle = speakerColor || '#facc15';
            ctx.fillText(captionText.trim(), canvas.width / 2, canvas.height * 0.72);
            ctx.restore();
          }
        }
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [
    layoutMode,
    gameplayRect,
    facecamRect,
    captionsEnabled,
    captionText,
    speakerColor,
    watermarkText,
    colorPreset,
    zoomScale,
    videoRef,
  ]);

  function handlePointerDown(target: 'gameplay' | 'facecam', e: React.PointerEvent) {
    e.stopPropagation();
    const container = sourceContainerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const rect = target === 'gameplay' ? gameplayRect : facecamRect;
    const normX = (e.clientX - bounds.left) / bounds.width;
    const normY = (e.clientY - bounds.top) / bounds.height;
    dragOffsetRef.current = { dx: normX - rect.x, dy: normY - rect.y };
    setDragTarget(target);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragTarget || !sourceContainerRef.current) return;
    const bounds = sourceContainerRef.current.getBoundingClientRect();
    const normX = (e.clientX - bounds.left) / bounds.width;
    const normY = (e.clientY - bounds.top) / bounds.height;

    const current = dragTarget === 'gameplay' ? gameplayRect : facecamRect;
    const setter = dragTarget === 'gameplay' ? onGameplayRectChange : onFacecamRectChange;
    const nextX = Math.min(1 - current.width, Math.max(0, normX - dragOffsetRef.current.dx));
    const nextY = Math.min(1 - current.height, Math.max(0, normY - dragOffsetRef.current.dy));

    setter({
      ...current,
      x: Math.round(nextX * 1000) / 1000,
      y: Math.round(nextY * 1000) / 1000,
    });
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-zinc-950 p-3">
      {/* Toolbar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onLayoutModeChange('split_2box')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
              layoutMode === 'split_2box'
                ? 'bg-indigo-600 text-white'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            2-Box Split
          </button>
          <button
            type="button"
            onClick={() => onLayoutModeChange('fullscreen_gameplay')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
              layoutMode === 'fullscreen_gameplay'
                ? 'bg-indigo-600 text-white'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Full Game
          </button>
          <button
            type="button"
            onClick={onImportFromObs}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Camera className="h-3.5 w-3.5 text-amber-400" />
            Import Cam from OBS
          </button>
          <button
            type="button"
            onClick={onAiFaceSnap}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
            AI Face-Snap
          </button>
        </div>

        {/* Safe-zone selector */}
        <div className="flex items-center gap-1 text-xs">
          <Shield className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-zinc-400">Safe Zone:</span>
          {(['none', 'tiktok', 'shorts', 'reels', 'universal'] as SafeZonePlatform[]).map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => onSafeZoneChange(sz)}
              className={`rounded px-2 py-0.5 text-[11px] capitalize ${
                safeZone === sz
                  ? 'bg-cyan-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {sz}
            </button>
          ))}
        </div>
      </div>

      {/* Dual Viewports */}
      <div className="flex flex-1 items-center justify-center gap-4 overflow-hidden">
        {/* 16:9 Source + Draggable Boxes */}
        <div className="flex flex-1 flex-col items-center">
          <div className="mb-1 flex w-full items-center justify-between text-[11px] text-zinc-400">
            <span>
              16:9 Source ({loadedClip ? `Pinned: ${loadedClip.filename}` : 'Live DVR Buffer'})
            </span>
            <span className="font-mono text-[10px] text-zinc-500">
              Game ({gameplayRect.x.toFixed(2)},{gameplayRect.y.toFixed(2)}) • Cam ({facecamRect.x.toFixed(2)},{facecamRect.y.toFixed(2)})
            </span>
          </div>

          <div
            ref={sourceContainerRef}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragTarget(null)}
            onPointerLeave={() => setDragTarget(null)}
            className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-800 bg-black select-none"
          >
            {loadedClip ? (
              <video
                ref={videoRef}
                src={`/pinned/${loadedClip.filename}`}
                controls
                playsInline
                className="h-full w-full object-contain"
              />
            ) : (
              <HlsPlayer playlistUrl={hlsPlaylistUrl} active={hlsActive} segmentCount={segmentCount} />
            )}

            {/* Draggable Gameplay Box */}
            <div
              onPointerDown={(e) => handlePointerDown('gameplay', e)}
              style={{
                left: `${gameplayRect.x * 100}%`,
                top: `${gameplayRect.y * 100}%`,
                width: `${gameplayRect.width * 100}%`,
                height: `${gameplayRect.height * 100}%`,
              }}
              className="absolute cursor-move border-2 border-cyan-400 bg-cyan-400/10"
            >
              <span className="bg-cyan-500 px-1 py-0.5 text-[10px] font-bold text-zinc-950">
                GAMEPLAY
              </span>
            </div>

            {/* Draggable Facecam Box */}
            {layoutMode !== 'fullscreen_gameplay' && (
              <div
                onPointerDown={(e) => handlePointerDown('facecam', e)}
                style={{
                  left: `${facecamRect.x * 100}%`,
                  top: `${facecamRect.y * 100}%`,
                  width: `${facecamRect.width * 100}%`,
                  height: `${facecamRect.height * 100}%`,
                }}
                className="absolute cursor-move border-2 border-amber-400 bg-amber-400/15"
              >
                <span className="bg-amber-400 px-1 py-0.5 text-[10px] font-bold text-zinc-950">
                  FACECAM
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 9:16 Live Vertical Preview */}
        <div className="flex shrink-0 flex-col items-center">
          <div className="mb-1 text-[11px] text-zinc-400">9:16 Vertical Preview</div>
          <div className="relative h-[380px] w-[214px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg">
            <canvas
              ref={previewCanvasRef}
              width={270}
              height={480}
              className="h-full w-full"
            />

            {/* Safe-Zone Overlays */}
            {safeZone !== 'none' && (
              <div className="pointer-events-none absolute inset-0">
                {/* Top safe margin */}
                <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-rose-400/70 bg-rose-500/15 px-1.5 pt-1 text-[9px] text-rose-200">
                  {safeZone.toUpperCase()} Top UI
                </div>
                {/* Right action buttons (TikTok/Reels/Shorts) */}
                {(safeZone === 'tiktok' || safeZone === 'reels' || safeZone === 'universal') && (
                  <div className="absolute right-0 top-[35%] bottom-[20%] w-[18%] border-l border-dashed border-rose-400/70 bg-rose-500/15" />
                )}
                {/* Bottom caption/title bar */}
                <div className="absolute inset-x-0 bottom-0 h-[20%] border-t border-dashed border-rose-400/70 bg-rose-500/15 px-1.5 pb-1 text-[9px] text-rose-200">
                  {safeZone.toUpperCase()} Caption/Nav Zone
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function drawCroppedCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  if (sw <= 0 || sh <= 0) return;
  const srcAspect = sw / sh;
  const dstAspect = dw / dh;
  let rx = sx;
  let ry = sy;
  let rw = sw;
  let rh = sh;

  if (srcAspect > dstAspect) {
    rw = sh * dstAspect;
    rx = sx + (sw - rw) / 2;
  } else {
    rh = sw / dstAspect;
    ry = sy + (sh - rh) / 2;
  }
  ctx.drawImage(video, rx, ry, rw, rh, dx, dy, dw, dh);
}
