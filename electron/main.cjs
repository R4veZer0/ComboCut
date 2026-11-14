const { app, BrowserWindow, globalShortcut, dialog, ipcMain, shell, Tray, Menu, nativeImage, net } = require('electron');
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
let tray = null;
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

function isSilentUpdaterError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  const statusCode = err && typeof err === 'object' ? err.statusCode : undefined;
  const code = err && typeof err === 'object' ? String(err.code || '') : '';
  return (
    statusCode === 404 ||
    /\b404\b|cannot find latest\.yml|no published versions/i.test(msg) ||
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(
      `${code} ${msg}`
    )
  );
}

function handleUpdateError(err) {
  if (isSilentUpdaterError(err)) {
    sendUpdateStatus({ state: 'up-to-date', message: `Up to date — v${app.getVersion()}` });
    return;
  }
  sendUpdateStatus({
    state: 'error',
    message: err instanceof Error ? err.message : String(err || 'Update check failed'),
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;

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
    handleUpdateError(err);
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
      handleUpdateError(err);
    }
    return lastUpdateStatus;
  });

  ipcMain.handle('updater:install', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    killBackendTree();
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('dialog:selectDirectory', async (_event, defaultPath) => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Select DVR Buffer & Exports Folder',
      defaultPath: typeof defaultPath === 'string' && defaultPath.length > 0 ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('shell:openFolder', async (_event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.trim().length === 0) return '';
    return shell.openPath(targetPath);
  });

  ipcMain.handle('submit-feedback', async (_event, payload) => {
    const formResponseUrl =
      'https://docs.google.com/forms/d/e/1FAIpQLScvFtxFP5VNPmXfpCD2TVraARn2lu01ZGckajkMXcRupW2edw/formResponse';
    const fallbackUrl = 'https://forms.gle/AgcZhtAgxkM3UJxG7';

    const params = new URLSearchParams();
    params.set('entry.1002976204', String(payload?.category || 'Bug Report / Crash'));
    params.set('entry.55595861', String(payload?.details || ''));
    params.set('entry.94588325', String(payload?.handle || 'Anonymous'));
    params.set('entry.210789531', String(payload?.diagnostics || ''));

    try {
      const response = await net.fetch(formResponseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: params.toString(),
      });
      if (response.status === 200) {
        return { ok: true, status: response.status };
      }
      await shell.openExternal(fallbackUrl);
      return {
        ok: false,
        status: response.status,
        fallbackOpened: true,
        error: `Google Forms returned HTTP ${response.status}. Opened form in browser.`,
      };
    } catch (err) {
      await shell.openExternal(fallbackUrl);
      return {
        ok: false,
        fallbackOpened: true,
        error: err instanceof Error ? err.message : 'Network error reaching Google Forms',
      };
    }
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

function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const dot = x >= 5 && x <= 10 && y >= 5 && y <= 10;
      if (border) {
        buf[idx] = 99;
        buf[idx + 1] = 102;
        buf[idx + 2] = 241;
        buf[idx + 3] = 255;
      } else if (dot) {
        buf[idx] = 244;
        buf[idx + 1] = 63;
        buf[idx + 2] = 94;
        buf[idx + 3] = 255;
      } else {
        buf[idx] = 24;
        buf[idx + 1] = 24;
        buf[idx + 2] = 27;
        buf[idx + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('ComboCut Control Room (v0.2.0)');
  const menu = Menu.buildFromTemplate([
    { label: 'Show ComboCut', click: () => showMainWindow() },
    {
      label: 'Minimize to Tray',
      click: () => {
        if (mainWindow) mainWindow.hide();
      },
    },
    { type: 'separator' },
    { label: 'Mark Highlight (F9)', click: () => triggerGlobalPin() },
    { type: 'separator' },
    {
      label: 'Quit ComboCut',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showMainWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#09090b',
    title: 'ComboCut Control Room (v0.2.0)',
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
  createTray();
  createWindow();
});

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  globalShortcut.unregisterAll();
  killBackendTree();
});

app.on('window-all-closed', () => {
  app.quit();
});
