# ComboCut (v0.1.0 Public Beta)

An open-source (MIT License), **100% local, zero-cost** Windows 10/11 live broadcast router, rolling DVR clipper, AI highlight assistant, and 9:16 short-form mini-editor — a free local alternative to Grabyo and Medal.

- **100% Local & $0 Forever:** No cloud servers, no subscriptions, no watermarks, no telemetry.
- **2018+ GPU Accelerated:** Auto-detects `h264_nvenc` (NVIDIA RTX 20+), `h264_amf` (AMD RX 5000+), and `h264_qsv` (Intel), with `libx264` CPU fallback.
- **3-Track Audio Without Virtual Cables:** Separates **Game/System**, **Discord/Party Chat**, and **Microphone** using native Windows WASAPI Shared Mode.

---

## Features at a Glance

- **Multi-Destination Restreaming:** Ingest once from OBS and relay simultaneously to **Twitch**, **YouTube Live**, **Kick**, and custom RTMPS endpoints (with optional `1080p60` GPU downscale for Twitch when streaming `1440p`/`4K`).
- **Self-Pruning Rolling DVR Buffer:** Keeps the last 15–30 minutes in a 2-second HLS ring buffer (plus an optional **RAM-Only Buffer** toggle for 32 GB+ PCs).
- **Protected Instant Highlights:** Hit **Mark Highlight** (or your global hotkey) to lock a `45–90s` clip into `/pinned` so it survives buffer rotation.
- **4-Signal AI Highlight Funnel:** Combines chat velocity, 3-track audio peaks, and scene/action bursts with local GPU verification (`whisper.cpp`) and an **AI Approval Queue** (`Approve & Load`, `Quick Auto-Export`, `Dismiss`).
- **Dual-Viewport 9:16 Cropper & Studio Mini-Editor:** Side-by-side `16:9` source & `9:16` vertical preview with draggable Gameplay/Facecam boxes, **Import Cam from OBS**, TikTok/Shorts/Reels/Universal safe-zone overlays, `-14 LUFS` 3-track audio mixer, speaker-colored captions, blade split (`Ctrl+K`), keyframed zooms, speed ramps, and single-pass GPU export.

---

## 1. Download & Install (Windows 10/11 x64)

1. Go to the **[Releases page](https://github.com/R4veZer0/ComboCut/releases)** and download **`ComboCut-Setup.exe`**.
2. *(Optional)* Download **`SHA256SUMS.txt`** from the same release and verify your download in PowerShell:
   ```powershell
   Get-FileHash .\ComboCut-Setup.exe -Algorithm SHA256
   ```
   Confirm the hash matches `SHA256SUMS.txt`.
3. Double-click **`ComboCut-Setup.exe`** to run the setup wizard (or upgrade an existing installation in-place).
4. **Windows SmartScreen Notice:** Because Public Beta `v0.1.0` is unsigned while awaiting **SignPath Foundation** open-source code-signing approval, Windows may show *"Windows protected your PC"*:
   - Click **More info**
   - Click **Run anyway**
5. Launch **ComboCut** from your Desktop or Start Menu shortcut.

---

## 2. Quick Setup Guides

### Option A: OBS Studio Live Mode (On-Air)
Use this if you already stream or record with OBS Studio:
1. Open **OBS Studio -> Settings -> Stream**.
2. Set **Service** to **Custom...**.
3. Set **Server** to: `rtmp://127.0.0.1:1935/live`
4. Set **Stream Key** to: `program`
5. Open **Settings -> Output -> Streaming** and set **Keyframe Interval** to **`2 s`** (required for 2-second DVR segments).
6. *(Optional)* Enable **Tools -> WebSocket Server Settings** on port **`4455`** so ComboCut can auto-log scene switches as timeline markers and import your facecam box with **Import Cam from OBS**.
7. *(Optional Tier-2 Clean Feeds)* Send an uncropped facecam to `rtmp://127.0.0.1:1935/live/cam` or HUD-free gameplay to `rtmp://127.0.0.1:1935/live/clean`.

### Option B: Single-PC Gaming Without OBS (Off-Air)
1. Switch the top bar in ComboCut to **Off-Air**.
2. ComboCut captures your game using GPU DXGI (`ddagrab`) plus 3 separate Windows audio tracks (**Game**, **Discord**, **Mic**) with no virtual cables needed.
3. Click **Mark Highlight** (or press your hotkey) anytime to save the last 45–90 seconds.

### Option C: Dual-PC & Elgato / Capture Card Setup
- **Capture Card on Stream PC:** Connect your Elgato, AVerMedia, or UVC capture card, switch ComboCut to **Off-Air**, and select your DirectShow (`dshow`) device.
  - **Automatic Handoff:** ComboCut automatically releases the capture-card handle the instant OBS connects or an RTMP stream publishes to `/live/program`, preventing "Device in Use" errors.
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
