# Aeris Core API — container image (TDD §13: FastAPI / Python 3.12).
#
# Free-tier note: this image runs the single FastAPI web service
# (uvicorn target: core_api.app.main:app). Ingestion is webhook-driven
# (HiveMQ webhook -> HTTP), so NO persistent MQTT subscriber runs here —
# a Render free web service sleeps on idle and cannot hold a long-lived
# MQTT connection (see docs/DECISIONS.md).
#
# Build context is the repo ROOT (see infra/render.yaml dockerContext: .).

FROM python:3.12-slim AS runtime

# Keep the runtime lean and predictable.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install runtime deps first for better layer caching (requirements.txt lives at repo root).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application source (from the repo-root build context).
COPY . .

# Run as a non-root user (defense in depth; nothing here needs root).
RUN useradd --create-home --uid 10001 aeris \
    && chown -R aeris:aeris /app
USER aeris

# Render injects $PORT at runtime; default to 8000 for local `docker run`.
ENV PORT=8000
EXPOSE 8000

# Shell form so ${PORT} is expanded at container start.
CMD ["sh", "-c", "uvicorn core_api.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
