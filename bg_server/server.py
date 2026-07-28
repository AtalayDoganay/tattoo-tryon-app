"""Local development entrypoint.

    cd bg_server && python server.py

Production does NOT use this file. Flask's built-in server is single-threaded,
has no request limits and is explicitly not designed to face the internet; the
container runs Gunicorn against wsgi.py instead (see Dockerfile / railway.json).
"""

import os

from app import create_app
from config import ConfigError, config


def main() -> None:
    try:
        app = create_app()
    except ConfigError as exc:
        raise SystemExit(f"Configuration error:\n{exc}") from exc

    if config.is_production:
        raise SystemExit(
            "Refusing to start the development server with APP_ENV=production. "
            "Use: gunicorn --bind 0.0.0.0:$PORT wsgi:app"
        )

    # Loopback by default so a dev server on a café network is not reachable by
    # everyone on that network. Set DEV_HOST=0.0.0.0 to test from a phone.
    host = os.environ.get("DEV_HOST", "127.0.0.1")
    print(f"Background removal server (development) on {host}:{config.port}")
    # debug=False always: the Werkzeug debugger exposes an interactive console.
    app.run(host=host, port=config.port, debug=False)


if __name__ == "__main__":
    main()
