"""WSGI entrypoint for production servers.

Gunicorn loads this module:

    gunicorn --bind 0.0.0.0:$PORT wsgi:app
"""

from app import create_app

app = create_app()
