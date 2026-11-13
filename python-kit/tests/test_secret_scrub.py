"""Secret Scrub Gate test ensuring the Python Creator Kit contains zero hardcoded API keys."""

from __future__ import annotations

import re
from pathlib import Path

SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z\-_]{25,}"),
    re.compile(r"(?:sk_|xi-)[0-9A-Za-z\-_]{20,}"),
    re.compile(r'GEMINI_API_KEY[ \t]*=[ \t]*["\']?(?!YOUR_|MY_|your_|<|[ \t]*$)[A-Za-z0-9\-_]{16,}'),
    re.compile(r'ELEVENLABS_API_KEY[ \t]*=[ \t]*["\']?(?!YOUR_|MY_|your_|<|[ \t]*$)[A-Za-z0-9\-_]{16,}'),
]


def test_no_hardcoded_secrets_in_creator_kit() -> None:
    kit_root = Path(__file__).resolve().parent.parent
    skip_dirs = {"__pycache__", ".pytest_cache", "venv", ".venv", "output", "logs"}

    for path in kit_root.rglob("*"):
        if any(part in skip_dirs for part in path.parts):
            continue
        if not path.is_file():
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            raise AssertionError(f"Unexcluded .env file found in kit: {path}")
        if path.suffix.lower() in {".png", ".jpg", ".mp4", ".wav", ".pyc"}:
            continue

        content = path.read_text(encoding="utf-8", errors="ignore")
        for pat in SECRET_PATTERNS:
            if pat.search(content):
                raise AssertionError(f"Potential secret detected in {path.relative_to(kit_root)}")
