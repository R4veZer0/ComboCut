import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BINS } from '../config/paths.js';

const execFileAsync = promisify(execFile);

export type VideoEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264';

export interface GpuDetectionResult {
  selected: VideoEncoder;
  adapterName: string;
  probed: Array<{
    encoder: VideoEncoder;
    available: boolean;
    reason?: string;
  }>;
  detectedAt: string;
}

async function detectGpuAdapterName(): Promise<string> {
  if (process.platform !== 'win32') return 'CPU / Unknown GPU';
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Microsoft Basic' } | Select-Object -ExpandProperty Name) -join ', '",
      ],
      { windowsHide: true, timeout: 4000 },
    );
    const cleaned = stdout.trim();
    if (cleaned.length > 0) return cleaned;
  } catch {
    // Fall back to nvidia-smi if WMI/CIM unavailable
  }
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name', '--format=csv,noheader'],
      { windowsHide: true, timeout: 3000 },
    );
    const cleaned = stdout.trim();
    if (cleaned.length > 0) return cleaned;
  } catch {
    // ignore
  }
  return 'Windows Display Adapter';
}

const CANDIDATE_ENCODERS: VideoEncoder[] = [
  'h264_nvenc',
  'h264_amf',
  'h264_qsv',
  'libx264',
];

async function probeEncoder(encoder: VideoEncoder): Promise<{ available: boolean; reason?: string }> {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=1280x720:r=60',
    '-frames:v', '1',
    '-pix_fmt', 'yuv420p',
    '-c:v', encoder,
    '-f', 'null',
    '-',
  ];

  try {
    await execFileAsync(BINS.ffmpeg, args, { timeout: 8000 });
    return { available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const firstLine = message.split(/\r?\n/).find((l) => l.trim().length > 0) ?? 'Probe failed';
    return { available: false, reason: firstLine.trim() };
  }
}

let cachedResult: GpuDetectionResult | null = null;

export async function detectGpuEncoder(force = false): Promise<GpuDetectionResult> {
  if (cachedResult && !force) {
    return cachedResult;
  }

  const adapterName = await detectGpuAdapterName();

  if (!fs.existsSync(BINS.ffmpeg)) {
    const fallback: GpuDetectionResult = {
      selected: 'libx264',
      adapterName,
      probed: CANDIDATE_ENCODERS.map((encoder) => ({
        encoder,
        available: encoder === 'libx264',
        reason: encoder === 'libx264' ? 'ffmpeg.exe missing; defaulting to libx264' : 'ffmpeg.exe missing',
      })),
      detectedAt: new Date().toISOString(),
    };
    cachedResult = fallback;
    return fallback;
  }

  const probed: GpuDetectionResult['probed'] = [];
  let selected: VideoEncoder = 'libx264';
  let found = false;

  for (const encoder of CANDIDATE_ENCODERS) {
    if (found) {
      probed.push({ encoder, available: false, reason: 'Skipped (higher-priority encoder selected)' });
      continue;
    }
    const res = await probeEncoder(encoder);
    probed.push({ encoder, available: res.available, reason: res.reason });
    if (res.available) {
      selected = encoder;
      found = true;
    }
  }

  cachedResult = {
    selected,
    adapterName,
    probed,
    detectedAt: new Date().toISOString(),
  };

  console.log(`[GPU] Auto-detected encoder: ${selected} (${adapterName})`);
  return cachedResult;
}

export function getCachedGpuEncoder(): GpuDetectionResult | null {
  return cachedResult;
}
