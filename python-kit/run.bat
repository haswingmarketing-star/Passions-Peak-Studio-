@echo off
setlocal enabledelayedexpansion

if not exist venv (
  echo Creating Python virtual environment...
  python -m venv venv
)

call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo Created .env from .env.example. Add your API keys before generating.
  )
)

echo Launching Vertical Video Pipeline on http://localhost:5000
python app.py
