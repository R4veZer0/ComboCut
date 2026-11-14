import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MODEL_URL =
  'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx';
const TARGET_DIR = path.join(ROOT_DIR, 'build-resources', 'models');
const TARGET_PATH = path.join(TARGET_DIR, 'vision_model_quantized.onnx');
const TMP_PATH = `${TARGET_PATH}.tmp`;
const MIN_BYTES = 20 * 1024 * 1024; // > 20 MB

function hasValidOnnxHeader(buf) {
  // ONNX ModelProto starts with protobuf field 1 (ir_version, varint tag 0x08) or field 2/3/7
  return buf.length >= MIN_BYTES && (buf[0] === 0x08 || buf[0] === 0x12 || buf[0] === 0x3a);
}

async function main() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  if (fs.existsSync(TARGET_PATH)) {
    const stat = fs.statSync(TARGET_PATH);
    if (stat.size >= MIN_BYTES) {
      const head = Buffer.alloc(16);
      const fd = fs.openSync(TARGET_PATH, 'r');
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      if (head[0] === 0x08 || head[0] === 0x12 || head[0] === 0x3a) {
        console.log(
          `[download-vision-model] Using existing ${TARGET_PATH} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`,
        );
        return;
      }
    }
  }

  console.log(`[download-vision-model] Fetching ${MODEL_URL}...`);
  const res = await fetch(MODEL_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': 'ComboCut/0.2.0' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!hasValidOnnxHeader(buf)) {
    throw new Error(`Downloaded file invalid or too small (${buf.byteLength} bytes, header=0x${buf[0]?.toString(16)})`);
  }

  fs.writeFileSync(TMP_PATH, buf);
  fs.renameSync(TMP_PATH, TARGET_PATH);
  console.log(
    `[download-vision-model] Saved ${TARGET_PATH} (${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB)`,
  );
}

main().catch((err) => {
  if (fs.existsSync(TMP_PATH)) fs.rmSync(TMP_PATH, { force: true });
  console.error('[download-vision-model] Failed:', err);
  process.exit(1);
});
