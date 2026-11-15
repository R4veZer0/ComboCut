# ComboCut (v0.2.0 Public Beta)

An open-source (MIT License), **100% local, zero-cost** Windows 10/11 live broadcast router, rolling DVR clipper, autonomous AI highlight assistant, and 9:16 short-form mini-editor — a free local alternative to Grabyo and Medal.

- **100% Local & $0 Forever:** No cloud servers, no subscriptions, no forced watermarks, no telemetry. Everything runs on your own Windows PC.
- **2018+ GPU Accelerated:** Auto-detects `h264_nvenc` (NVIDIA RTX 20-series+), `h264_amf` (AMD RX 5000-series+), and `h264_qsv` (Intel), with `libx264` CPU fallback.
- **Single- & Multi-Track Audio Ready:** Works out-of-the-box with **On-Air OBS/RTMP** streams, and includes native Windows WASAPI Shared Mode 3-track separation (**Game/System**, **Discord/Party Chat**, **Microphone**) without virtual audio cables.
- **Built-In Auto-Updater:** Checks `github.com/R4veZer0/ComboCut` Releases and Pre-releases for updates.

> **v0.2.0 Mode Note:** **On-Air (OBS / RTMP)** is the primary recommended workflow for v0.2.0. **Off-Air** single-PC capture is included as a **v0.3.0 Preview**.

---

## Features at a Glance

### 1. Live Broadcast Router & Multi-Destination Restreaming
- **Instant On-Air Standby:** Boots directly into On-Air mode with live standby bars & tone and switches automatically the moment OBS connects to `rtmp://127.0.0.1:1935/live/program`.
- **Simultaneous Restreaming:** Ingest once from OBS and relay via isolated FFmpeg `-c copy` workers to **Twitch**, **YouTube Live**, **Kick**, and custom RTMPS endpoints (with optional `1080p60` GPU downscale for Twitch when streaming `1440p`/`4K`).
- **OBS WebSocket v5 Integration (`ws://127.0.0.1:4455`):** Automatically logs scene switches as timeline markers and imports your exact facecam transform coordinates with **Import Cam from OBS**.

### 2. Self-Pruning Rolling DVR Buffer & Instant Pinning
- **2-Second HLS Ring Buffer:** Continuously buffers the last 15–30 minutes (with an automatic 6-minute floor when AI is active, plus an optional **RAM-Only Buffer** toggle for 32 GB+ PCs).
- **Protected Instant Highlights:** Hit **Mark Highlight** (or your global hotkey) anytime to lock a protected slice into `/pinned` so it survives buffer rotation.

### 3. Autonomous Multi-Modal AI Highlight Funnel
- **Vocal-Frequency Isolation (`300Hz–3400Hz`) + 25th-Percentile Quiet Floor:** Separates human voice commentary, callouts, and laughter from loud FPS gunfire/explosions using a rolling 60-second 25th-percentile noise floor so intense combat never desensitizes triggers.
- **Slice-First Architecture:** Triggers clip creation immediately when Stage-1 (Vocal + Full-Audio + Visual + Chat) crosses your threshold, slicing `12s` pre-peak to `8s` post-peak (or tracing back up to `180s` for `>= 20s` sustained stories/jokes), then runs GPU `whisper.cpp` asynchronously on the finished `.mp4`.
- **Pre-Bundled Vision Engine (`vision_model_quantized.onnx`):** Ships with Center Combat Zone & Kill-Feed/HUD delta scoring (`0.00–0.70`) plus CLIP ONNX semantic boost (`DirectML` / `CPU` / `WASM` automatic fallback) and a UI **Retry** button.
- **Hardware-Aware Modes & Sensitivity Presets:**
  - Modes: **Audio + Visual**, **Audio Only**, **Visual Only**, or **Off (Manual Only)** with live VRAM/GPU footprint badges.
  - Sensitivity: **High Recall (`0.85`)**, **Balanced (`1.05`)**, and **Strict (`1.25`)**.
- **AI Approval Queue & Dynamic Summaries:** Live telemetry readout (`Aud | Voc | Vis -> Score / Threshold`), in-app clip preview, 25+ moment taxonomy tags, 1-sentence AI summaries (with optional local Ollama / LM Studio refinement), and 1-click **Approve & Load**, **Quick Auto-Export**, or **Dismiss** (which adapts local SQLite preference weights).

### 4. Dual-Viewport 9:16 Cropper & Studio Mini-Editor
- **Side-by-Side `16:9` Source & `9:16` Vertical Preview:** Draggable Gameplay + Facecam boxes, **Import Cam from OBS**, and **TikTok / Shorts / Reels / Universal** safe-zone overlays.
- **3-Track Audio Mixer & GPU Captions:** Independent Game / Discord / Mic levels with `-14 LUFS` normalization and speaker-aware burned-in captions.
- **Studio Mini-Editor:** Stacked multi-track timeline (Gameplay, Facecam, Captions, Text/PNG Overlays, SFX), blade split (`Ctrl+K`), keyframed punch-in zooms, speed ramps, color presets, persistent brand watermark, and single-pass FFmpeg `filter_complex` GPU export.

---

## 1. Download & Install (Windows 10/11 x64)

1. Go to the **[Releases page](https://github.com/R4veZer0/ComboCut/releases)** and download **`ComboCut-Setup.exe`**.
2. *(Optional)* Download **`SHA256SUMS.txt`** from the same release and verify your download in PowerShell:
   ```powershell
   Get-FileHash .\ComboCut-Setup.exe -Algorithm SHA256
   ```
   Confirm the hash matches `SHA256SUMS.txt`.
3. Double-click **`ComboCut-Setup.exe`** to install (or upgrade an existing installation in-place).
4. **Windows SmartScreen Notice:** Because Public Beta `v0.2.0` is unsigned while awaiting **SignPath Foundation** open-source code-signing approval, Windows may show *"Windows protected your PC"*:
   - Click **More info**
   - Click **Run anyway**
5. Launch **ComboCut** from your Desktop or Start Menu shortcut.

---

## 2. Quick Setup Guides

### Option A: OBS Studio Live Mode (On-Air — Recommended for v0.2.0)
1. Open **OBS Studio -> Settings -> Stream**.
2. Set **Service** to **Custom...**.
3. Set **Server** to: `rtmp://127.0.0.1:1935/live`
4. Set **Stream Key** to: `program`
5. Open **Settings -> Output -> Streaming** and set **Keyframe Interval** to **`2 s`** (required for 2-second DVR segments).
6. *(Optional)* Enable **Tools -> WebSocket Server Settings** on port **`4455`** so ComboCut can auto-log scene switches as timeline markers and import your facecam box with **Import Cam from OBS**.
7. *(Optional Clean Feeds)* Send an uncropped facecam to `rtmp://127.0.0.1:1935/live/cam` or HUD-free gameplay to `rtmp://127.0.0.1:1935/live/clean`.

### Option B: Single-PC Gaming Without OBS (Off-Air — v0.3.0 Preview)
1. Switch the top bar in ComboCut to **Off-Air**.
2. Select your capture source (**Desktop Screen DXGI** or **Capture Card** + optional **Facecam**) and click **Start Off-Air Capture**.
3. ComboCut records 3 separate Windows audio tracks (**Game**, **Discord**, **Mic**) with no virtual cables needed.

### Option C: Dual-PC & Elgato / Capture Card Setup
- **Capture Card on Stream PC:** Connect your Elgato, AVerMedia, or UVC capture card, switch ComboCut to **Off-Air**, and select your DirectShow (`dshow`) device. ComboCut automatically releases the capture-card handle the instant OBS connects to `/live/program`.
- **Gaming PC OBS -> Stream PC ComboCut (Over LAN):** On your Gaming PC's OBS Stream settings, replace `127.0.0.1` with your Stream PC's local IP address (for example, `rtmp://192.168.1.50:1935/live`) and allow TCP port `1935` through Windows Firewall on the Stream PC.

---

## 3. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `J` / `K` / `L` | Shuttle backward / pause / forward |
| `I` / `O` | Set clip In and Out points |
| `Ctrl + K` | Blade split active track in Studio Mini-Editor |
| `Space` | Play / Pause preview |

---

## 4. Building From Source (Developers)

Requires Windows 10/11 (x64), Node.js 22+, and .NET Framework 4.x (`csc.exe`, built into Windows):

```powershell
cmd /c npm install
cmd /c npm run setup:bins
cmd /c node scripts/download-vision-model.mjs
cmd /c npm run build:wasapi
cmd /c npm run desktop:dev
```

To build the Windows x64 NSIS installer locally (`release\ComboCut-Setup.exe`):
```powershell
cmd /c npm run desktop:dist
```

---

## License
MIT License — see [LICENSE](LICENSE).
