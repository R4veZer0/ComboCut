# ComboCut v0.2.0 (Public Beta)

An open-source (MIT License), **100% local, $0-cost** Windows 10/11 live broadcast router, rolling DVR clipper, AI highlight assistant, and 9:16 short-form mini-editor.

> **Recommended Mode for v0.2.0:** **On-Air (OBS / RTMP)** is the primary recommended workflow in v0.2.0. **Off-Air** single-PC capture is included as a **v0.3.0 Preview**.

## What's New in v0.2.0
- **Always-Ready On-Air Live Standby:** Boots directly into On-Air mode with live standby bars & tone and automatically switches to your OBS stream (`rtmp://127.0.0.1:1935/live/program`).
- **Continuous Slice-First AI Highlight Funnel:**
  - **Vocal-Frequency Isolation (`300Hz–3400Hz`)** + **60s 25th-Percentile Quiet-Floor Baseline** so voice commentary, callouts, and laughter trigger reliably even during loud FPS combat.
  - **Auto-Detected Single/Multi-Track Audio:** Works seamlessly on both On-Air RTMP streams and 3-track Off-Air WASAPI captures.
  - **Pre-Bundled CLIP Vision Model (`vision_model_quantized.onnx`):** Ships inside the installer with Center Combat & Kill-Feed/HUD delta scoring, ONNX Runtime (`DirectML` / `CPU` / `WASM` fallback), and a UI **Retry** button.
  - **Hardware-Aware AI Modes & Sensitivity:** Switch between *Audio + Visual*, *Audio Only*, *Visual Only*, or *Off* with *High Recall (0.85)*, *Balanced (1.05)*, or *Strict (1.25)* thresholds and live score telemetry (`Aud | Voc | Vis`) in the AI Approval Queue.
  - **Dynamic Context-Aware Clipping & Rich Summaries:** Captures 12s–180s arcs with async GPU `whisper.cpp` transcription, 25+ moment taxonomy tags, and 1-sentence summaries.
- **In-App Queue Preview, Persistent Brand Watermark & Auto-Updater:** Checks `github.com/R4veZer0/ComboCut` Releases and Pre-releases automatically.

## Download & Install (Windows 10/11 x64)
1. Download **`ComboCut-Setup.exe`** below and run it.
2. *(Optional)* Verify the SHA-256 checksum against **`SHA256SUMS.txt`** in PowerShell:
   ```powershell
   Get-FileHash .\ComboCut-Setup.exe -Algorithm SHA256
   ```
3. **Windows SmartScreen:** Because Public Beta `v0.2.0` is unsigned, Windows may show *"Windows protected your PC"* — click **More info** -> **Run anyway**.
