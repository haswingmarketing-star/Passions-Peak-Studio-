# Passions Peak Studio & Python Creator Kit

Dual-delivery micro-drama production studio:
1. **Live Web Studio** (`Node.js` + `Express` + `React` + `ffmpeg` + `@google/genai` + `ElevenLabs` / Edge-TTS mapping)
2. **Standalone Python Creator Kit** (`/python-kit/` — `Flask 3.x` + `HTMX` + `Alpine.js` + `MoviePy` + `ffmpeg` + `Whisper` + `Edge-TTS` / `ElevenLabs` + `pytest`)

## Security & API Keys (`.env` Setup)

- **Zero API keys are stored in this repository.**
- Both `.env` and `python-kit/.env` are strictly ignored by `.gitignore` (`.env*`, `!.env.example`).
- Runtime user data (`data/`, `output/`, `logs/`, `static/uploads/`) is also gitignored.

After cloning or pulling onto your local Linux terminal:

```bash
# 1. Create your local gitignored .env from the template
cp .env.example .env

# 2. Add your API keys inside .env (never commit this file)
# GEMINI_API_KEY="your_gemini_api_key"
# ELEVENLABS_API_KEY="your_optional_elevenlabs_api_key"
```

Verify `.env` is ignored before pushing any future changes:

```bash
git status --ignored
```

## Running Locally on Linux

### Option A: Full-Stack Web Studio (Port 3000)

Requires Node.js 20+ and `ffmpeg` installed on your system:

```bash
npm install
npm run dev
# Open http://localhost:3000
```

For production build:

```bash
npm run build
npm start
```

### Option B: Standalone Python Creator Kit (Port 5000)

Requires Python 3.10+ and `ffmpeg`:

```bash
cd python-kit
cp .env.example .env
# Add GEMINI_API_KEY (and optional ELEVENLABS_API_KEY) to python-kit/.env
chmod +x run.sh
./run.sh
# Open http://localhost:5000
```

Run the Python test suite (including the Secret Scrub Gate):

```bash
cd python-kit
pytest
```
