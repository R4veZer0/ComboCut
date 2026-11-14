import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const MODELS_DIR = path.join(BIN_DIR, 'models');
const TMP_DIR = path.join(BIN_DIR, '.tmp');
const FORCE = process.argv.includes('--force');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ComboCut-Setup/0.1.0',
      'Accept': 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

async function downloadFile(url, destPath) {
  console.log(`Downloading ${url} -> ${destPath}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ComboCut-Setup/0.1.0' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const fileStream = fs.createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
}

function extractZip(zipPath, destDir) {
  ensureDir(destDir);
  // Windows 10/11 includes bsdtar (tar.exe) which handles .zip much faster than Expand-Archive
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
  } catch {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`],
      { stdio: 'inherit' },
    );
  }
}

function findFilesRecursive(dir, predicate, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursive(full, predicate, results);
    } else if (predicate(entry.name, full)) {
      results.push(full);
    }
  }
  return results;
}

async function setupMediaMtx() {
  const target = path.join(BIN_DIR, 'mediamtx.exe');
  if (!FORCE && fs.existsSync(target)) {
    console.log('[MediaMTX] Already present, skipping (use --force to re-download).');
    return;
  }

  console.log('[MediaMTX] Checking latest Windows amd64 release...');
  const release = await fetchJson('https://api.github.com/repos/bluenviron/mediamtx/releases/latest');
  const asset = release.assets?.find(
    (a) => /windows_amd64\.zip$/i.test(a.name),
  );
  if (!asset) {
    throw new Error(`No windows_amd64.zip asset found in MediaMTX release ${release.tag_name}`);
  }

  console.log(`[MediaMTX] Found ${release.tag_name} (${asset.name})`);
  const zipPath = path.join(TMP_DIR, asset.name);
  const extractDir = path.join(TMP_DIR, 'mediamtx');
  await downloadFile(asset.browser_download_url, zipPath);
  extractZip(zipPath, extractDir);

  const found = findFilesRecursive(extractDir, (name) => name.toLowerCase() === 'mediamtx.exe');
  if (!found.length) {
    throw new Error('mediamtx.exe not found in extracted archive');
  }
  fs.copyFileSync(found[0], target);
  console.log(`[MediaMTX] Installed ${target}`);
}

async function setupFfmpeg() {
  const ffmpegTarget = path.join(BIN_DIR, 'ffmpeg.exe');
  const ffprobeTarget = path.join(BIN_DIR, 'ffprobe.exe');
  if (!FORCE && fs.existsSync(ffmpegTarget) && fs.existsSync(ffprobeTarget)) {
    console.log('[FFmpeg] Already present, skipping (use --force to re-download).');
    return;
  }

  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  const zipPath = path.join(TMP_DIR, 'ffmpeg-master-latest-win64-gpl.zip');
  const extractDir = path.join(TMP_DIR, 'ffmpeg');

  console.log('[FFmpeg] Downloading Windows x64 GPL build (with NVENC/AMF/QSV/ddagrab/dshow/RTMPS)...');
  await downloadFile(url, zipPath);
  extractZip(zipPath, extractDir);

  const exes = findFilesRecursive(extractDir, (name) =>
    ['ffmpeg.exe', 'ffprobe.exe'].includes(name.toLowerCase()),
  );
  for (const exe of exes) {
    const dest = path.join(BIN_DIR, path.basename(exe));
    fs.copyFileSync(exe, dest);
    console.log(`[FFmpeg] Installed ${dest}`);
  }
  if (!fs.existsSync(ffmpegTarget) || !fs.existsSync(ffprobeTarget)) {
    throw new Error('ffmpeg.exe or ffprobe.exe missing after extraction');
  }
}

async function setupWhisper() {
  const whisperTarget = path.join(BIN_DIR, 'whisper-cli.exe');
  const modelTarget = path.join(MODELS_DIR, 'ggml-small.en-q5_1.bin');

  if (FORCE || !fs.existsSync(whisperTarget)) {
    console.log('[whisper.cpp] Checking latest Windows x64 Vulkan release...');
    const release = await fetchJson('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest');
    const assets = release.assets ?? [];
    const asset =
      assets.find((a) => /vulkan.*x64.*\.zip$/i.test(a.name) || /x64.*vulkan.*\.zip$/i.test(a.name)) ||
      assets.find((a) => /whisper-bin-x64\.zip$/i.test(a.name)) ||
      assets.find((a) => /win.*x64.*\.zip$/i.test(a.name));

    if (!asset) {
      throw new Error(`No Windows x64 zip asset found in whisper.cpp release ${release.tag_name}`);
    }

    console.log(`[whisper.cpp] Found ${release.tag_name} (${asset.name})`);
    const zipPath = path.join(TMP_DIR, asset.name);
    const extractDir = path.join(TMP_DIR, 'whisper');
    await downloadFile(asset.browser_download_url, zipPath);
    extractZip(zipPath, extractDir);

    const files = findFilesRecursive(extractDir, (name) => /\.(exe|dll)$/i.test(name));
    for (const file of files) {
      const base = path.basename(file);
      // Normalize main.exe -> whisper-cli.exe if older packaging is encountered
      const destName = base.toLowerCase() === 'main.exe' ? 'whisper-cli.exe' : base;
      fs.copyFileSync(file, path.join(BIN_DIR, destName));
    }
    if (!fs.existsSync(whisperTarget)) {
      throw new Error('whisper-cli.exe not found in extracted whisper.cpp archive');
    }
    console.log(`[whisper.cpp] Installed ${whisperTarget}`);
  } else {
    console.log('[whisper.cpp] Binary already present, skipping.');
  }

  if (FORCE || !fs.existsSync(modelTarget)) {
    const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin';
    console.log('[whisper.cpp] Downloading ggml-small.en-q5_1.bin model...');
    await downloadFile(modelUrl, modelTarget);
    console.log(`[whisper.cpp] Installed ${modelTarget}`);
  } else {
    console.log('[whisper.cpp] Model ggml-small.en-q5_1.bin already present, skipping.');
  }
}

async function main() {
  ensureDir(BIN_DIR);
  ensureDir(MODELS_DIR);
  ensureDir(TMP_DIR);

  try {
    await setupMediaMtx();
    await setupFfmpeg();
    await setupWhisper();
    console.log('\nAll Windows x64 binaries and models are ready in /bin.');
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n[setup:bins] Failed:', err);
  process.exit(1);
});
