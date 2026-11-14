import fs from 'node:fs';
import path from 'node:path';
import { getDriveFreeBytes, resolveBufferDir } from '../config/paths.js';
import { getSettings } from '../db/database.js';

const LOW_DISK_GUARD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const MIN_KEEP_SEGMENTS = 3;

export interface BufferPurgeResult {
  deletedFiles: number;
  freedBytes: number;
  remainingBytes: number;
  lowDiskTriggered: boolean;
}

export interface DvrRetentionStats {
  bufferDir: string;
  segmentCount: number;
  bufferBytes: number;
  maxBufferGb: number;
  bufferMinutes: number;
  freeDriveBytes: number | null;
  lowDiskWarning: boolean;
}

interface SegmentFileInfo {
  name: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

function getActiveBufferDir(): string {
  const settings = getSettings();
  const ramDiskActive = settings.ramDiskEnabled && settings.ramDiskPath.trim().length > 0;
  return resolveBufferDir(ramDiskActive ? settings.ramDiskPath : null);
}

function listSegmentFiles(bufferDir: string): SegmentFileInfo[] {
  if (!fs.existsSync(bufferDir)) return [];
  const entries = fs.readdirSync(bufferDir, { withFileTypes: true });
  const segments: SegmentFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') || !entry.name.startsWith('seg_')) continue;
    const fullPath = path.join(bufferDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      segments.push({
        name: entry.name,
        fullPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // File may have been rotated out by FFmpeg concurrently
    }
  }

  segments.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return segments;
}

export class DvrRetentionService {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.cleanupScratchFiles();
    this.enforce();
    this.timer = setInterval(() => {
      this.cleanupScratchFiles();
      this.enforce();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cleanupScratchFiles();
  }

  cleanupScratchFiles(): number {
    const bufferDir = getActiveBufferDir();
    if (!fs.existsSync(bufferDir)) return 0;

    let removed = 0;
    const now = Date.now();
    try {
      for (const entry of fs.readdirSync(bufferDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.tmp')) continue;
        const fullPath = path.join(bufferDir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > 15_000) {
            fs.unlinkSync(fullPath);
            removed++;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    return removed;
  }

  enforce(): BufferPurgeResult {
    const settings = getSettings();
    const bufferDir = getActiveBufferDir();
    const segments = listSegmentFiles(bufferDir);
    if (segments.length <= MIN_KEEP_SEGMENTS) {
      const remainingBytes = segments.reduce((acc, s) => acc + s.size, 0);
      return { deletedFiles: 0, freedBytes: 0, remainingBytes, lowDiskTriggered: false };
    }

    const now = Date.now();
    const aiActive = settings.aiDetectionMode !== 'off';
    const effectiveMinMinutes = aiActive ? Math.max(6, settings.bufferMinutes) : Math.max(1, settings.bufferMinutes);
    const maxAgeMs = effectiveMinMinutes * 60 * 1000;
    const minKeepSegments = aiActive ? Math.max(MIN_KEEP_SEGMENTS, 180) : MIN_KEEP_SEGMENTS;
    const maxBytes = Math.max(1, settings.maxBufferGb) * 1024 * 1024 * 1024;

    let totalBytes = segments.reduce((acc, s) => acc + s.size, 0);
    let freeBytes = getDriveFreeBytes(bufferDir);
    let lowDiskTriggered = freeBytes !== null && freeBytes < LOW_DISK_GUARD_BYTES;

    let deletedFiles = 0;
    let freedBytes = 0;
    let remainingCount = segments.length;

    for (const seg of segments) {
      if (remainingCount <= minKeepSegments) break;

      const tooOld = now - seg.mtimeMs > maxAgeMs;
      const overCap = totalBytes > maxBytes && (!aiActive || remainingCount > minKeepSegments);
      const needSpace = freeBytes !== null && freeBytes < LOW_DISK_GUARD_BYTES;

      if (!tooOld && !overCap && !needSpace) {
        continue;
      }

      try {
        fs.unlinkSync(seg.fullPath);
        deletedFiles++;
        freedBytes += seg.size;
        totalBytes -= seg.size;
        remainingCount--;
        if (freeBytes !== null) {
          freeBytes += seg.size;
        }
      } catch {
        // ignore concurrent delete
      }
    }

    if (deletedFiles > 0) {
      console.log(
        `[DvrRetention] Pruned ${deletedFiles} segment(s), freed ${(freedBytes / (1024 * 1024)).toFixed(1)} MB (lowDisk=${lowDiskTriggered})`,
      );
    }

    return {
      deletedFiles,
      freedBytes,
      remainingBytes: Math.max(0, totalBytes),
      lowDiskTriggered,
    };
  }

  purgeBufferNow(keepLatestCount = 2): BufferPurgeResult {
    const bufferDir = getActiveBufferDir();
    const segments = listSegmentFiles(bufferDir);
    const cutoff = Math.max(0, segments.length - keepLatestCount);

    let deletedFiles = 0;
    let freedBytes = 0;
    let remainingBytes = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i < cutoff) {
        try {
          fs.unlinkSync(seg.fullPath);
          deletedFiles++;
          freedBytes += seg.size;
        } catch {
          remainingBytes += seg.size;
        }
      } else {
        remainingBytes += seg.size;
      }
    }

    this.cleanupScratchFiles();
    console.log(
      `[DvrRetention] Manual purge removed ${deletedFiles} segment(s), freed ${(freedBytes / (1024 * 1024)).toFixed(1)} MB`,
    );

    return {
      deletedFiles,
      freedBytes,
      remainingBytes,
      lowDiskTriggered: false,
    };
  }

  getStats(): DvrRetentionStats {
    const settings = getSettings();
    const bufferDir = getActiveBufferDir();
    const segments = listSegmentFiles(bufferDir);
    const bufferBytes = segments.reduce((acc, s) => acc + s.size, 0);
    const freeDriveBytes = getDriveFreeBytes(bufferDir);

    return {
      bufferDir,
      segmentCount: segments.length,
      bufferBytes,
      maxBufferGb: settings.maxBufferGb,
      bufferMinutes: settings.bufferMinutes,
      freeDriveBytes,
      lowDiskWarning: freeDriveBytes !== null && freeDriveBytes < LOW_DISK_GUARD_BYTES,
    };
  }
}
