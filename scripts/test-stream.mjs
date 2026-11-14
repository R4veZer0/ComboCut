import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const FFMPEG_PATH = path.join(ROOT_DIR, 'bin', 'ffmpeg.exe');
const TARGET_URL = process.env.TEST_STREAM_URL || 'rtmp://127.0.0.1:1935/live/program';
const DURATION_SECONDS = process.env.TEST_STREAM_DURATION || '';

if (!fs.existsSync(FFMPEG_PATH)) {
  console.error(`Missing ${FFMPEG_PATH}. Run "npm run setup:bins" first.`);
  process.exit(1);
}

const args = [
  '-re',
  '-f', 'lavfi',
  '-i', 'testsrc2=size=1920x1080:rate=60',
  '-f', 'lavfi',
  '-i', 'sine=frequency=440:sample_rate=48000',
];

if (DURATION_SECONDS) {
  args.push('-t', DURATION_SECONDS);
}

args.push(
  '-vf', "drawtext=text='%{localtime}':fontsize=42:fontcolor=white:box=1:boxcolor=black@0.6:x=30:y=30",
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-tune', 'zerolatency',
  '-pix_fmt', 'yuv420p',
  '-g', '120',
  '-keyint_min', '120',
  '-sc_threshold', '0',
  '-b:v', '6000k',
  '-maxrate', '6000k',
  '-bufsize', '6000k',
  '-c:a', 'aac',
  '-b:a', '160k',
  '-ar', '48000',
  '-ac', '2',
  '-f', 'flv',
  TARGET_URL,
);

console.log(`[test:stream] Pushing synthetic 1080p60 stream (2s GOP -g 120) to ${TARGET_URL}`);
console.log('[test:stream] Press Ctrl+C to stop gracefully.');

const child = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'inherit', 'inherit'] });

function shutdown() {
  if (!child.killed && child.stdin.writable) {
    console.log('\n[test:stream] Sending graceful quit (q) to FFmpeg...');
    child.stdin.write('q');
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
