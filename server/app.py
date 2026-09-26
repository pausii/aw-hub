"""AW Hub — penampung data ActivityWatch dari beberapa laptop + dashboard gabungan.

Agent di tiap laptop mengirim event window yang sudah difilter "tidak AFK"
per potongan waktu (replace semantics), server menyimpan ke SQLite dan
menyajikan statistik gabungan.
"""
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("AW_HUB_DB", BASE_DIR / "data" / "aw-hub.db"))
CATEGORIES_PATH = Path(os.environ.get("AW_HUB_CATEGORIES", BASE_DIR.parent / "config" / "categories.json"))
TZ = ZoneInfo(os.environ.get("AW_HUB_TZ", "Asia/Jakarta"))
# Hari dianggap mulai jam ini (sama seperti "startOfDay" ActivityWatch), agar
# pemakaian lewat tengah malam tetap masuk ke hari sebelumnya.
DAY_START_HOUR = int(os.environ.get("AW_HUB_DAY_START_HOUR", "4"))
INGEST_TOKEN = os.environ.get("AW_HUB_INGEST_TOKEN", "")
DASH_USER = os.environ.get("AW_HUB_DASH_USER", "admin")
DASH_PASSWORD = os.environ.get("AW_HUB_DASH_PASSWORD", "")
MAX_RANGE_DAYS = 400
TIMELINE_MERGE_GAP = 60  # detik; segmen app yang sama dengan jeda <= ini digabung di timeline

if not INGEST_TOKEN or not DASH_PASSWORD:
    raise SystemExit("AW_HUB_INGEST_TOKEN dan AW_HUB_DASH_PASSWORD wajib di-set.")

app = FastAPI(title="AW Hub", docs_url=None, redoc_url=None, openapi_url=None)
security = HTTPBasic(realm="AW Hub")
_db_lock = threading.Lock()


# ---------------------------------------------------------------- database

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                device TEXT NOT NULL,
                ts_start REAL NOT NULL,
                ts_end REAL NOT NULL,
                app TEXT NOT NULL,
                title TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_events_start ON events (ts_start);
            CREATE INDEX IF NOT EXISTS ix_events_device_start ON events (device, ts_start);
            CREATE TABLE IF NOT EXISTS devices (
                name TEXT PRIMARY KEY,
                hostname TEXT,
                last_sync REAL,
                last_event REAL,
                agent_version TEXT
            );
            """
        )


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


# ---------------------------------------------------------------- auth

def require_dashboard(creds: HTTPBasicCredentials = Depends(security)):
    ok_user = secrets.compare_digest(creds.username.encode(), DASH_USER.encode())
    ok_pass = secrets.compare_digest(creds.password.encode(), DASH_PASSWORD.encode())
    if not (ok_user and ok_pass):
        raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": 'Basic realm="AW Hub"'})


def require_ingest(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not token or not secrets.compare_digest(token.encode(), INGEST_TOKEN.encode()):
        raise HTTPException(401, "Token tidak valid")


# ---------------------------------------------------------------- kategori

_cat_state = {"mtime": None, "rules": [], "meta": {}}
UNCATEGORIZED = "Lainnya"


def load_categories():
    """Muat ulang categories.json bila file berubah (tanpa restart server)."""
    try:
        mtime = CATEGORIES_PATH.stat().st_mtime
    except FileNotFoundError:
        return _cat_state
    if mtime == _cat_state["mtime"]:
        return _cat_state
    raw = json.loads(CATEGORIES_PATH.read_text(encoding="utf-8"))
    rules, meta = [], {}
    for i, c in enumerate(raw.get("categories", [])):
        name = c["name"]
        meta[name] = {"slot": c.get("slot"), "color": c.get("color"), "order": i}
        if c.get("regex"):
            flags = re.IGNORECASE if c.get("ignore_case", True) else 0
            rules.append((name, re.compile(c["regex"], flags), c.get("match", "both")))
    meta.setdefault(UNCATEGORIZED, {"slot": None, "color": None, "order": 999})
    _cat_state.update(mtime=mtime, rules=rules, meta=meta)
    classify.cache_clear()
    return _cat_state


@lru_cache(maxsize=50000)
def classify(app_name: str, title: str) -> str:
    # Aturan pertama yang cocok menang; urutan di categories.json = prioritas.
    for name, rx, match in _cat_state["rules"]:
        if match in ("app", "both") and rx.search(app_name):
            return name
        if match in ("title", "both") and rx.search(title):
            return name
    return UNCATEGORIZED


# ---------------------------------------------------------------- waktu

def day_start_utc(d: date) -> float:
    return datetime(d.year, d.month, d.day, DAY_START_HOUR, tzinfo=TZ).timestamp()


def logical_day(ts: float) -> date:
    return (datetime.fromtimestamp(ts, TZ) - timedelta(hours=DAY_START_HOUR)).date()


EPOCH_ORDINAL = date(1970, 1, 1).toordinal()


@lru_cache(maxsize=200000)
def _utc_offset(utc_hour: int) -> float:
    return datetime.fromtimestamp(utc_hour * 3600, TZ).utcoffset().total_seconds()


@lru_cache(maxsize=200000)
def _day_of_local_hour(local_hour: int) -> date:
    return date.fromordinal(EPOCH_ORDINAL + (local_hour - DAY_START_HOUR) // 24)


def split_hours(start: float, end: float):
    """Pecah interval di batas jam lokal → (hari logis, jam 0-23, detik).

    Batas hari logis selalu jatuh di batas jam, jadi satu pemecahan cukup untuk
    agregasi harian maupun per jam. Pakai aritmetika + cache karena ini hot loop.
    """
    while start < end:
        off = _utc_offset(int(start // 3600))
        lh = int((start + off) // 3600)
        seg_end = min(end, (lh + 1) * 3600 - off)
        yield _day_of_local_hour(lh), lh % 24, seg_end - start
        start = seg_end


def period_key(d: date, group: str) -> str:
    if group == "week":
        return (d - timedelta(days=d.weekday())).isoformat()  # Senin
    if group == "month":
        return d.replace(day=1).isoformat()
    return d.isoformat()


def iter_periods(d_from: date, d_to: date, group: str):
    seen, d = [], d_from
    while d <= d_to:
        k = period_key(d, group)
        if not seen or seen[-1] != k:
            seen.append(k)
        d += timedelta(days=1)
    return seen


def _range_sql(d_from: date, d_to: date, devices, select: str):
    a, b = day_start_utc(d_from), day_start_utc(d_to + timedelta(days=1))
    # ingest memotong event per hari UTC, jadi tak ada event > 1 hari: batas bawah
    # ts_start ini membuat index ix_events_start terpakai di kedua sisi.
    sql = f"SELECT {select} FROM events WHERE ts_start >= ? AND ts_start < ? AND ts_end > ?"
    params = [a - 86400, b, a]
    if devices:
        sql += f" AND device IN ({','.join('?' * len(devices))})"
        params += devices
    return a, b, sql, params


def fetch_events(d_from: date, d_to: date, devices):
    a, b, sql, params = _range_sql(d_from, d_to, devices, "device, ts_start, ts_end, app, title")
    with db() as con:
        for dev, s, t, app_name, title in con.execute(sql + " ORDER BY ts_start", params):
            yield dev, max(s, a), min(t, b), app_name, title


def total_seconds(d_from: date, d_to: date, devices) -> float:
    a, b, sql, params = _range_sql(d_from, d_to, devices, "SUM(MIN(ts_end, ?) - MAX(ts_start, ?))")
    with db() as con:
        return con.execute(sql, [b, a] + params).fetchone()[0] or 0.0


def parse_devices(devices: str | None):
    return [d for d in (devices or "").split(",") if d] or None


def parse_range(d_from: date, d_to: date):
    if d_to < d_from:
        raise HTTPException(400, "Tanggal akhir sebelum tanggal awal")
    if (d_to - d_from).days > MAX_RANGE_DAYS:
        raise HTTPException(400, f"Rentang maksimal {MAX_RANGE_DAYS} hari")


# ---------------------------------------------------------------- ingest

class IngestEvent(BaseModel):
    start: float
    end: float
    app: str = Field(max_length=500)
    title: str = Field(max_length=2000)


class IngestPayload(BaseModel):
    device: str = Field(min_length=1, max_length=100)
    hostname: str | None = None
    agent_version: str | None = None
    period_start: float
    period_end: float
    events: list[IngestEvent] = Field(max_length=200000)


@app.post("/api/ingest", dependencies=[Depends(require_ingest)])
def ingest(p: IngestPayload):
    """Ganti seluruh event `device` di [period_start, period_end) dengan kiriman ini."""
    if p.period_end <= p.period_start:
        raise HTTPException(400, "Periode tidak valid")
    rows = []
    for e in p.events:
        s, t = max(e.start, p.period_start), min(e.end, p.period_end)
        if t > s:
            rows.append((p.device, s, t, e.app, e.title))
    with _db_lock, db() as con:
        con.execute(
            "DELETE FROM events WHERE device = ? AND ts_start >= ? AND ts_start < ?",
            (p.device, p.period_start, p.period_end),
        )
        con.executemany(
            "INSERT INTO events (device, ts_start, ts_end, app, title) VALUES (?, ?, ?, ?, ?)", rows
        )
        last_event = max((r[2] for r in rows), default=None)
        con.execute(
            """INSERT INTO devices (name, hostname, last_sync, last_event, agent_version)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                 hostname = excluded.hostname,
                 last_sync = excluded.last_sync,
                 last_event = MAX(COALESCE(devices.last_event, 0), COALESCE(excluded.last_event, 0)),
                 agent_version = excluded.agent_version""",
            (p.device, p.hostname, time.time(), last_event, p.agent_version),
        )
    return {"ok": True, "stored": len(rows)}


# ---------------------------------------------------------------- statistik

@app.get("/api/devices", dependencies=[Depends(require_dashboard)])
def devices():
    with db() as con:
        return [dict(r) for r in con.execute("SELECT * FROM devices ORDER BY name")]


@app.get("/api/categories", dependencies=[Depends(require_dashboard)])
def categories():
    st = load_categories()
    return [{"name": k, **v} for k, v in sorted(st["meta"].items(), key=lambda kv: kv[1]["order"])]


@app.get("/api/stats", dependencies=[Depends(require_dashboard)])
def stats(
    d_from: date = Query(alias="from"),
    d_to: date = Query(alias="to"),
    group: str = Query("day", pattern="^(day|week|month)$"),
    devices: str | None = None,
    top: int = Query(15, ge=1, le=100),
):
    parse_range(d_from, d_to)
    devs = parse_devices(devices)
    load_categories()

    cells = defaultdict(float)                              # (hari, jam, device) -> detik
    per_device = defaultdict(float)
    per_cat = defaultdict(float)
    per_app = defaultdict(lambda: defaultdict(float))      # app -> device -> detik
    per_title = defaultdict(float)

    for dev, s, t, app_name, title in fetch_events(d_from, d_to, devs):
        dur = t - s
        cat = classify(app_name, title)
        per_device[dev] += dur
        per_cat[cat] += dur
        per_app[app_name][dev] += dur
        per_title[(app_name, title, cat)] += dur
        for d, h, sec in split_hours(s, t):
            cells[(d, h, dev)] += sec

    series = defaultdict(lambda: defaultdict(float))       # periode -> device -> detik
    per_day = defaultdict(float)
    per_hour = defaultdict(lambda: defaultdict(float))     # jam lokal -> device -> detik
    for (d, h, dev), sec in cells.items():
        series[period_key(d, group)][dev] += sec
        per_day[d] += sec
        per_hour[h][dev] += sec

    total = sum(per_device.values())
    n_days = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=n_days - 1)
    active_days = sum(1 for v in per_day.values() if v >= 60)
    meta = _cat_state["meta"]

    apps_sorted = sorted(per_app.items(), key=lambda kv: -sum(kv[1].values()))
    return {
        "range": {"from": d_from, "to": d_to, "days": n_days, "group": group},
        "total": total,
        "prev_total": total_seconds(prev_from, prev_to, devs),
        "prev_range": {"from": prev_from, "to": prev_to},
        "active_days": active_days,
        "avg_per_active_day": total / active_days if active_days else 0,
        "per_device": dict(per_device),
        "series": [
            {"period": k, "per_device": dict(series.get(k, {}))} for k in iter_periods(d_from, d_to, group)
        ],
        "busiest_day": max(per_day.items(), key=lambda kv: kv[1], default=(None, 0)),
        "categories": sorted(
            [{"name": k, "sec": v, "slot": meta.get(k, {}).get("slot"), "color": meta.get(k, {}).get("color")}
             for k, v in per_cat.items()],
            key=lambda x: -x["sec"],
        ),
        "apps": [
            {"app": k, "sec": sum(v.values()), "per_device": dict(v), "category": classify(k, "")}
            for k, v in apps_sorted[:top]
        ],
        "titles": [
            {"app": a, "title": ti, "category": c, "sec": v}
            for (a, ti, c), v in sorted(per_title.items(), key=lambda kv: -kv[1])[:top]
        ],
        "hours": [{"hour": h, "per_device": dict(per_hour.get(h, {}))} for h in range(24)],
    }


@app.get("/api/timeline", dependencies=[Depends(require_dashboard)])
def timeline(day: date, devices: str | None = None):
    load_categories()
    segs = []
    last_by_dev = {}
    for dev, s, t, app_name, title in fetch_events(day, day, parse_devices(devices)):
        cat = classify(app_name, title)
        prev = last_by_dev.get(dev)
        if prev and prev["app"] == app_name and s - prev["end"] <= TIMELINE_MERGE_GAP:
            prev["end"] = max(prev["end"], t)
            prev["active"] += t - s
            prev["titles"][title] = prev["titles"].get(title, 0) + (t - s)
            continue
        seg = {"device": dev, "start": s, "end": t, "active": t - s, "app": app_name,
               "category": cat, "titles": {title: t - s}}
        segs.append(seg)
        last_by_dev[dev] = seg
    for seg in segs:
        seg["title"] = max(seg.pop("titles").items(), key=lambda kv: kv[1])[0]
    return {
        "day": day,
        "start": day_start_utc(day),
        "end": day_start_utc(day + timedelta(days=1)),
        "segments": segs,
    }


@app.get("/api/config", dependencies=[Depends(require_dashboard)])
def config():
    return {"tz": str(TZ), "day_start_hour": DAY_START_HOUR,
            "today": logical_day(time.time()).isoformat()}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/", dependencies=[Depends(require_dashboard)])
def index():
    return FileResponse(BASE_DIR / "static" / "index.html", headers={"Cache-Control": "no-cache"})


init_db()
load_categories()
