# # Project: ComboCut (v0.1.0 Public Beta)
An open-source (MIT License), 100% local, zero-cost Windows live broadcast router, rolling DVR clipper, AI highlight assistant, and short-form mini-editor (a local, free alternative to Grabyo and Medal).

## 1. Core Principles & Constraints
- **100% Local & $0 Cost:** Zero cloud servers, zero external paid APIs, zero telemetry. Everything runs locally on the user's Windows PC.
- **Target Platform:** Windows 10/11 (x64). Use Windows-safe paths (`path.join`), `.exe` binaries, and graceful FFmpeg shutdown (`child.stdin.write('q')` instead of `SIGKILL` so MP4 moov atoms finalize cleanly).
- **2018+ GPU First:** Target NVIDIA RTX 20-series+ (Turing Tensor Cores / `h264_nvenc`) and AMD RX 5000-series+ (RDNA Matrix Cores / `h264_amf`), with Intel `h264_qsv` and `libx264` CPU fallbacks.
- **Single-PC Gaming Performance:** Keep Node.js RAM usage under 300 MB (never buffer video files in JS memory). Launch all clip rendering and AI child processes at Windows `BELOW_NORMAL` priority so game FPS and live encoding never stutter.
- **Windows Shell Execution:** Always prefix terminal commands with `cmd /c` so child shells exit immediately. For Windows process cleanup in PowerShell, use `Stop-Process` (e.g., `Stop-Process -Name mediamtx,ffmpeg,wasapi-capture -Force -ErrorAction SilentlyContinue`) or `2>$null` instead of `2>nul`.

## 2. Tech Stack & Directory Layout
- **Desktop & Frontend (`/client`):** React + TypeScript + Vite + Tailwind CSS + `hls.js` (DVR scrubbing) + WebCodecs/HTML5 Canvas (60fps mini-editor preview), packaged for Windows via Electron or Tauri.
- **Backend (`/server`):** Node.js + TypeScript + Express + WebSocket (`ws`) + SQLite (built-in node:sqlite DatabaseSync).
- **Native Windows Audio Helper (`/native/wasapi-capture`):** Lightweight Rust or C++ CLI tool capturing 3 synchronized Windows Core Audio tracks in Shared Mode without virtual cables:
  - Track 1: Game / System Loopback (`eConsole` or active game PID / Capture Card HDMI audio)
  - Track 2: Discord / Party Chat (`eCommunications` loopback or `Discord.exe` PID)
  - Track 3: User Microphone (`eCapture` input with USB hot-swap recovery)
- **Bundled Binaries (`/bin` - gitignored, downloaded via `npm run setup:bins`):**
  - `mediamtx.exe` (Local RTMP `:1935`, SRT `:8890`, Control API `:9997`)
  - `ffmpeg.exe` & `ffprobe.exe` (Windows x64 build with OpenSSL/GnuTLS for `rtmps://`, `nvenc`, `amf`, `ddagrab`, and `dshow`)
  - `whisper-cli.exe` (`whisper.cpp` compiled with Vulkan Cooperative Matrix backend for RTX Tensor Cores & AMD Matrix Cores) + quantized `ggml-small.en-q5_1.bin` / `ggml-large-v3-turbo-q5_0.bin`
- **Runtime Folders (gitignored):** `/buffer` (rolling 2s HLS chunks), `/pinned` (45-90s protected highlight slices), `/exports` (rendered MP4 + SRT files), `/data/studio.db` (SQLite).

## 3. Functional Architecture
1. **On-Air Mode (OBS / vMix / Dual-PC Live):**
   - `mediamtx.exe` ingests master streams at `rtmp://127.0.0.1:1935/live/program` (plus optional Tier-2 clean feeds `/live/cam` and `/live/clean`).
   - Isolated FFmpeg `-c copy -f flv` relay workers push the stream simultaneously to Twitch, YouTube Live, Kick, and custom RTMPS endpoints (with optional GPU downscale to `1080p60 @ 7500 kbps` for Twitch when ingesting `1440p`/`4K`).
   - OBS WebSocket v5 (`ws://127.0.0.1:4455`) logs scene switches as timeline markers, imports exact facecam transform coordinates, and triggers auto-handoff.
2. **Off-Air Mode (No OBS Required):**
   - **Single-PC Game Capture:** GPU-accelerated DXGI (`ddagrab` -> `nvenc`/`amf`) + 3-track WASAPI audio into the rolling DVR buffer.
   - **Dual-PC / Console Capture Card:** DirectShow (`dshow`) capture for Elgato/AVerMedia/UVC cards + optional local webcam. **CRITICAL:** Automatically release the capture card handle the instant OBS connects or an RTMP stream starts on `/live/program`.
   - **VOD & Replay Watcher:** Fast-pass (`20x+`) scanner for dropped `.mp4`/`.mkv` files and a folder watcher for ShadowPlay/ReLive/OBS Replays.
3. **Smart Storage & DVR Ring Buffer:**
   - Configurable 15–30 minute self-pruning 2-second HLS ring buffer (`~1.1–4.5 GB`), plus an optional **RAM-Only Buffer** toggle for 32 GB+ systems.
   - Pressing the global highlight hotkey, switching OBS scenes, or triggering an AI candidate immediately extracts a protected `45–90s` slice into `/pinned` so old highlights survive buffer rotation.
4. **4-Signal User-Approvable AI Highlight Funnel:**
   - Lightweight continuous sensors: (1) Live chat velocity/emote spikes (On-Air only), (2) Mic/Discord vs. Game audio peaks, (3) FFmpeg `scdet` scene/action bursts.
   - Burst GPU verification: Only on candidate windows, extract a 45s 16kHz mono audio slice and run Vulkan `whisper.cpp` (`< 1 GB` VRAM, unloaded immediately after inference). Queue passing clips in the **AI Approval Queue** (`Approve & Load`, `Quick Auto-Export`, `Dismiss`) and update local SQLite preference weights on user feedback.
5. **Control Room UI, Dual-Viewport Cropper & Mini-Editor:**
   - **Quick Clip Mode:** Live/DVR scrubber (`J/K/L`, `I/O`), side-by-side `16:9` source & `9:16` vertical preview (resolution-agnostic normalized coordinates supporting 2-box Gameplay + Facecam split, OBS scene-linked templates, and TikTok/Reels/Shorts/Universal safe-zone overlays), 3-track post-clip audio mixer (`Game / Discord / Mic` + `-14 LUFS` normalize), and speaker-aware burned-in GPU captions.
   - **Studio Mini-Editor Mode:** Expandable CapCut/Edits-style stacked multi-track timeline (Gameplay, Facecam, Captions, Text/PNG Overlays, SFX) with blade split (`Ctrl+K`), keyframed punch-in zooms, speed ramps, color presets, and single-pass FFmpeg `filter_complex` GPU export.

## 4. Verification & Open-Source Release Standards
- Include `npm run test:stream` pushing a synthetic `1080p60` H.264 stream (`testsrc2` with wallclock timecode + 440Hz sine audio, 2s GOP `-g 120`) to `rtmp://127.0.0.1:1935/live/program`.
- Include `.github/workflows/release.yml` to build the Windows `.exe` installer on version tags (`v*`), generate `SHA256SUMS.txt`, and include a ready-to-enable SignPath Foundation (`signpath/github-action`) step.