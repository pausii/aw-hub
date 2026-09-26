#!/usr/bin/env bash
# Buat /etc/nginx/snippets/cloudflare-only.conf dari daftar IP resmi Cloudflare,
# lalu reload nginx bila konfigurasi valid. Aman dijalankan ulang (mis. cron bulanan).
set -euo pipefail
OUT=/etc/nginx/snippets/cloudflare-only.conf
TMP=$(mktemp)
{
  echo "# Dibuat oleh update-cloudflare-ips.sh pada $(date -u +%F) — hanya Cloudflare yang boleh akses"
  for v in 4 6; do
    curl -fsS "https://www.cloudflare.com/ips-v$v" | while read -r cidr; do
      [[ "$cidr" =~ ^[0-9a-fA-F:.]+/[0-9]+$ ]] && echo "allow $cidr;"
    done
  done
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  echo "deny all;"
} > "$TMP"
# jangan pasang daftar kosong/rusak (akan mengunci semua akses)
[ "$(grep -c '^allow' "$TMP")" -ge 10 ] || { echo "Daftar IP Cloudflare tidak valid, batal." >&2; rm -f "$TMP"; exit 1; }
mkdir -p "$(dirname "$OUT")"
[ -f "$OUT" ] && cp "$OUT" "$OUT.bak"
mv "$TMP" "$OUT" && chmod 644 "$OUT"
if nginx -t 2>/dev/null; then
  systemctl reload nginx && echo "OK: $(grep -c '^allow' "$OUT") rentang diizinkan, nginx di-reload."
else
  echo "nginx -t gagal, kembalikan versi lama." >&2
  [ -f "$OUT.bak" ] && mv "$OUT.bak" "$OUT"
  exit 1
fi
