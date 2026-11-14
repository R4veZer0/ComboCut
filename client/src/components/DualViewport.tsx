import { useEffect, useRef, useState } from 'react';
import { Camera, Crosshair, LayoutGrid, Maximize2, Shield, Volume2, VolumeX } from 'lucide-react';
import { HlsPlayer } from './HlsPlayer';
import type {
  ColorPreset,
  LayoutMode,
  NormalizedRect,
  OffAirFacecamConfig,
  PinnedClip,
  SafeZonePlatform,
  SubtitleCue,
  SubtitleStyle,
} from '../types';

interface DualViewportProps {
  mode: 'onair' | 'offair';
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
  subtitleCues: SubtitleCue[];
  subtitleStyle: SubtitleStyle;
  speakerColor: string;
  watermarkText: string;
  colorPreset: ColorPreset;
  zoomScale: number;
  toneMuted?: boolean;
  onToggleToneMuted?: () => void;
  onOpenObsGuide?: () => void;
  offAirFacecam?: OffAirFacecamConfig;
  onOffAirFacecamChange?: (next: OffAirFacecamConfig) => void;
  hasOffAirWebcam?: boolean;
}

type DragTarget = 'gameplay' | 'facecam' | 'facecam_resize' | null;

export function DualViewport({
  mode,
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
  subtitleCues,
  subtitleStyle,
  speakerColor,
  watermarkText,
  colorPreset,
  zoomScale,
  toneMuted: externalToneMuted,
  onToggleToneMuted,
  onOpenObsGuide,
  offAirFacecam,
  onOffAirFacecamChange,
  hasOffAirWebcam,
}: DualViewportProps) {
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [localToneMuted, setLocalToneMuted] = useState(true);
  const toneMuted = externalToneMuted ?? localToneMuted;
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Live 60fps 9:16 Canvas compositor reading from active <video>
  useEffect(() => {
    let rafId = 0;
    const render = () => {
      const canvas = previewCanvasRef.current;
      const container = sourceContainerRef.current;
      const video = container?.querySelector('video') ?? videoRef.current;
      const standbyCanvas = container?.querySelector('canvas');
      const hasVideo = Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
      const sourceMedia: CanvasImageSource | null = hasVideo
        ? video!
        : standbyCanvas && standbyCanvas.width > 0
          ? standbyCanvas
          : null;
      const vw = hasVideo ? video!.videoWidth : standbyCanvas?.width ?? 0;
      const vh = hasVideo ? video!.videoHeight : standbyCanvas?.height ?? 0;

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#09090b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (sourceMedia && vw > 0 && vh > 0) {

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
              // Top 35% Facecam, Bottom 65% Gameplay
              drawCroppedCover(
                ctx,
                sourceMedia,
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
                sourceMedia,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                Math.round(canvas.height * 0.35),
                canvas.width,
                Math.round(canvas.height * 0.65),
              );
            } else if (layoutMode === 'top_cam_bottom_game') {
              // 50/50 split: Top 50% Facecam, Bottom 50% Gameplay
              const halfH = Math.round(canvas.height * 0.5);
              drawCroppedCover(
                ctx,
                sourceMedia,
                facecamRect.x * vw,
                facecamRect.y * vh,
                facecamRect.width * vw,
                facecamRect.height * vh,
                0,
                0,
                canvas.width,
                halfH,
              );
              drawCroppedCover(
                ctx,
                sourceMedia,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                halfH,
                canvas.width,
                canvas.height - halfH,
              );
            } else if (layoutMode === 'pip_rounded') {
              // Full gameplay + rounded-corner Facecam PiP top-right
              drawCroppedCover(
                ctx,
                sourceMedia,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                0,
                canvas.width,
                canvas.height,
              );
              const pipSize = Math.round(canvas.width * 0.3);
              const pipX = canvas.width - pipSize - 10;
              const pipY = Math.round(canvas.height * 0.08);
              const r = 12;
              ctx.save();
              ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
              ctx.shadowBlur = 12;
              ctx.shadowOffsetY = 4;
              ctx.fillStyle = '#09090b';
              ctx.beginPath();
              ctx.roundRect(pipX, pipY, pipSize, pipSize, r);
              ctx.fill();
              ctx.restore();
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(pipX, pipY, pipSize, pipSize, r);
              ctx.clip();
              drawCroppedCover(
                ctx,
                sourceMedia,
                facecamRect.x * vw,
                facecamRect.y * vh,
                facecamRect.width * vw,
                facecamRect.height * vh,
                pipX,
                pipY,
                pipSize,
                pipSize,
              );
              ctx.restore();
              ctx.save();
              ctx.strokeStyle = 'rgba(255,255,255,0.7)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.roundRect(pipX, pipY, pipSize, pipSize, r);
              ctx.stroke();
              ctx.restore();
            } else if (layoutMode === 'blurred_pillarbox') {
              // Blurred background fill + centered 16:9 gameplay
              ctx.save();
              ctx.filter = `${ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : ''}blur(10px) brightness(0.72)`;
              drawCroppedCover(
                ctx,
                sourceMedia,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                0,
                canvas.width,
                canvas.height,
              );
              ctx.restore();
              const fgW = canvas.width;
              const fgH = Math.round((fgW * (gameplayRect.height * vh)) / Math.max(1, gameplayRect.width * vw));
              const fgY = Math.round((canvas.height - fgH) / 2);
              ctx.drawImage(
                sourceMedia,
                gameplayRect.x * vw,
                gameplayRect.y * vh,
                gameplayRect.width * vw,
                gameplayRect.height * vh,
                0,
                fgY,
                fgW,
                fgH,
              );
            } else {
              const rect = layoutMode === 'fullscreen_cam' ? facecamRect : gameplayRect;
              drawCroppedCover(
                ctx,
                sourceMedia,
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

          if (captionsEnabled && subtitleCues.length > 0 && video) {
            const t = video.currentTime;
            const activeCue = subtitleCues.find((c) => t >= c.startSec && t <= c.endSec);
            if (activeCue && activeCue.text.trim()) {
              const previewFontPx = Math.max(11, Math.round((subtitleStyle.fontSize / 1080) * canvas.width));
              const yPos =
                subtitleStyle.verticalPos === 'top'
                  ? canvas.height * 0.14
                  : subtitleStyle.verticalPos === 'middle'
                    ? canvas.height * 0.5
                    : canvas.height * 0.76;
              const highlightHex = speakerColor || subtitleStyle.colorHex || '#facc15';
              ctx.save();
              ctx.font = `bold ${previewFontPx}px sans-serif`;
              ctx.textAlign = 'left';
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#000000';

              const cueWords =
                activeCue.words && activeCue.words.length > 0
                  ? activeCue.words
                  : activeCue.text
                      .trim()
                      .split(/\s+/)
                      .map((word, idx, arr) => {
                        const dur = Math.max(0.1, activeCue.endSec - activeCue.startSec);
                        const step = dur / arr.length;
                        return {
                          text: word,
                          startSec: activeCue.startSec + idx * step,
                          endSec: activeCue.startSec + (idx + 1) * step,
                        };
                      });

              const lines: Array<typeof cueWords> = [];
              let currentLine: typeof cueWords = [];
              let currentWidth = 0;
              const spaceW = ctx.measureText(' ').width;
              for (const w of cueWords) {
                const wWidth = ctx.measureText(w.text).width;
                const candidateW = currentLine.length > 0 ? currentWidth + spaceW + wWidth : wWidth;
                if (candidateW > canvas.width - 28 && currentLine.length > 0) {
                  lines.push(currentLine);
                  currentLine = [w];
                  currentWidth = wWidth;
                } else {
                  currentLine.push(w);
                  currentWidth = candidateW;
                }
              }
              if (currentLine.length > 0) lines.push(currentLine);

              lines.slice(0, 3).forEach((lineWords, idx) => {
                const ly = yPos + idx * (previewFontPx + 4);
                const totalLineW =
                  lineWords.reduce((acc, w) => acc + ctx.measureText(w.text).width, 0) +
                  Math.max(0, lineWords.length - 1) * spaceW;
                let cursorX = (canvas.width - totalLineW) / 2;
                for (const w of lineWords) {
                  const isActive = t >= w.startSec && t <= w.endSec;
                  const isSpoken = t >= w.startSec;
                  const wWidth = ctx.measureText(w.text).width;
                  ctx.save();
                  if (isActive) {
                    const cx = cursorX + wWidth / 2;
                    ctx.translate(cx, ly);
                    ctx.scale(1.12, 1.12);
                    ctx.translate(-cx, -ly);
                  }
                  ctx.strokeText(w.text, cursorX, ly);
                  ctx.fillStyle = isSpoken ? highlightHex : '#ffffff';
                  ctx.fillText(w.text, cursorX, ly);
                  ctx.restore();
                  cursorX += wWidth + spaceW;
                }
              });
              ctx.restore();
            }
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
    subtitleCues,
    subtitleStyle,
    speakerColor,
    watermarkText,
    colorPreset,
    zoomScale,
    videoRef,
  ]);

  function handlePointerDown(target: 'gameplay' | 'facecam' | 'facecam_resize', e: React.PointerEvent) {
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

    if (dragTarget === 'facecam_resize') {
      const nextWidth = Math.min(0.5, Math.max(0.15, normX - facecamRect.x));
      const nextHeight = Math.min(0.6, Math.max(0.12, nextWidth * (9 / 16) * (16 / 9)));
      onFacecamRectChange({
        ...facecamRect,
        width: Math.min(1 - facecamRect.x, nextWidth),
        height: Math.min(1 - facecamRect.y, nextHeight),
      });
      if (mode === 'offair' && hasOffAirWebcam && offAirFacecam && onOffAirFacecamChange) {
        onOffAirFacecamChange({
          ...offAirFacecam,
          widthPct: Math.round(Math.min(50, Math.max(15, nextWidth * 100))),
        });
      }
      return;
    }

    const current = dragTarget === 'gameplay' ? gameplayRect : facecamRect;
    const setter = dragTarget === 'gameplay' ? onGameplayRectChange : onFacecamRectChange;
    const nextX = Math.min(1 - current.width, Math.max(0, normX - dragOffsetRef.current.dx));
    const nextY = Math.min(1 - current.height, Math.max(0, normY - dragOffsetRef.current.dy));

    setter({
      ...current,
      x: nextX,
      y: nextY,
    });
    if (dragTarget === 'facecam' && mode === 'offair' && hasOffAirWebcam && offAirFacecam && onOffAirFacecamChange) {
      onOffAirFacecamChange({
        ...offAirFacecam,
        x: Math.round(nextX * 1000) / 1000,
        y: Math.round(nextY * 1000) / 1000,
      });
    }
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-zinc-950 p-3">
      {/* Toolbar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'split_2box' as LayoutMode, label: '2-Box Split' },
            { id: 'top_cam_bottom_game' as LayoutMode, label: '50/50 Split' },
            { id: 'pip_rounded' as LayoutMode, label: 'Rounded PiP' },
            { id: 'blurred_pillarbox' as LayoutMode, label: 'Blur Pillar' },
            { id: 'fullscreen_gameplay' as LayoutMode, label: 'Full Game' },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onLayoutModeChange(preset.id)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                layoutMode === preset.id
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {preset.id === 'fullscreen_gameplay' ? (
                <Maximize2 className="h-3.5 w-3.5" />
              ) : (
                <LayoutGrid className="h-3.5 w-3.5" />
              )}
              {preset.label}
            </button>
          ))}
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
          {!loadedClip && mode === 'onair' && !(hlsActive && segmentCount > 0) && (
            <button
              type="button"
              onClick={() => {
                if (onToggleToneMuted) {
                  onToggleToneMuted();
                } else {
                  setLocalToneMuted((m) => !m);
                }
              }}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
                toneMuted
                  ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  : 'border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
              }`}
              title="Toggle 440Hz/1kHz SMPTE Reference Tone"
            >
              {toneMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              {toneMuted ? 'Tone Muted' : 'Tone Live (440Hz)'}
            </button>
          )}
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
              <HlsPlayer
                playlistUrl={hlsPlaylistUrl}
                active={hlsActive}
                segmentCount={segmentCount}
                mode={mode}
                toneMuted={toneMuted}
                onOpenObsGuide={onOpenObsGuide}
              />
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
                  borderRadius:
                    mode === 'offair' && hasOffAirWebcam && offAirFacecam
                      ? offAirFacecam.shape === 'circle'
                        ? '9999px'
                        : offAirFacecam.shape === 'rounded'
                          ? '12px'
                          : '0px'
                      : '0px',
                }}
                className={`absolute cursor-move bg-amber-400/15 ${
                  mode === 'offair' && hasOffAirWebcam && offAirFacecam && !offAirFacecam.border
                    ? 'border border-dashed border-amber-400/60'
                    : 'border-2 border-amber-400'
                }`}
              >
                <span className="bg-amber-400 px-1 py-0.5 text-[10px] font-bold text-zinc-950">
                  FACECAM
                  {mode === 'offair' && hasOffAirWebcam && offAirFacecam
                    ? ` ${offAirFacecam.widthPct}%${offAirFacecam.mirror ? ' · Mirror' : ''}${offAirFacecam.zoom > 1.05 ? ` · ${offAirFacecam.zoom.toFixed(1)}x` : ''}`
                    : ''}
                </span>
                <div
                  onPointerDown={(e) => handlePointerDown('facecam_resize', e)}
                  className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-amber-400"
                  title="Drag to resize Facecam"
                />
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
  source: CanvasImageSource,
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
  ctx.drawImage(source, rx, ry, rw, rh, dx, dy, dw, dh);
}
