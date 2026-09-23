# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /web
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    MODEL_OPS_DB=/app/runtime/modelops.db \
    MODEL_OPS_DATA=/app/data
WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt \
    && groupadd --gid 10001 modelops \
    && useradd --uid 10001 --gid modelops --create-home modelops
COPY backend/modelops/ ./backend/modelops/
COPY data/ ./data/
COPY --from=frontend-build /web/dist ./frontend/dist
RUN mkdir -p /app/runtime && chown modelops:modelops /app/runtime
USER modelops
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["uvicorn", "modelops.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
