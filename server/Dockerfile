# Build context = root repo (lihat docker-compose.yml).

# ---- tahap 1: build frontend Astro → /web/dist
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- tahap 2: server Python (tanpa Node di image akhir)
FROM python:3.12-slim

WORKDIR /app
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/*.py ./
COPY --from=web /web/dist ./static
# jalan sebagai user non-root; folder data di host harus dimiliki uid ini (chown 10001 data/)
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin awhub
USER 10001

ENV AW_HUB_DB=/data/aw-hub.db \
    AW_HUB_CATEGORIES=/config/categories.json \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
