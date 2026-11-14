# ComboCut (v0.1.0 Public Beta)

An open-source (MIT License), **100% local, zero-cost** Windows 10/11 live broadcast router, rolling 2-second HLS DVR clipper, 4-signal AI highlight assistant, and short-form 9:16 Studio Mini-Editor.

- **Zero cloud servers, zero subscriptions, zero telemetry.**
- **Hardware GPU first:** Auto-probes `h264_nvenc` (NVIDIA RTX 20+), `h264_amf` (AMD RX 5000+), `h264_qsv` (Intel), with `libx264` fallback.
- **3-Track Windows Core Audio (No Virtual Cables):** Captures discrete **Game/System**, **Discord/Communications**, and **User Mic** tracks via WASAPI Shared Mode (`/bin/wasapi-capture.exe`).

---

## 1. Quick Start (From Source)

### Prerequisites
- Windows 10 or Windows 11 (x64)
- Node.js 22+ (includes built-in `node:sqlite`)
- .NET Framework 4.x (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, built into Windows)

### Setup & Launch
```powershell
cmd /c npm install
cmd /c npm run setup:bins
cmd /c npm run build:wasapi
cmd /c npm run dev
```
Open `http://127.0.0.1:5173` in your browser, or launch the standalone Electron desktop app:
```powershell
cmd /c npm run desktop:dev
```
To test without OBS, click **Demo Stream** in the Top Status Bar or run:
```powershell
cmd /c npm run test:stream
```

### Build Windows x64 Installer
```powershell
cmd /c npm run desktop:dist
```
The NSIS installer is generated in `release/ComboCut-Setup-0.1.0-x64.exe`.

---

## 2. On-Air, Dual-PC & Capture-Card Guide

### Single-PC / OBS On-Air Mode
1. In **OBS Studio -> Settings -> Stream**, set Service to **Custom...**
2. Set Server to: `rtmp://127.0.0.1:1935/live` and Stream Key to: `program`
3. *(Optional)* Enable **OBS WebSocket Server** (`ws://127.0.0.1:4455`) to auto-log scene switches as timeline markers and import exact facecam coordinates into ComboCut's 9:16 cropper.
4. *(Optional Tier-2 Clean Feeds)* Route uncropped facecam to `rtmp://127.0.0.1:1935/live/cam` and HUD-free gameplay to `rtmp://127.0.0.1:1935/live/clean`.

### Dual-PC & Console Capture Cards (Off-Air Mode)
1. Connect your Elgato / AVerMedia / UVC capture card to the streaming/clipping PC.
2. Switch ComboCut to **Off-Air** mode and select your `dshow` capture device (plus optional local webcam).
3. **Automatic Handoff:** ComboCut automatically releases the Windows capture-card handle the instant OBS WebSocket connects or an RTMP stream publishes to `/live/program`.

---

## 3. Windows SmartScreen & SHA-256 Verification (Public Beta v0.1.0)

Public Beta `v0.1.0` installers are unsigned while awaiting **SignPath Foundation** open-source code-signing approval. Before running the downloaded `.exe`, verify its SHA-256 checksum against `SHA256SUMS.txt` from the GitHub Release:

```powershell
Get-FileHash .\ComboCut-Setup-0.1.0-x64.exe -Algorithm SHA256
```
Compare the output hash with `SHA256SUMS.txt`. Once verified:
1. Double-click `ComboCut-Setup-0.1.0-x64.exe`.
2. When **Windows protected your PC** (SmartScreen) appears, click **More info**.
3. Click **Run anyway** to install ComboCut.

---

## License
MIT License — see [LICENSE](LICENSE).
