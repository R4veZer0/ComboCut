import os from 'node:os';
import { execFile, type ChildProcess } from 'node:child_process';

/**
 * Sets a spawned child process to BELOW_NORMAL priority on Windows
 * so game FPS and live encoding never stutter.
 */
export function setBelowNormalPriority(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Ignore if process already exited or permission denied
  }
}

/**
 * Gracefully stops an FFmpeg process by writing 'q' to stdin
 * so MP4 moov atoms and HLS playlists finalize cleanly.
 */
export function gracefulStopFfmpeg(child: ChildProcess, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    child.once('exit', done);

    try {
      if (child.stdin && child.stdin.writable) {
        child.stdin.write('q\n');
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        done();
      }
    }

    const timer = setTimeout(() => {
      if (!settled && child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      done();
    }, timeoutMs);
  });
}

/**
 * Forcefully terminates a process tree on Windows using taskkill /F /T /PID.
 */
export function forceKillProcessTree(pid: number | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!pid || pid <= 0) {
      resolve();
      return;
    }
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 4000 }, () => {
        resolve();
      });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

/**
 * Returns the first non-internal IPv4 LAN address for Dual-PC RTMP setup.
 */
export function getLocalLanIp(): string {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}
