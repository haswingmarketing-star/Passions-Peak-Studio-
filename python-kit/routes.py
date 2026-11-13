"""Flask routes and SSE job manager for the standalone Python Creator Kit UI."""

from __future__ import annotations

import json
import queue
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, Response, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from config import settings
from pipeline.batch_processor import BatchProcessor
from pipeline.captioner import Captioner
from pipeline.image_generator import ImageGenerator
from pipeline.models import (
    CaptionStyle,
    PipelineError,
    RenderJob,
    RenderManifestV1,
    Scene,
    Script,
    WatermarkConfig,
)
from pipeline.orchestrator import PipelineOrchestrator
from pipeline.script_generator import ScriptGenerator
from pipeline.tts_engine import TOP_EDGE_VOICES, TTSEngine

bp = Blueprint("studio", __name__)

_STATE_LOCK = threading.Lock()
_JOB_QUEUES: Dict[str, "queue.Queue[str]"] = {}
_JOB_STATUS: Dict[str, Dict[str, Any]] = {}
_STUDIO_STATE: Dict[str, Any] = {
    "output_profile": "9x16",
    "tts_engine": "edge_tts",
    "edge_voice": settings.edge_tts_voice,
    "elevenlabs_voice_id": settings.elevenlabs_voice_id,
    "script": None,
    "voiceover_url": None,
    "srt_content": "",
    "bgm_path": None,
    "watermark_path": None,
    "watermark_opacity": settings.watermark_opacity,
    "watermark_position": "top_right",
    "caption_font_size": 44,
    "caption_position_y": 84,
    "bgm_volume": 0.32,
    "ducking_db": 12.0,
    "last_render_url": None,
    "last_batch_zip": None,
}

ALLOWED_UPLOAD_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".mp3", ".wav", ".ogg", ".json", ".csv", ".zip"}


def _push_job_event(job_id: str, payload: Dict[str, Any]) -> None:
    """Record job state and push SSE frame to subscribers."""
    _JOB_STATUS[job_id] = payload
    q = _JOB_QUEUES.setdefault(job_id, queue.Queue())
    q.put(json.dumps(payload))


@bp.route("/")
def index() -> str:
    """Render tabbed HTMX + Alpine studio shell."""
    return render_template(
        "index.html",
        state=_STUDIO_STATE,
        edge_voices=TOP_EDGE_VOICES,
        has_gemini=bool(settings.gemini_api_key),
        has_elevenlabs=bool(settings.elevenlabs_api_key),
    )


@bp.route("/api/state", methods=["GET"])
def get_state() -> Response:
    """Return current server-side session state (no secrets)."""
    with _STATE_LOCK:
        return jsonify(_STUDIO_STATE)


@bp.route("/api/generate-script", methods=["POST"])
def generate_script() -> Response | tuple[Response, int]:
    """Generate a structured micro-drama script via Gemini 3.1 Flash Lite."""
    data = request.get_json(silent=True) or request.form.to_dict()
    genre = str(data.get("genre") or "urban drama")
    tone = str(data.get("tone") or "tense")
    duration = int(data.get("duration") or 30)
    raw_chars = data.get("characters", "Kena, Roberto")
    characters = (
        [c.strip() for c in raw_chars.split(",") if c.strip()]
        if isinstance(raw_chars, str)
        else list(raw_chars)
    )
    extra = str(data.get("extra") or "")

    try:
        gen = ScriptGenerator()
        script = gen.generate(
            genre=genre,
            tone=tone,
            duration=duration,
            characters=characters,
            extra=extra,
        )
        with _STATE_LOCK:
            _STUDIO_STATE["script"] = script.model_dump()
        return jsonify({"ok": True, "script": script.model_dump()})
    except PipelineError as err:
        return jsonify({"ok": False, "error": err.to_dict()}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": {"stage": "script", "message": str(exc)}}), 500


@bp.route("/api/generate-images", methods=["POST"])
def generate_images() -> Response | tuple[Response, int]:
    """Generate scene frames for active script using reference-first image generator."""
    data = request.get_json(silent=True) or {}
    profile = "16x9" if data.get("output_profile") == "16x9" else _STUDIO_STATE["output_profile"]
    ref_paths = [Path(p) for p in data.get("reference_paths", []) if Path(p).is_file()]

    with _STATE_LOCK:
        raw_script = data.get("script") or _STUDIO_STATE.get("script")
    if not raw_script:
        return jsonify({"ok": False, "error": {"stage": "images", "message": "Generate or load a script first."}}), 400

    script = Script.model_validate(raw_script)
    res = (1920, 1080) if profile == "16x9" else (1080, 1920)
    out_dir = settings.output_dir / "active_frames"

    gen = ImageGenerator()
    paths = gen.generate_scene_images(
        scenes=script.scenes,
        out_dir=out_dir,
        resolution=res,
        reference_paths=ref_paths,
    )
    for scene, img_path in zip(script.scenes, paths):
        scene.image_path = str(img_path)

    with _STATE_LOCK:
        _STUDIO_STATE["script"] = script.model_dump()
        _STUDIO_STATE["output_profile"] = profile
    return jsonify({"ok": True, "script": script.model_dump(), "images": [str(p) for p in paths]})


@bp.route("/api/upload", methods=["POST"])
def upload_asset() -> Response | tuple[Response, int]:
    """Upload image, video, audio, watermark, or manifest files into `static/uploads/`."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": {"stage": "upload", "message": "No file field provided."}}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": {"stage": "upload", "message": "Empty filename."}}), 400

    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        return jsonify({"ok": False, "error": {"stage": "upload", "message": f"Unsupported file extension: {ext}"}}), 400

    safe_name = f"{uuid.uuid4().hex[:8]}_{secure_filename(f.filename)}"
    dest = settings.uploads_dir / safe_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    f.save(dest)

    asset_role = request.form.get("role", "scene")
    scene_id_raw = request.form.get("scene_id")
    with _STATE_LOCK:
        if asset_role == "bgm":
            _STUDIO_STATE["bgm_path"] = str(dest)
        elif asset_role == "watermark":
            _STUDIO_STATE["watermark_path"] = str(dest)
        elif asset_role == "scene" and scene_id_raw and _STUDIO_STATE.get("script"):
            sid = int(scene_id_raw)
            for s in _STUDIO_STATE["script"]["scenes"]:
                if s["id"] == sid:
                    s["image_path"] = str(dest)

    return jsonify({"ok": True, "path": str(dest), "url": f"/static/uploads/{safe_name}"})


@bp.route("/api/import-bundle", methods=["POST"])
def import_bundle() -> Response | tuple[Response, int]:
    """Import and render a Project Bundle `.zip` exported by the Passions Peak Web Studio."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": {"stage": "bundle", "message": "Upload a Project Bundle .zip file."}}), 400

    f = request.files["file"]
    bundle_id = uuid.uuid4().hex[:8]
    extract_dir = settings.projects_dir / f"bundle_{bundle_id}"
    extract_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp_zip:
        f.save(tmp_zip.name)
        with zipfile.ZipFile(tmp_zip.name, "r") as zf:
            zf.extractall(extract_dir)
        Path(tmp_zip.name).unlink(missing_ok=True)

    manifest_path = extract_dir / "manifest.json"
    schema_path = extract_dir / "manifest.schema.json"
    if not manifest_path.is_file():
        return jsonify({"ok": False, "error": {"stage": "bundle", "message": "manifest.json not found inside ZIP."}}), 400

    manifest = RenderManifestV1.load_and_validate(manifest_path, schema_path=schema_path if schema_path.is_file() else None)
    scenes: List[Scene] = []
    for idx, rs in enumerate(manifest.scenes, start=1):
        frame_id = rs.get("frameAssetId")
        frame_p = str(extract_dir / "assets" / frame_id) if frame_id else None
        scenes.append(
            Scene(
                id=int(rs.get("id", idx)),
                beat=rs.get("beat", "tension"),
                duration_seconds=max(1.0, float(rs.get("durationMs", 5000)) / 1000.0),
                speaker=str(rs.get("speaker", "Narrator")),
                narration=str(rs.get("narration", "")),
                visual_direction=str(rs.get("captionText", "")),
                transition_out=rs.get("transitionOut", "cut"),
                image_path=frame_p,
            )
        )

    script = Script(
        title=manifest.title,
        duration_seconds=max(5, int(sum(s.duration_seconds for s in scenes))),
        hook=scenes[0].narration if scenes else manifest.title,
        scenes=scenes,
        total_scenes=len(scenes),
    )
    with _STATE_LOCK:
        _STUDIO_STATE["script"] = script.model_dump()
        _STUDIO_STATE["output_profile"] = manifest.outputProfile
        _STUDIO_STATE["srt_content"] = manifest.srtContent
        bgm_id = (manifest.bgmConfig or {}).get("masterBgmAssetId")
        if bgm_id and (extract_dir / "assets" / bgm_id).is_file():
            _STUDIO_STATE["bgm_path"] = str(extract_dir / "assets" / bgm_id)

    return jsonify({"ok": True, "manifest_title": manifest.title, "scenes_loaded": len(scenes)})


@bp.route("/api/tts", methods=["POST"])
def synthesize_tts() -> Response | tuple[Response, int]:
    """Synthesize episode voiceover WAV using Edge-TTS or ElevenLabs."""
    data = request.get_json(silent=True) or {}
    engine = "elevenlabs" if data.get("tts_engine") == "elevenlabs" else "edge_tts"
    edge_voice = str(data.get("edge_voice") or _STUDIO_STATE["edge_voice"])
    el_voice = str(data.get("elevenlabs_voice_id") or _STUDIO_STATE["elevenlabs_voice_id"])

    with _STATE_LOCK:
        raw_script = data.get("script") or _STUDIO_STATE.get("script")
    if not raw_script:
        return jsonify({"ok": False, "error": {"stage": "tts", "message": "Generate or import a script first."}}), 400

    script = Script.model_validate(raw_script)
    out_wav = settings.output_dir / "active_voiceover.wav"
    tts = TTSEngine()
    try:
        _, warnings = tts.synthesize_scenes(
            scenes=script.scenes,
            out_wav=out_wav,
            engine=engine,
            edge_voice=edge_voice,
            elevenlabs_voice_id=el_voice,
        )
        with _STATE_LOCK:
            _STUDIO_STATE["tts_engine"] = engine
            _STUDIO_STATE["edge_voice"] = edge_voice
            _STUDIO_STATE["elevenlabs_voice_id"] = el_voice
            _STUDIO_STATE["voiceover_url"] = "/api/download/active_voiceover.wav"
        return jsonify({"ok": True, "audio_url": "/api/download/active_voiceover.wav", "warnings": warnings})
    except PipelineError as err:
        return jsonify({"ok": False, "error": err.to_dict()}), 400


@bp.route("/api/captions", methods=["POST"])
def generate_captions() -> Response | tuple[Response, int]:
    """Transcribe active voiceover WAV into SRT captions using local Whisper."""
    vo_wav = settings.output_dir / "active_voiceover.wav"
    if not vo_wav.is_file():
        return jsonify({"ok": False, "error": {"stage": "captions", "message": "Synthesize voiceover first."}}), 400

    out_srt = settings.output_dir / "active_captions.srt"
    cap = Captioner()
    try:
        _, cues = cap.transcribe_to_srt(vo_wav, out_srt)
        srt_text = out_srt.read_text(encoding="utf-8")
        with _STATE_LOCK:
            _STUDIO_STATE["srt_content"] = srt_text
        return jsonify({"ok": True, "srt": srt_text, "cue_count": len(cues)})
    except PipelineError as err:
        return jsonify({"ok": False, "error": err.to_dict()}), 400


@bp.route("/api/preview", methods=["POST"])
def render_preview() -> Response | tuple[Response, int]:
    """Start a fast 3-second test render job."""
    return _enqueue_render(preview_seconds=3.0)


@bp.route("/api/render", methods=["POST"])
def render_full() -> Response | tuple[Response, int]:
    """Start a full MP4 render job."""
    return _enqueue_render(preview_seconds=None)


def _enqueue_render(preview_seconds: float | None) -> Response | tuple[Response, int]:
    data = request.get_json(silent=True) or {}
    with _STATE_LOCK:
        raw_script = data.get("script") or _STUDIO_STATE.get("script")
        profile = "16x9" if data.get("output_profile") == "16x9" else _STUDIO_STATE["output_profile"]
        tts_engine = "elevenlabs" if data.get("tts_engine") == "elevenlabs" else _STUDIO_STATE["tts_engine"]
        edge_voice = str(data.get("edge_voice") or _STUDIO_STATE["edge_voice"])
        el_voice = str(data.get("elevenlabs_voice_id") or _STUDIO_STATE["elevenlabs_voice_id"])
        bgm_path = data.get("bgm_path") or _STUDIO_STATE.get("bgm_path")
        wm_path = _STUDIO_STATE.get("watermark_path")
        wm_opacity = float(data.get("watermark_opacity", _STUDIO_STATE["watermark_opacity"]))
        wm_pos = str(data.get("watermark_position", _STUDIO_STATE["watermark_position"]))
        cap_size = int(data.get("caption_font_size", _STUDIO_STATE["caption_font_size"]))
        cap_y = int(data.get("caption_position_y", _STUDIO_STATE["caption_position_y"]))
        bgm_vol = float(data.get("bgm_volume", _STUDIO_STATE["bgm_volume"]))
        duck_db = float(data.get("ducking_db", _STUDIO_STATE["ducking_db"]))

    script = Script.model_validate(raw_script) if raw_script else None
    job_id = f"render_{uuid.uuid4().hex[:8]}"
    job = RenderJob(
        job_id=job_id,
        genre=str(data.get("genre") or "urban drama"),
        tone=str(data.get("tone") or "tense"),
        duration=int(data.get("duration") or 30),
        output_profile=profile,
        tts_engine=tts_engine,
        edge_voice=edge_voice,
        elevenlabs_voice_id=el_voice,
        bgm_path=bgm_path,
        bgm_volume=bgm_vol,
        ducking_db=duck_db,
        watermark=WatermarkConfig(path=wm_path, opacity=wm_opacity, position=wm_pos),
        caption_style=CaptionStyle(font_size=cap_size, position_y=cap_y),
        script=script,
    )

    _push_job_event(job_id, {"job_id": job_id, "status": "queued", "progress": 0, "message": "Queued render..."})

    def _worker() -> None:
        orch = PipelineOrchestrator()
        res = orch.run(
            job,
            preview_seconds=preview_seconds,
            on_progress=lambda pct, msg: _push_job_event(
                job_id, {"job_id": job_id, "status": "running", "progress": pct, "message": msg}
            ),
        )
        if res.status == "completed" and res.video_path:
            rel_name = Path(res.video_path).relative_to(settings.output_dir).as_posix()
            url = f"/api/download/{rel_name}"
            with _STATE_LOCK:
                _STUDIO_STATE["last_render_url"] = url
            _push_job_event(
                job_id,
                {
                    "job_id": job_id,
                    "status": "completed",
                    "progress": 100,
                    "message": "Render finished.",
                    "video_url": url,
                    "warnings": res.warnings,
                },
            )
        else:
            _push_job_event(
                job_id,
                {
                    "job_id": job_id,
                    "status": "failed",
                    "progress": 0,
                    "message": (res.error or {}).get("message", "Render failed."),
                    "error": res.error,
                },
            )

    threading.Thread(target=_worker, daemon=True).start()
    return jsonify({"ok": True, "job_id": job_id})


@bp.route("/api/batch", methods=["POST"])
def run_batch() -> Response | tuple[Response, int]:
    """Accept a JSON/CSV batch manifest upload and render N videos concurrently."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": {"stage": "batch", "message": "Upload a .json or .csv manifest."}}), 400

    f = request.files["file"]
    ext = Path(f.filename or "").suffix.lower()
    if ext not in {".json", ".csv"}:
        return jsonify({"ok": False, "error": {"stage": "batch", "message": "Manifest must be .json or .csv."}}), 400

    batch_id = uuid.uuid4().hex[:8]
    manifest_dest = settings.uploads_dir / f"batch_{batch_id}{ext}"
    manifest_dest.parent.mkdir(parents=True, exist_ok=True)
    f.save(manifest_dest)

    proc = BatchProcessor()
    jobs = proc.load_manifest(manifest_dest)
    summary = proc.run_batch(jobs, batch_id=batch_id)
    with _STATE_LOCK:
        _STUDIO_STATE["last_batch_zip"] = f"/api/download-batch/{batch_id}"
    return jsonify({"ok": True, **summary, "zip_url": f"/api/download-batch/{batch_id}"})


@bp.route("/api/progress/<job_id>", methods=["GET"])
def stream_progress(job_id: str) -> Response:
    """SSE endpoint streaming progress events for a render job."""

    def _events():
        q = _JOB_QUEUES.setdefault(job_id, queue.Queue())
        if job_id in _JOB_STATUS:
            yield f"data: {json.dumps(_JOB_STATUS[job_id])}\n\n"
        while True:
            try:
                payload = q.get(timeout=15)
                yield f"data: {payload}\n\n"
                parsed = json.loads(payload)
                if parsed.get("status") in ("completed", "failed"):
                    break
            except queue.Empty:
                yield ": keepalive\n\n"
                time.sleep(0.05)

    return Response(_events(), mimetype="text/event-stream")


@bp.route("/api/download/<path:filename>", methods=["GET"])
def download_output(filename: str) -> Response:
    """Serve rendered MP4, SRT, or WAV files from output directory."""
    return send_from_directory(settings.output_dir.resolve(), filename, as_attachment=False)


@bp.route("/api/download-batch/<batch_id>", methods=["GET"])
def download_batch_zip(batch_id: str) -> Response:
    """Download completed batch ZIP archive."""
    safe_id = secure_filename(batch_id)
    return send_from_directory(settings.output_dir.resolve(), f"batch_{safe_id}.zip", as_attachment=True)
