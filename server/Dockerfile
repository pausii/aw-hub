FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
COPY static ./static
# jalan sebagai user non-root; folder data di host harus dimiliki uid ini (chown 10001 data/)
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin awhub
USER 10001

ENV AW_HUB_DB=/data/aw-hub.db \
    AW_HUB_CATEGORIES=/config/categories.json \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
