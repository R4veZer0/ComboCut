const { app, BrowserWindow, globalShortcut, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const API_URL = 'http://127.0.0.1:3001/api/status';
const PIN_URL = 'http://127.0.0.1:3001/api/clips/pin';
const APP_URL = 'http://127.0.0.1:3001';

let backendProc = null;
let mainWindow = null;
let isQuitting = false;
let lastUpdateStatus = { state: 'idle', message: '' };
let startupLogPath = '';
let stderrTail = '';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function appendStartupLog(line) {
  if (!startupLogPath) return;
  try {
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // ignore log write failures
  }
}

function sendUpdateStatus(status) {
  lastUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking', message: 'Checking GitHub Releases for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      state: 'available',
      version: info.version,
      message: `Update v${info.version} available. Downloading...`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ state: 'up-to-date', message: `ComboCut v${app.getVersion()} is up to date.` });
  });

  autoUpdater.on('download-progress', (prog) => {
    const pct = Math.round(prog.percent || 0);
    sendUpdateStatus({
      state: 'downloading',
      percent: pct,
      message: `Downloading update... ${pct}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      state: 'downloaded',
      version: info.version,
      message: `Update v${info.version} ready to install.`,
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      state: 'error',
      message: err ? err.message : 'Update check failed',
    });
  });

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      const devMsg = { state: 'up-to-date', message: 'Dev mode: auto-updater runs in packaged builds.' };
      sendUpdateStatus(devMsg);
      return devMsg;
    }
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      sendUpdateStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return lastUpdateStatus;
  });

  ipcMain.handle('updater:install', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    killBackendTree();
    autoUpdater.quitAndInstall(false, true);
  });

  if (app.isPackaged) {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
}

function startBackend() {
  const isPackaged = app.isPackaged;
  const userDataDir = app.getPath('userData');
  const videosDir = app.getPath('videos');
  const resourcesDir = isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');

  fs.mkdirSync(userDataDir, { recursive: true });
  startupLogPath = path.join(userDataDir, 'startup.log');
  fs.writeFileSync(startupLogPath, `[${new Date().toISOString()}] === ComboCut Desktop Startup ===\n`, 'utf8');

  const unpackedRoot = isPackaged
    ? path.join(resourcesDir, 'app.asar.unpacked')
    : path.resolve(__dirname, '..');

  const serverEntry = path.join(unpackedRoot, 'server', 'dist', 'index.js');
  const clientDist = path.join(unpackedRoot, 'client', 'dist');

  appendStartupLog(`isPackaged=${isPackaged}`);
  appendStartupLog(`serverEntry=${serverEntry} (exists=${fs.existsSync(serverEntry)})`);
  appendStartupLog(`clientDist=${clientDist} (exists=${fs.existsSync(clientDist)})`);
  appendStartupLog(`COMBOCUT_USER_DATA=${userDataDir}`);
  appendStartupLog(`COMBOCUT_RESOURCES_PATH=${resourcesDir}`);
  appendStartupLog(`COMBOCUT_VIDEOS_DIR=${videosDir}`);

  stderrTail = '';
  backendProc = spawn(process.execPath, [serverEntry], {
    cwd: userDataDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '3001',
      COMBOCUT_SERVE_CLIENT: 'true',
      COMBOCUT_RESOURCES_PATH: resourcesDir,
      COMBOCUT_USER_DATA: userDataDir,
      COMBOCUT_VIDEOS_DIR: videosDir,
      COMBOCUT_CLIENT_DIR: clientDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProc.stdout.on('data', (d) => {
    const text = d.toString('utf8');
    process.stdout.write(`[Backend] ${text}`);
    appendStartupLog(`[stdout] ${text.trimEnd()}`);
  });

  backendProc.stderr.on('data', (d) => {
    const text = d.toString('utf8');
    process.stderr.write(`[Backend ERR] ${text}`);
    stderrTail = (stderrTail + text).slice(-2000);
    appendStartupLog(`[stderr] ${text.trimEnd()}`);
  });

  backendProc.on('exit', (code, signal) => {
    appendStartupLog(`[exit] code=${code} signal=${signal}`);
  });
}

function waitForBackend(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      const details = stderrTail.trim()
        ? `${reason}\n\nBackend stderr:\n${stderrTail.trim()}\n\nLog: ${startupLogPath}`
        : `${reason}\n\nLog: ${startupLogPath}`;
      reject(new Error(details));
    };

    if (backendProc) {
      backendProc.once('exit', (code, signal) => {
        if (!settled) {
          fail(`Backend exited prematurely (code=${code}, signal=${signal})`);
        }
      });
    }

    const probe = () => {
      if (settled) return;
      const req = http.get(API_URL, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          settled = true;
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          fail(`Backend returned status ${res.statusCode}`);
        } else {
          setTimeout(probe, 300);
        }
      });
      req.on('error', () => {
        if (settled) return;
        if (Date.now() - start > timeoutMs) {
          fail('Backend startup timed out');
        } else {
          setTimeout(probe, 300);
        }
      });
    };
    probe();
  });
}

function triggerGlobalPin() {
  const payload = JSON.stringify({
    triggerSource: 'hotkey',
    triggerLabel: 'Global Hotkey Pin',
    durationSec: 60,
  });
  const req = http.request(
    PIN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => res.resume(),
  );
  req.on('error', (err) => console.warn('[Hotkey] Pin failed:', err.message));
  req.write(payload);
  req.end();
}

function killBackendTree() {
  if (backendProc && backendProc.pid) {
    if (process.platform === 'win32') {
      try {
        execFileSync('cmd', ['/c', 'taskkill', '/F', '/T', '/PID', String(backendProc.pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // ignore if already exited
      }
    } else {
      try {
        backendProc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    backendProc = null;
  }

  if (process.platform === 'win32') {
    for (const img of ['mediamtx.exe', 'ffmpeg.exe', 'wasapi-capture.exe']) {
      try {
        execFileSync('cmd', ['/c', 'taskkill', '/F', '/T', '/IM', img], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // ignore if not running
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#09090b',
    title: 'ComboCut Control Room (v0.1.0)',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.on('did-finish-load', () => {
    if (lastUpdateStatus.state !== 'idle') {
      mainWindow.webContents.send('update-status', lastUpdateStatus);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend();
  } catch (err) {
    dialog.showErrorBox('ComboCut Startup Error', err.message);
    killBackendTree();
    app.quit();
    return;
  }

  for (const accel of ['CommandOrControl+Shift+H', 'F9']) {
    try {
      globalShortcut.register(accel, triggerGlobalPin);
    } catch {
      // ignore if key is claimed by another app
    }
  }

  setupAutoUpdater();
  createWindow();
});

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  globalShortcut.unregisterAll();
  killBackendTree();
});

app.on('window-all-closed', () => {
  app.quit();
});
