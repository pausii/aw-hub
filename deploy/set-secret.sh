#!/usr/bin/env bash
# Ganti satu nilai rahasia di .env server (mis. token bot Telegram), lalu restart app.
# Nilai diketik di terminal (tanpa echo) — tidak lewat argumen, riwayat shell, atau chat.
#
#   ssh -t root@<server> 'bash /opt/aw-hub/deploy/set-secret.sh AW_HUB_TELEGRAM_BOT_TOKEN'
set -euo pipefail
cd "$(dirname "$0")/.."
KEY="${1:-}"
case "$KEY" in
  AW_HUB_TELEGRAM_BOT_TOKEN|AW_HUB_TELEGRAM_CHAT_ID|AW_HUB_INGEST_TOKEN|AW_HUB_SECRET) ;;
  *) echo "Pakai: $0 <AW_HUB_TELEGRAM_BOT_TOKEN|AW_HUB_TELEGRAM_CHAT_ID|AW_HUB_INGEST_TOKEN|AW_HUB_SECRET>" >&2; exit 1 ;;
esac
[ -f .env ] || { echo ".env tidak ditemukan di $(pwd)" >&2; exit 1; }
read -rsp "Nilai baru untuk $KEY: " VAL; echo
[ -n "$VAL" ] || { echo "Nilai kosong, batal." >&2; exit 1; }
case "$VAL" in *[[:space:]\'\"\$]*) echo "Nilai tidak boleh berisi spasi, kutip, atau \$." >&2; exit 1 ;; esac

cp -p .env ".env.bak-$(date +%Y%m%d%H%M%S)"
KEY="$KEY" VAL="$VAL" python3 - <<'PY'
import os
p, k, v = ".env", os.environ["KEY"], os.environ["VAL"]
lines = open(p).read().splitlines()
out, done = [], False
for ln in lines:
    if ln.split("=", 1)[0] == k:
        out.append(f"{k}={v}"); done = True
    else:
        out.append(ln)
if not done:
    out.append(f"{k}={v}")
open(p, "w").write("\n".join(out) + "\n")
PY
unset VAL
chmod 600 .env
docker compose up -d >/dev/null 2>&1
sleep 5
docker compose ps --format '{{.Name}} {{.Status}}'
echo "$KEY diperbarui."
