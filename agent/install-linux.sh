#!/usr/bin/env bash
# Pasang AW Hub agent sebagai systemd user timer (tiap 15 menit, jalan saat login).
#
#   ./install-linux.sh --server https://aw.contoh.com --token xxxxx --device Pribadi [--hide-title "regex"]
#   ./install-linux.sh --uninstall
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/aw_hub_agent.py"
CONFIG="$HERE/config.json"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NAME="aw-hub-agent"
SERVER="" TOKEN="" DEVICE="$(hostname)" HIDE="" INTERVAL=15 UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --device) DEVICE="$2"; shift 2 ;;
    --hide-title) HIDE="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Opsi tidak dikenal: $1" >&2; exit 1 ;;
  esac
done

if [ "$UNINSTALL" = 1 ]; then
  systemctl --user disable --now "$NAME.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$NAME.timer" "$UNIT_DIR/$NAME.service"
  systemctl --user daemon-reload
  echo "Timer $NAME dihapus."
  exit 0
fi

command -v python3 >/dev/null || { echo "python3 tidak ditemukan (apt install python3)." >&2; exit 1; }

# Cek ActivityWatch lokal & bucket window/afk
if ! BUCKETS="$(curl -fsS http://localhost:5600/api/0/buckets/ 2>/dev/null)"; then
  echo "PERINGATAN: ActivityWatch tidak terjangkau di localhost:5600. Pastikan sudah berjalan." >&2
else
  for kind in window afk; do
    grep -q "\"aw-watcher-${kind}_" <<<"$BUCKETS" \
      || echo "PERINGATAN: bucket aw-watcher-${kind} tidak ditemukan." >&2
  done
fi
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  echo "CATATAN: sesi Wayland — aw-watcher-window bawaan tidak mencatat window di Wayland." >&2
  echo "         Pakai awatcher (github.com/2e3s/awatcher) atau sesi Xorg." >&2
fi

if [ ! -f "$CONFIG" ]; then
  [ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "config.json belum ada: isi --server dan --token." >&2; exit 1; }
  SERVER="$SERVER" TOKEN="$TOKEN" DEVICE="$DEVICE" HIDE="$HIDE" python3 - "$CONFIG" <<'EOF'
import json, os, sys
json.dump({"server_url": os.environ["SERVER"], "token": os.environ["TOKEN"],
           "device_name": os.environ["DEVICE"], "aw_url": "http://localhost:5600",
           "hide_title_regex": os.environ["HIDE"]}, open(sys.argv[1], "w"), indent=2)
EOF
  chmod 600 "$CONFIG"
  echo "config.json dibuat."
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$NAME.service" <<EOF
[Unit]
Description=AW Hub agent (kirim data ActivityWatch)

[Service]
Type=oneshot
ExecStart=$(command -v python3) "$SCRIPT" -c "$CONFIG"
EOF

cat > "$UNIT_DIR/$NAME.timer" <<EOF
[Unit]
Description=Jalankan AW Hub agent tiap $INTERVAL menit

[Timer]
OnCalendar=*:0/$INTERVAL
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$NAME.timer"
echo "Timer $NAME terpasang (tiap $INTERVAL menit selama login)."
echo "Menjalankan sinkron awal (seluruh riwayat, bisa beberapa menit)..."
python3 "$SCRIPT" -c "$CONFIG" && echo "Selesai. Log: $HERE/aw-hub-agent.log" \
  || echo "Sinkron awal gagal — cek $HERE/aw-hub-agent.log (timer akan mencoba lagi)." >&2
