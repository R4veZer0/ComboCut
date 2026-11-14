import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { Radio } from 'lucide-react';

interface HlsPlayerProps {
  playlistUrl: string;
  active: boolean;
  segmentCount: number;
}

export function HlsPlayer({ playlistUrl, active, segmentCount }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || segmentCount < 1) return;

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
  }, [playlistUrl, active, segmentCount > 0]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-black">
      {active && segmentCount > 0 ? (
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
          <Radio className="h-10 w-10 opacity-40" />
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-300">Waiting for ingest on rtmp://127.0.0.1:1935/live/program</p>
            <p className="mt-1 text-xs text-zinc-500">
              Point OBS Studio or run <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">npm run test:stream</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
