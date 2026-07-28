# Minimal, currently-supported base. `-slim` keeps the attack surface small
# compared with the full image (no compilers, no shell tooling we do not need).
FROM python:3.12-slim

# Never write .pyc files, never buffer stdout (so Railway shows logs live).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Where rembg caches the u2net model. Must be writable by the app user.
    U2NET_HOME=/opt/models

WORKDIR /app

# Runtime shared libraries needed by onnxruntime / Pillow / scikit-image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libglib2.0-0 \
      libsm6 \
      libxext6 \
      libxrender1 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged account. A container process running as root shares the host
# kernel; any RCE in an image decoder would start with uid 0 inside the
# namespace, which is a far better position for an attacker than uid 10001.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
    && mkdir -p /opt/models \
    && chown -R appuser:appuser /opt/models

# Dependencies first so application edits do not invalidate this layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so the first request is not a cold
# 170 MB fetch. Done as appuser so the cache is owned by the runtime user.
USER appuser
RUN python -c "from rembg import new_session; new_session('u2net')"

# Application code last. .railwayignore / .dockerignore keep .env, tests and
# local caches out of the build context, so no secret is baked into a layer.
COPY --chown=appuser:appuser . .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,os,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/health', timeout=4).status==200 else 1)"

# Gunicorn, not Flask's development server.
#   --workers 2            image work is CPU-bound; keep memory predictable.
#   --threads 2            lets a worker accept while another is decoding.
#   --timeout 60           hard backstop that recycles a worker stuck on a
#                          pathological image (imaging.py has a softer 25 s cap).
#   --max-requests         periodic recycling bounds any slow memory growth in
#                          the native ONNX/Pillow layers.
#   --access-logfile -     to stdout; the format below deliberately omits the
#                          request body, Authorization header and cookies.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8080} \
  --workers 2 --threads 2 --timeout 60 --graceful-timeout 30 \
  --max-requests 200 --max-requests-jitter 50 \
  --access-logfile - --error-logfile - \
  --access-logformat '%(h)s \"%(r)s\" %(s)s %(b)s %(M)sms' \
  wsgi:app"]
