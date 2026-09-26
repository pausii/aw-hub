#!/usr/bin/env bash
# Ganti username & password dashboard di server (disimpan sebagai hash bcrypt), lalu restart app.
# Password diketik di terminal (tanpa echo) — tidak pernah lewat argumen, riwayat shell, atau chat.
#
#   ssh -t root@<server> 'bash /opt/aw-hub/deploy/set-password.sh'
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env tidak ditemukan di $(pwd)" >&2; exit 1; }

read -rp "Username dashboard [$(grep -oP '^AW_HUB_DASH_USER=\K.*' .env || echo admin)]: " USER_NEW
read -rsp "Password baru (min. 12 karakter): " P1; echo
read -rsp "Ulangi password: " P2; echo
[ "$P1" = "$P2" ] || { echo "Password tidak sama." >&2; exit 1; }
[ "${#P1}" -ge 12 ] || { echo "Password terlalu pendek (min. 12 karakter)." >&2; exit 1; }

HASH=$(printf '%s' "$P1" | docker compose exec -T app python hashpw.py)
unset P1 P2
case "$HASH" in \$2b\$*) ;; *) echo "Gagal membuat hash." >&2; exit 1;; esac

cp -p .env ".env.bak-$(date +%Y%m%d%H%M%S)"
HASH="$HASH" USER_NEW="$USER_NEW" python3 - <<'PY'
import os
p = ".env"; lines = open(p).read().splitlines()
new = {"AW_HUB_DASH_PASSWORD": "'" + os.environ["HASH"] + "'"}   # kutip tunggal: "$" jangan diinterpolasi Compose
if os.environ["USER_NEW"].strip():
    new["AW_HUB_DASH_USER"] = os.environ["USER_NEW"].strip()
out = []
for ln in lines:
    k = ln.split("=", 1)[0]
    out.append(f"{k}={new.pop(k)}" if k in new else ln)
out += [f"{k}={v}" for k, v in new.items()]
open(p, "w").write("\n".join(out) + "\n")
PY
chmod 600 .env
docker compose up -d >/dev/null 2>&1
sleep 5
docker compose ps --format '{{.Name}} {{.Status}}'
echo "Selesai. Semua sesi lama otomatis keluar; login ulang dengan kredensial baru."
