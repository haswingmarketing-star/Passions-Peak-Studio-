# Vertical Video Pipeline — Standalone Creator Kit

A self-contained Python 3.10+ production pipeline for assembling vertical (1080×1920) and widescreen (1920×1080) serialized micro-dramas using Flask, HTMX, Alpine.js, Gemini, ElevenLabs / Edge-TTS, Whisper, pydub, MoviePy, and ffmpeg.

Designed to work standalone **or** consume exported **Project Bundles** (`manifest.json` + `assets/`) directly from the browser studio.

---

## Prerequisites

- **Python 3.10+**
- **ffmpeg 6.x** (or `imageio-ffmpeg` fallback installed via `requirements.txt`)
- Optional API keys in `.env`:
  - `GEMINI_API_KEY` (for script and reference-guided image generation)
  - `ELEVENLABS_API_KEY` (optional; leave blank to use free `edge-tts`)

## Quick Setup (3 Commands)

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && python app.py
```

Or run the one-click installer:
- **macOS / Linux:** `bash run.sh`
- **Windows:** `run.bat`

Open `http://localhost:5000` in your browser.

---

## Using Exported Project Bundles

1. Export a **Project Bundle (`.zip`)** from the web studio.
2. Unzip it into `projects/<episode_name>/` so `manifest.json` and `assets/` sit together.
3. Validate & render directly via CLI or in the Flask **Batch / Import** tab:

```bash
python -c "from pathlib import Path; from pipeline.orchestrator import PipelineOrchestrator; print(PipelineOrchestrator().run_from_manifest_path(Path('projects/ep01/manifest.json')))"
```

---

## API Key Setup

1. Copy `.env.example` to `.env`.
2. Add your `GEMINI_API_KEY` from Google AI Studio.
3. Optionally add `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. If omitted, the pipeline uses **Edge-TTS** (`en-US-AriaNeural`) automatically at zero cost.
4. Never commit `.env` to version control (`.gitignore` already excludes `.env`).

---

## Running Tests

```bash
pytest -v
```

All tests use mocked external APIs and include a **Secret Scrub Test** verifying no API keys are present in the repository.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ffmpeg not found` | Missing system ffmpeg binary | Install ffmpeg (`brew install ffmpeg` / `apt install ffmpeg`) or verify `imageio-ffmpeg` |
| `401 Unauthorized` on ElevenLabs | Invalid or missing `ELEVENLABS_API_KEY` | Check `.env`; pipeline automatically falls back to Edge-TTS |
| Whisper slow on first run | Downloading `base` model weights | Wait ~30s on first transcription; cached afterwards |
| `jsonschema` validation error | Bundle exported with incompatible schema | Re-export Project Bundle from the matching studio version |
| Port 5000 already in use | AirPlay Receiver or another Flask process | Set `FLASK_PORT=5050` in `.env` |
