#!/usr/bin/env bash
set -euo pipefail

if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv venv
fi

# shellcheck disable=SC1091
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add your GEMINI_API_KEY (and optional ELEVENLABS_API_KEY) before generating."
fi

echo "Launching Vertical Video Pipeline on http://localhost:${FLASK_PORT:-5000}"
python app.py
