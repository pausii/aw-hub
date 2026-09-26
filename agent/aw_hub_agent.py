#!/usr/bin/env python3
"""AW Hub agent — kirim aktivitas ActivityWatch lokal ke server AW Hub.

Dijalankan terjadwal (mis. tiap 15 menit). Setiap run:
  1. ambil event window yang beririsan dengan status "not-afk" dari aw-server lokal
     (query yang sama dengan yang dipakai web UI ActivityWatch),
  2. kirim per potongan 1 hari UTC ke server; server mengganti data potongan itu
     (replace), jadi aman diulang,
  3. simpan progres di file state. Kalau server tidak terjangkau, progres tidak
     maju dan akan dicoba lagi pada run berikutnya.

Hanya memakai standard library.
"""
import argparse
import json
import logging
import re
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
MERGE_GAP = 1.0  # detik; event berurutan dengan app+title sama digabung
log = logging.getLogger("aw-hub-agent")


def http_json(url, payload=None, headers=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    # UA default "Python-urllib/x" diblokir Cloudflare Browser Integrity Check (error 1010)
    req.add_header("User-Agent", f"aw-hub-agent/{VERSION}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def utc_day_start(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


def find_buckets(aw_url, hostname):
    buckets = http_json(f"{aw_url}/api/0/buckets/")

    def pick(prefix, btype):
        exact = f"{prefix}_{hostname}"
        if exact in buckets:
            return buckets[exact]
        cands = [b for b in buckets.values() if b.get("type") == btype and b.get("hostname") == hostname]
        return cands[0] if cands else None

    win, afk = pick("aw-watcher-window", "currentwindow"), pick("aw-watcher-afk", "afkstatus")
    if not win or not afk:
        raise SystemExit(f"Bucket window/afk untuk host '{hostname}' tidak ditemukan di {aw_url}")
    return win, afk


def query_active_window(aw_url, win_id, afk_id, a, b, hide_title=None):
    q = [
        f'afk = query_bucket("{afk_id}");',
        f'win = query_bucket("{win_id}");',
        'win = filter_period_intersect(win, filter_keyvals(afk, "status", ["not-afk"]));',
        "RETURN = win;",
    ]
    res = http_json(f"{aw_url}/api/0/query/", {"timeperiods": [f"{iso(a)}/{iso(b)}"], "query": q}, timeout=300)
    out = []
    for e in sorted(res[0], key=lambda e: e["timestamp"]):
        if e["duration"] <= 0:
            continue
        s = max(parse_ts(e["timestamp"]), a)
        t = min(s + e["duration"], b)
        if t <= s:
            continue
        app = str(e["data"].get("app", ""))[:500]
        title = str(e["data"].get("title", ""))[:2000]
        if hide_title and (hide_title.search(app) or hide_title.search(title)):
            title = "(disembunyikan)"
        prev = out[-1] if out else None
        if prev and prev["app"] == app and prev["title"] == title and s - prev["end"] <= MERGE_GAP:
            prev["end"] = max(prev["end"], t)
        else:
            out.append({"start": s, "end": t, "app": app, "title": title})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-c", "--config", default=str(HERE / "config.json"))
    ap.add_argument("--full", action="store_true", help="kirim ulang seluruh riwayat")
    ap.add_argument("--days", type=int, help="kirim ulang N hari terakhir")
    args = ap.parse_args()

    # utf-8-sig: toleran BOM (Out-File -Encoding utf8 di PowerShell 5.1 menambahkannya)
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    state_path = Path(cfg.get("state_file") or HERE / "state.json")
    log_path = Path(cfg.get("log_file") or HERE / "aw-hub-agent.log")
    handlers = [RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=2, encoding="utf-8")]
    if sys.stdout and sys.stdout.isatty():
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers)

    aw_url = cfg.get("aw_url", "http://localhost:5600").rstrip("/")
    server = cfg["server_url"].rstrip("/")
    auth = {"Authorization": f"Bearer {cfg['token']}"}
    # judul window dari app/judul yang cocok tidak dikirim ke server (mis. data kantor)
    hide_title = re.compile(cfg["hide_title_regex"], re.I) if cfg.get("hide_title_regex") else None

    try:
        info = http_json(f"{aw_url}/api/0/info")
    except (urllib.error.URLError, OSError) as e:
        log.error("ActivityWatch lokal tidak bisa diakses (%s): %s", aw_url, e)
        return 1
    hostname = info.get("hostname") or socket.gethostname()
    device = cfg.get("device_name") or hostname
    win, afk = find_buckets(aw_url, hostname)

    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    now = datetime.now(timezone.utc).timestamp()
    today = utc_day_start(now)
    if args.full or "synced_until" not in state:
        start = utc_day_start(parse_ts(win["created"]))
    elif args.days:
        start = today - args.days * 86400
    else:
        # ulangi 1 hari sebelumnya: event heartbeat terakhir bisa masih memanjang
        start = state["synced_until"] - 86400

    day = start
    sent = 0
    while day <= today:
        a, b = day, day + 86400
        try:
            events = query_active_window(aw_url, win["id"], afk["id"], a, b, hide_title)
            res = http_json(
                f"{server}/api/ingest",
                {"device": device, "hostname": hostname, "agent_version": VERSION,
                 "period_start": a, "period_end": b, "events": events},
                headers=auth, timeout=120,
            )
        except urllib.error.HTTPError as e:
            log.error("Server menolak %s: HTTP %s %s", iso(a)[:10], e.code, e.read()[:300])
            return 2
        except (urllib.error.URLError, OSError) as e:
            log.warning("Gagal kirim %s, dicoba lagi run berikutnya: %s", iso(a)[:10], e)
            return 3
        sent += res.get("stored", 0)
        # progres = awal potongan hari ini (hari ini belum selesai, akan dikirim ulang)
        state["synced_until"] = min(b, today)
        state["last_run"] = now
        state_path.write_text(json.dumps(state))
        day = b

    log.info("OK device=%s dari %s, %d event terkirim", device, iso(start)[:10], sent)
    return 0


if __name__ == "__main__":
    sys.exit(main())
