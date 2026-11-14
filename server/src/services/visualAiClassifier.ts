import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { BIN_DIR, BINS, ROOT_DIR, RUNTIME_DIR } from '../config/paths.js';
import type { AiVisualFocus } from '../db/database.js';
import { setBelowNormalPriority } from '../utils/process.js';

const require = createRequire(import.meta.url);

function resolveUnpackedPath(targetPath: string): string {
  return targetPath.replace(/app\.asar([\\/])/gi, 'app.asar.unpacked$1');
}

const CLIP_VISION_MODEL_URL =
  'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx';
const CLIP_VISION_MODEL_FILENAME = 'vision_model_quantized.onnx';
const MIN_MODEL_BYTES = 20 * 1024 * 1024; // > 20 MB

const FRAME_W = 224;
const FRAME_H = 224;
const FRAME_BYTES = FRAME_W * FRAME_H * 3;

const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

export interface VisualClassificationResult {
  score: number;
  frameHudScore: number;
  semanticBoost: number;
  clutch: number;
  chaos: number;
  reaction: number;
  combatProb: number;
  hudBannerProb: number;
  chaosProb: number;
  reactionProb: number;
  negativeProbSum: number;
  rejected: boolean;
  provider: 'dml' | 'cpu' | 'wasm' | 'ffmpeg-hud';
  engineStatus: string;
  engineError: string | null;
  reasons: string[];
}

interface OrtModule {
  env?: {
    wasm?: {
      wasmPaths?: string;
    };
  };
  InferenceSession: {
    create: (
      pathOrBuffer: string | Uint8Array,
      options?: { executionProviders?: string[] },
    ) => Promise<{
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array | number[] }>>;
    }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

const FOCUS_WEIGHTS: Record<AiVisualFocus, { combat: number; hud: number; chaos: number }> = {
  balanced: { combat: 1.0, hud: 1.0, chaos: 1.0 },
  clutch_heavy: { combat: 1.15, hud: 1.15, chaos: 0.85 },
  funny_reactions: { combat: 0.9, hud: 0.9, chaos: 1.2 },
};

export class VisualAiClassifier {
  private ortPromise: Promise<OrtModule | null> | null = null;
  private ortWebPromise: Promise<OrtModule | null> | null = null;
  private activeOrt: OrtModule | null = null;
  private session: Awaited<ReturnType<OrtModule['InferenceSession']['create']>> | null = null;
  private sessionAttempted = false;
  private activeProvider: 'dml' | 'cpu' | 'wasm' | 'ffmpeg-hud' = 'ffmpeg-hud';
  private engineStatus = 'HUD Active (Initializing CLIP...)';
  private engineError: string | null = null;
  private downloadPromise: Promise<string | null> | null = null;
  private prevFrame: Uint8Array | null = null;
  private prevEmbedding: Float32Array | null = null;
  private segmentCounter = 0;

  constructor() {
    // Kick off non-blocking background model check/download on startup
    void this.ensureModelDownloaded();
  }

  getEngineStatus(): string {
    return this.engineStatus;
  }

  getEngineError(): string | null {
    return this.engineError;
  }

  private prepareOnnxNativePath(): string | null {
    try {
      const pkgPath = resolveUnpackedPath(require.resolve('onnxruntime-node/package.json'));
      const pkgDir = path.dirname(pkgPath);
      const binRoot = path.join(pkgDir, 'bin');
      const candidates: string[] = [];
      if (fs.existsSync(binRoot)) {
        for (const napiDir of fs.readdirSync(binRoot)) {
          const winDir = path.join(binRoot, napiDir, 'win32', 'x64');
          if (fs.existsSync(winDir)) {
            candidates.push(winDir);
          }
        }
      }
      // Prefer napi-v6 or napi-v3 if multiple exist
      candidates.sort((a, b) => b.localeCompare(a));
      const nativeDir = candidates[0] ?? null;
      if (nativeDir) {
        const curPath = process.env.PATH || '';
        if (!curPath.toLowerCase().includes(nativeDir.toLowerCase())) {
          process.env.PATH = `${nativeDir}${path.delimiter}${curPath}`;
        }
      }
      return pkgDir;
    } catch {
      return null;
    }
  }

  private async loadOrt(): Promise<OrtModule | null> {
    if (!this.ortPromise) {
      this.ortPromise = Promise.resolve().then(() => {
        try {
          const pkgDir = this.prepareOnnxNativePath();
          const entry = pkgDir ? resolveUnpackedPath(pkgDir) : 'onnxruntime-node';
          const mod = require(entry) as OrtModule;
          return mod;
        } catch (err: unknown) {
          const msg = err instanceof Error ? `${err.message}${err.stack ? ` | ${err.stack.split('\n')[0]}` : ''}` : String(err);
          this.engineError = msg;
          this.engineStatus = `HUD Active (ORT load error: ${msg})`;
          console.error('[VisualAI] onnxruntime-node load failed:', err);
          return null;
        }
      });
    }
    return this.ortPromise;
  }

  private async loadOrtWeb(): Promise<OrtModule | null> {
    if (!this.ortWebPromise) {
      this.ortWebPromise = Promise.resolve().then(() => {
        try {
          const webPkgPath = resolveUnpackedPath(require.resolve('onnxruntime-web/package.json'));
          const webDir = path.dirname(webPkgPath);
          const distDir = path.join(webDir, 'dist');
          const mod = require(webDir) as OrtModule;
          if (mod.env?.wasm && fs.existsSync(distDir)) {
            mod.env.wasm.wasmPaths = `${distDir}${path.sep}`;
          }
          return mod;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.engineError = this.engineError ? `${this.engineError} | WASM: ${msg}` : msg;
          console.error('[VisualAI] onnxruntime-web load failed:', err);
          return null;
        }
      });
    }
    return this.ortWebPromise;
  }

  private resolveVisualOnnxPath(): string | null {
    const candidates = [
      CLIP_VISION_MODEL_FILENAME,
      'clip-vit-b32-vision-quantized.onnx',
      'visual-highlight.onnx',
      'combocut-visual-v1.onnx',
    ];
    for (const dir of [
      path.join(RUNTIME_DIR, 'models'),
      path.join(BIN_DIR, 'models'),
      path.join(ROOT_DIR, 'build-resources', 'models'),
    ]) {
      for (const file of candidates) {
        const full = path.join(dir, file);
        if (fs.existsSync(full) && fs.statSync(full).size >= MIN_MODEL_BYTES) {
          return full;
        }
      }
    }
    return null;
  }

  private copyBundledModelIfAvailable(targetPath: string): string | null {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const sourceCandidates = [
      resourcesPath ? path.join(resourcesPath, 'models', CLIP_VISION_MODEL_FILENAME) : '',
      path.join(ROOT_DIR, 'models', CLIP_VISION_MODEL_FILENAME),
      path.join(ROOT_DIR, 'build-resources', 'models', CLIP_VISION_MODEL_FILENAME),
      path.join(RUNTIME_DIR, 'models', 'clip-vit-b32-vision-quantized.onnx'),
    ].filter(Boolean);

    for (const src of sourceCandidates) {
      if (src === targetPath) continue;
      if (fs.existsSync(src) && fs.statSync(src).size >= MIN_MODEL_BYTES) {
        const tmpPath = `${targetPath}.tmp`;
        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(src, tmpPath);
          fs.renameSync(tmpPath, targetPath);
          console.log(`[VisualAI] Copied pre-bundled vision model from ${src} -> ${targetPath}`);
          return targetPath;
        } catch {
          if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
        }
      }
    }
    return null;
  }

  async retryModelSetup(): Promise<{ ok: boolean; engineStatus: string; engineError: string | null }> {
    this.downloadPromise = null;
    this.ortPromise = null;
    this.ortWebPromise = null;
    this.sessionAttempted = false;
    this.session = null;
    this.activeOrt = null;
    this.engineError = null;
    await this.ensureModelDownloaded();
    const ok = await this.ensureSession();
    return { ok, engineStatus: this.engineStatus, engineError: this.engineError };
  }

  async ensureModelDownloaded(): Promise<string | null> {
    const userModelsDir = path.join(RUNTIME_DIR, 'models');
    const targetPath = path.join(userModelsDir, CLIP_VISION_MODEL_FILENAME);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size >= MIN_MODEL_BYTES) {
      return targetPath;
    }

    // Fast <1s copy from pre-bundled resources/models/ or build-resources/models/ before network fallback
    const copied = this.copyBundledModelIfAvailable(targetPath);
    if (copied) {
      this.sessionAttempted = false;
      return copied;
    }

    const existing = this.resolveVisualOnnxPath();
    if (existing) return existing;
    if (this.downloadPromise) return this.downloadPromise;

    this.downloadPromise = (async () => {
      const tmpPath = `${targetPath}.tmp`;
      try {
        fs.mkdirSync(userModelsDir, { recursive: true });
        this.engineStatus = 'HUD Active (Downloading CLIP Model...)';
        console.log(`[VisualAI] Downloading CLIP vision model to ${targetPath}...`);
        const res = await fetch(CLIP_VISION_MODEL_URL, {
          redirect: 'follow',
          headers: { 'User-Agent': 'ComboCut/0.2.0' },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength < MIN_MODEL_BYTES) {
          throw new Error(`Model too small (${buf.byteLength} bytes)`);
        }
        fs.writeFileSync(tmpPath, buf);
        fs.renameSync(tmpPath, targetPath);
        this.sessionAttempted = false; // allow session init now that model is present
        console.log(`[VisualAI] Downloaded CLIP vision model (${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB)`);
        return targetPath;
      } catch (err) {
        if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
        const msg = err instanceof Error ? err.message : String(err);
        this.engineStatus = `HUD Active (CLIP download failed: ${msg.slice(0, 50)})`;
        console.warn(`[VisualAI] Model download failed: ${msg}`);
        return null;
      }
    })();

    return this.downloadPromise;
  }

  private async probeDirectMlSafe(modelPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const script =
        "import('onnxruntime-node').then(async (ort) => { const s = await ort.default.InferenceSession.create(process.argv[1], { executionProviders: ['dml'] }); if (s) process.exit(0); process.exit(1); }).catch(() => process.exit(1));";
      const proc = spawn(process.execPath, ['--input-type=module', '-e', script, modelPath], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve(false);
      }, 8_000);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  private async ensureWasmSession(modelPath: string): Promise<boolean> {
    const ortWeb = await this.loadOrtWeb();
    if (!ortWeb) return false;
    try {
      const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
      this.session = await ortWeb.InferenceSession.create(modelBytes, {
        executionProviders: ['wasm'],
      });
      this.activeOrt = ortWeb;
      this.activeProvider = 'wasm';
      this.engineStatus = 'WASM Fallback + HUD Active';
      console.log(`[VisualAI] Loaded ONNX WASM fallback session: ${modelPath}`);
      return true;
    } catch (wasmErr) {
      const msg = wasmErr instanceof Error ? wasmErr.message : String(wasmErr);
      this.engineError = this.engineError ? `${this.engineError} | WASM session: ${msg}` : msg;
      this.session = null;
      this.activeOrt = null;
      this.activeProvider = 'ffmpeg-hud';
      this.engineStatus = `HUD Active (ONNX/WASM error: ${msg})`;
      return false;
    }
  }

  private async ensureSession(): Promise<boolean> {
    if (this.session) return true;
    if (this.sessionAttempted) return false;

    const modelPath = this.resolveVisualOnnxPath();
    if (!modelPath) {
      void this.ensureModelDownloaded();
      return false;
    }

    this.sessionAttempted = true;
    const ort = await this.loadOrt();
    if (!ort) {
      return this.ensureWasmSession(modelPath);
    }

    const dmlSafe = await this.probeDirectMlSafe(modelPath);
    if (dmlSafe) {
      try {
        this.session = await ort.InferenceSession.create(modelPath, {
          executionProviders: ['dml', 'cpu'],
        });
        this.activeOrt = ort;
        this.activeProvider = 'dml';
        this.engineError = null;
        this.engineStatus = 'DirectML GPU + HUD Active';
        console.log(`[VisualAI] Loaded ONNX DirectML session: ${modelPath}`);
        return true;
      } catch (dmlErr) {
        this.engineError = dmlErr instanceof Error ? dmlErr.message : String(dmlErr);
      }
    }

    try {
      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
      });
      this.activeOrt = ort;
      this.activeProvider = 'cpu';
      this.engineError = null;
      this.engineStatus = 'CPU ONNX + HUD Active';
      console.log(`[VisualAI] Loaded ONNX CPU session: ${modelPath}`);
      return true;
    } catch (cpuErr) {
      const msg = cpuErr instanceof Error ? cpuErr.message : String(cpuErr);
      this.engineError = msg;
      this.session = null;
      this.activeOrt = null;
      return this.ensureWasmSession(modelPath);
    }
  }

  async classifySegment(segmentPath: string, focus: AiVisualFocus): Promise<VisualClassificationResult> {
    const empty: VisualClassificationResult = {
      score: 0,
      frameHudScore: 0,
      semanticBoost: 0,
      clutch: 0,
      chaos: 0,
      reaction: 0,
      combatProb: 0,
      hudBannerProb: 0,
      chaosProb: 0,
      reactionProb: 0,
      negativeProbSum: 1,
      rejected: false,
      provider: this.activeProvider,
      engineStatus: this.engineStatus,
      engineError: this.engineError,
      reasons: [],
    };
    if (!fs.existsSync(BINS.ffmpeg) || !fs.existsSync(segmentPath)) {
      return empty;
    }

    this.segmentCounter += 1;
    const frames = await this.extractRgbFrames(segmentPath);
    if (frames.length === 0) {
      return empty;
    }

    let frameA: Uint8Array;
    let frameB: Uint8Array;
    if (frames.length >= 2) {
      frameA = frames[0];
      frameB = frames[frames.length - 1];
    } else if (this.prevFrame) {
      frameA = this.prevFrame;
      frameB = frames[0];
    } else {
      this.prevFrame = frames[0];
      return { ...empty, engineStatus: this.engineStatus };
    }
    this.prevFrame = frameB;

    const metrics = this.computeCenterAndHudDeltas(frameA, frameB);
    const w = FOCUS_WEIGHTS[focus];

    // Calibrated Frame & HUD Action Score (0.00 to 0.70), discounting uniform whole-screen panning
    const combatExcess = Math.max(0, metrics.centerDelta - metrics.wholeDelta * 0.65);
    const hudExcess = Math.max(0, metrics.hudDelta - metrics.wholeDelta * 0.55);
    const centerScore = Math.min(0.45, combatExcess * 3.0 * w.combat + metrics.centerDelta * 0.25);
    const hudScore = Math.min(0.35, (hudExcess * 2.4 + metrics.hudDelta * 0.3) * w.hud);
    const frameHudScore = round3(Math.min(0.7, centerScore + hudScore));

    // Hard rejection ONLY for static pause menus, lobbies, or loading screens
    const isStaticMenu =
      metrics.centerDelta < 0.015 && metrics.hudDelta < 0.015 && metrics.wholeDelta < 0.015;
    if (isStaticMenu) {
      return {
        ...empty,
        negativeProbSum: 0.95,
        rejected: true,
        provider: this.activeProvider,
        engineStatus: this.engineStatus,
        engineError: this.engineError,
      };
    }

    // Run DirectML CLIP inference whenever Frame/HUD Delta >= 0.15 or every 3rd segment
    let semanticBoost = 0;
    let embeddingShift = 0;
    if (frameHudScore >= 0.15 || this.segmentCounter % 3 === 0) {
      const clipRes = await this.runClipEmbedding(frameB);
      if (clipRes) {
        embeddingShift = clipRes.shift;
        // Combine semantic shift + frame/HUD activity into +0.00..+0.35 boost
        const rawBoost = clipRes.shift * 0.55 + (frameHudScore >= 0.2 ? 0.12 : 0.04) * w.chaos;
        semanticBoost = round3(Math.min(0.35, Math.max(0, rawBoost)));
      }
    } else {
      // Ensure model download/session status stays fresh
      void this.ensureSession();
    }

    const totalScore = round3(clamp01(frameHudScore + semanticBoost));
    const combatProb = round3(clamp01(combatExcess * 3.2 + semanticBoost * 0.7));
    const hudBannerProb = round3(clamp01(hudExcess * 3.5 + metrics.hudDelta * 0.8));
    const chaosProb = round3(clamp01((metrics.centerDelta + embeddingShift) * 1.4));
    const reactionProb = round3(clamp01(embeddingShift * 1.2));

    const reasons: string[] = [];
    if (combatProb >= 0.35) reasons.push(`Combat Action (${combatProb.toFixed(2)})`);
    if (hudBannerProb >= 0.25) reasons.push(`HUD/Kill-Feed Flash (${hudBannerProb.toFixed(2)})`);
    if (semanticBoost >= 0.15) reasons.push(`CLIP DirectML Boost (+${semanticBoost.toFixed(2)})`);

    return {
      score: totalScore,
      frameHudScore,
      semanticBoost,
      clutch: round3(Math.max(combatProb, hudBannerProb * 0.85)),
      chaos: chaosProb,
      reaction: reactionProb,
      combatProb,
      hudBannerProb,
      chaosProb,
      reactionProb,
      negativeProbSum: round3(Math.max(0, 1 - totalScore)),
      rejected: false,
      provider: this.activeProvider,
      engineStatus: this.engineStatus,
      engineError: this.engineError,
      reasons,
    };
  }

  private extractRgbFrames(segmentPath: string): Promise<Uint8Array[]> {
    return new Promise((resolve) => {
      const proc = spawn(
        BINS.ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          segmentPath,
          '-vf',
          `fps=1,scale=${FRAME_W}:${FRAME_H}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      );
      setBelowNormalPriority(proc);

      const chunks: Buffer[] = [];
      let totalLen = 0;
      const maxLen = FRAME_BYTES * 4;

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (totalLen < maxLen) {
          chunks.push(chunk);
          totalLen += chunk.length;
        }
      });

      proc.on('error', () => resolve([]));
      proc.on('close', () => {
        if (totalLen < FRAME_BYTES) {
          resolve([]);
          return;
        }
        const combined = Buffer.concat(chunks);
        const count = Math.min(4, Math.floor(combined.length / FRAME_BYTES));
        const frames: Uint8Array[] = [];
        for (let i = 0; i < count; i++) {
          const start = i * FRAME_BYTES;
          frames.push(combined.subarray(start, start + FRAME_BYTES));
        }
        resolve(frames);
      });
    });
  }

  private computeCenterAndHudDeltas(
    a: Uint8Array,
    b: Uint8Array,
  ): { wholeDelta: number; centerDelta: number; hudDelta: number } {
    let wholeSum = 0;
    let wholeCount = 0;
    let centerSum = 0;
    let centerCount = 0;
    let hudSum = 0;
    let hudCount = 0;

    // Step by 2 pixels horizontally & vertically for <2ms evaluation in JS
    for (let y = 0; y < FRAME_H; y += 2) {
      const rowOffset = y * FRAME_W * 3;
      const inCenterY = y >= 56 && y < 168;
      const inTopCenterY = y < 56;
      const inTopRightY = y < 67;

      for (let x = 0; x < FRAME_W; x += 2) {
        const idx = rowOffset + x * 3;
        const diff =
          (Math.abs(a[idx] - b[idx]) +
            Math.abs(a[idx + 1] - b[idx + 1]) +
            Math.abs(a[idx + 2] - b[idx + 2])) /
          (3 * 255);

        wholeSum += diff;
        wholeCount += 1;

        if (inCenterY && x >= 56 && x < 168) {
          centerSum += diff;
          centerCount += 1;
        }

        const inTopRight = inTopRightY && x >= 134;
        const inTopCenter = inTopCenterY && x >= 67 && x < 157;
        if (inTopRight || inTopCenter) {
          hudSum += diff;
          hudCount += 1;
        }
      }
    }

    return {
      wholeDelta: wholeCount > 0 ? wholeSum / wholeCount : 0,
      centerDelta: centerCount > 0 ? centerSum / centerCount : 0,
      hudDelta: hudCount > 0 ? hudSum / hudCount : 0,
    };
  }

  private async runClipEmbedding(frameRgb: Uint8Array): Promise<{ shift: number } | null> {
    if (!(await this.ensureSession())) return null;
    const ort = this.activeOrt;
    if (!ort || !this.session || this.session.inputNames.length === 0) return null;

    try {
      const pixelCount = FRAME_W * FRAME_H;
      const floatData = new Float32Array(3 * pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const rgbIdx = i * 3;
        floatData[i] = (frameRgb[rgbIdx] / 255 - CLIP_MEAN[0]) / CLIP_STD[0];
        floatData[pixelCount + i] = (frameRgb[rgbIdx + 1] / 255 - CLIP_MEAN[1]) / CLIP_STD[1];
        floatData[2 * pixelCount + i] = (frameRgb[rgbIdx + 2] / 255 - CLIP_MEAN[2]) / CLIP_STD[2];
      }

      const inputName = this.session.inputNames[0];
      const tensor = new ort.Tensor('float32', floatData, [1, 3, FRAME_H, FRAME_W]);
      const out = await this.session.run({ [inputName]: tensor });
      const outName = this.session.outputNames[0];
      const rawVec = out[outName]?.data;
      if (!rawVec || rawVec.length === 0) return null;

      const vec = new Float32Array(rawVec.length);
      let normSq = 0;
      for (let i = 0; i < rawVec.length; i++) {
        const val = Number(rawVec[i]);
        vec[i] = val;
        normSq += val * val;
      }
      const norm = Math.sqrt(normSq) || 1;
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }

      let shift = 0.18;
      if (this.prevEmbedding && this.prevEmbedding.length === vec.length) {
        let dot = 0;
        for (let i = 0; i < vec.length; i++) {
          dot += vec[i] * this.prevEmbedding[i];
        }
        shift = Math.max(0, Math.min(1, 1 - dot));
      }
      this.prevEmbedding = vec;
      return { shift };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.engineStatus = `HUD Active (CLIP infer err: ${msg.slice(0, 45)})`;
      return null;
    }
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
