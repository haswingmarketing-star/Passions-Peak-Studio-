"""Flask entrypoint for the standalone Passions Peak Python Creator Kit."""

from __future__ import annotations

from flask import Flask

from config import configure_logging, settings
from routes import bp


def create_app() -> Flask:
    """Application factory creating configured directories and registering routes."""
    settings.ensure_directories()
    configure_logging(settings.logs_dir)
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = 250 * 1024 * 1024  # 250 MB upload cap
    app.register_blueprint(bp)
    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=settings.flask_port, debug=False, threaded=True)
