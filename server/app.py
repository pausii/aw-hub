"""AW Hub — penampung data ActivityWatch dari beberapa laptop + dashboard gabungan.

Agent di tiap laptop mengirim event window yang sudah difilter "tidak AFK"
per potongan waktu (replace semantics), server menyimpan ke SQLite dan
menyajikan statistik gabungan.
"""
import base64
import hashlib
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
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field

import auth
import report

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
_db_lock = threading.Lock()
sessions = auth.Sessions(auth.load_secret(DB_PATH.parent / "secret.key", os.environ.get("AW_HUB_SECRET", "")),
                         DASH_PASSWORD)
limiter = auth.LoginLimiter()


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
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
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

def current_user(request: Request) -> str | None:
    return sessions.verify(request.cookies.get(auth.COOKIE_NAME))


def require_dashboard(request: Request):
    if not current_user(request):
        raise HTTPException(401, "Belum login")


class LoginPayload(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


@app.post("/api/login")
def login(p: LoginPayload, request: Request):
    ip = auth.client_ip(request)
    allowed, wait = limiter.check(ip)
    if not allowed:
        return JSONResponse({"detail": "Terlalu banyak percobaan.", "retry_after": wait}, status_code=429,
                            headers={"Retry-After": str(wait)})
    ok_user = secrets.compare_digest(p.username.encode(), DASH_USER.encode())
    ok_pass = secrets.compare_digest(p.password.encode(), DASH_PASSWORD.encode())
    if not (ok_user and ok_pass):
        time.sleep(0.4)  # perlambat tebakan beruntun
        remaining, lock = limiter.fail(ip)
        if lock:
            return JSONResponse({"detail": "Terlalu banyak percobaan.", "retry_after": lock}, status_code=429,
                                headers={"Retry-After": str(lock)})
        return JSONResponse({"detail": "Username atau password salah.", "remaining": remaining}, status_code=401)
    limiter.success(ip)
    res = JSONResponse({"ok": True})
    res.set_cookie(auth.COOKIE_NAME, sessions.issue(p.username), max_age=auth.SESSION_TTL, httponly=True,
                   samesite="lax", secure=request.url.scheme == "https", path="/")
    return res


@app.post("/api/logout")
def logout():
    res = JSONResponse({"ok": True})
    res.delete_cookie(auth.COOKIE_NAME, path="/")
    return res


def require_ingest(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not token or not secrets.compare_digest(token.encode(), INGEST_TOKEN.encode()):
        raise HTTPException(401, "Token tidak valid")


# ---------------------------------------------------------------- kategori

UNCATEGORIZED = "Lainnya"
DEFAULT_WORK = {"categories": [], "days": [0, 1, 2, 3, 4], "start_hour": 8, "end_hour": 17, "office_devices": []}
_cat_state = {"mtime": None, "rules": [], "meta": {}, "work": DEFAULT_WORK}


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
        meta[name] = {"slot": c.get("slot"), "color": c.get("color"), "order": i, "name_en": c.get("name_en")}
        if c.get("regex"):
            flags = re.IGNORECASE if c.get("ignore_case", True) else 0
            rules.append((name, re.compile(c["regex"], flags), c.get("match", "both")))
    meta.setdefault(UNCATEGORIZED, {"slot": None, "color": None, "order": 999, "name_en": "Other"})
    work = {**DEFAULT_WORK, **raw.get("work", {})}
    work["categories"] = set(work["categories"])
    _cat_state.update(mtime=mtime, rules=rules, meta=meta, work=work)
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
    fine = defaultdict(float)                               # (hari, jam, device, kategori) -> detik
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
            fine[(d, h, dev, cat)] += sec

    series = defaultdict(lambda: defaultdict(float))       # periode -> device -> detik
    per_day = defaultdict(float)
    per_hour = defaultdict(lambda: defaultdict(float))     # jam lokal -> device -> detik
    heat = defaultdict(float)                               # (hari-dalam-minggu 0=Senin, jam) -> detik
    for (d, h, dev), sec in cells.items():
        series[period_key(d, group)][dev] += sec
        per_day[d] += sec
        per_hour[h][dev] += sec
        heat[(d.weekday(), h)] += sec
    cat_series = defaultdict(lambda: defaultdict(float))   # periode -> kategori -> detik
    for (d, _h, _dev, cat), sec in fine.items():
        cat_series[period_key(d, group)][cat] += sec
    # jumlah kemunculan tiap hari-dalam-minggu di rentang → pembagi rata-rata heatmap
    weekday_count = [0] * 7
    for i in range((d_to - d_from).days + 1):
        weekday_count[(d_from + timedelta(days=i)).weekday()] += 1

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
        "heat": {
            "weekday_count": weekday_count,
            "cells": [[heat.get((wd, h), 0.0) for h in range(24)] for wd in range(7)],
        },
        "category_series": [
            {"period": k, "per_category": dict(cat_series.get(k, {}))} for k in iter_periods(d_from, d_to, group)
        ],
        "work": work_insight(fine, d_from, d_to, group),
    }


def work_insight(fine, d_from: date, d_to: date, group: str):
    """Kerja vs pribadi: kategori kerja × jam kerja × perangkat kantor (config `work`)."""
    w = _cat_state["work"]
    days, start_h, end_h = set(w["days"]), w["start_hour"], w["end_hour"]
    office = set(w["office_devices"])
    buckets = defaultdict(float)                     # in_hours | overtime | weekend | personal
    personal_in_hours = 0.0
    work_on_personal_device = 0.0
    matrix = defaultdict(lambda: {"work": 0.0, "personal": 0.0})
    series = defaultdict(lambda: defaultdict(float))
    extra_per_day = defaultdict(float)               # lembur + akhir pekan per hari
    for (d, h, dev, cat), sec in fine.items():
        # hari kalender (bukan hari logis): jam 00–03 milik hari berikutnya
        cal_wd = (d.weekday() + (1 if h < DAY_START_HOUR else 0)) % 7
        in_sched = cal_wd in days and start_h <= h < end_h
        if cat in w["categories"]:
            kind = "weekend" if cal_wd not in days else ("in_hours" if in_sched else "overtime")
            matrix[dev]["work"] += sec
            if dev not in office:
                work_on_personal_device += sec
            if kind != "in_hours":
                extra_per_day[d] += sec
        else:
            kind = "personal"
            matrix[dev]["personal"] += sec
            if in_sched:
                personal_in_hours += sec
        buckets[kind] += sec
        series[period_key(d, group)][kind] += sec
    work_total = buckets["in_hours"] + buckets["overtime"] + buckets["weekend"]
    return {
        "config": {"categories": sorted(w["categories"]), "days": sorted(days), "start_hour": start_h,
                   "end_hour": end_h, "office_devices": sorted(office)},
        "work_total": work_total,
        "personal_total": buckets["personal"],
        "in_hours": buckets["in_hours"],
        "overtime": buckets["overtime"],
        "weekend": buckets["weekend"],
        "personal_in_hours": personal_in_hours,
        "work_on_personal_device": work_on_personal_device,
        "overtime_days": sum(1 for v in extra_per_day.values() if v >= 30 * 60),
        "matrix": dict(matrix),
        "series": [{"period": k, **series.get(k, {})} for k in iter_periods(d_from, d_to, group)],
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
def config(request: Request):
    return {"tz": str(TZ), "day_start_hour": DAY_START_HOUR,
            "today": logical_day(time.time()).isoformat(), "user": current_user(request),
            "telegram": report.configured(),
            "report_schedule": {"weekday": report.REPORT_WEEKDAY, "hour": report.REPORT_HOUR},
            "report_lang": report.REPORT_LANG}


# ---------------------------------------------------------------- ringkasan mingguan (Telegram)

def meta_get(key: str) -> str | None:
    with db() as con:
        row = con.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None


def meta_set(key: str, value: str):
    with db() as con:
        con.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def cat_label(name: str, lang: str) -> str:
    return (_cat_state["meta"].get(name, {}).get("name_en") or name) if lang == "en" else name


def weekly_report_text(week_from: date | None = None, lang: str = report.REPORT_LANG) -> tuple[str, date, date]:
    if week_from is None:
        week_from, week_to = report.last_full_week(logical_day(time.time()))
    else:
        week_from -= timedelta(days=week_from.weekday())
        week_to = week_from + timedelta(days=6)
    st = stats(d_from=week_from, d_to=week_to, group="day", devices=None, top=5)
    return (report.build_text(st, week_from, week_to, lang, lambda n: cat_label(n, lang)),
            week_from, week_to)


@app.get("/api/report/preview", dependencies=[Depends(require_dashboard)])
def report_preview(week: date | None = None, lang: str = Query(report.REPORT_LANG, pattern="^(en|id)$")):
    text, a, b = weekly_report_text(week, lang)
    return {"from": a, "to": b, "text": text, "telegram": report.configured(),
            "report_lang": report.REPORT_LANG, "last_sent_week": meta_get("report_last_week")}


@app.post("/api/report/send", dependencies=[Depends(require_dashboard)])
def report_send(week: date | None = None):
    text, a, _ = weekly_report_text(week)
    try:
        report.send(text)
    except RuntimeError as ex:
        raise HTTPException(502, str(ex))
    return {"ok": True, "week": a}


def _report_loop():
    while True:
        wait = 60
        try:
            key = report.due(datetime.now(TZ), meta_get("report_last_week"))
            if key:
                text, _, _ = weekly_report_text(date.fromisoformat(key))
                report.send(text)
                meta_set("report_last_week", key)
                report.log.warning("Ringkasan mingguan %s terkirim", key)
        except Exception:  # jangan sampai thread mati; coba lagi 15 menit kemudian
            report.log.exception("Gagal mengirim ringkasan mingguan")
            wait = 15 * 60
        time.sleep(wait)


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ---------------------------------------------------------------- anti-indeks search engine

@app.get("/robots.txt", response_class=PlainTextResponse)
def robots():
    return "User-agent: *\nDisallow: /\n"


# ---------------------------------------------------------------- security headers

def _script_hashes(*files: str) -> str:
    """Hash sha256 tiap <script> inline → CSP tanpa 'unsafe-inline' untuk script."""
    out = []
    for f in files:
        # byte apa adanya (tanpa konversi CRLF) — harus identik dengan yang di-hash browser
        html = (BASE_DIR / "static" / f).read_bytes().decode("utf-8")
        for body in re.findall(r"<script>(.*?)</script>", html, re.S):
            digest = hashlib.sha256(body.encode()).digest()
            out.append(f"'sha256-{base64.b64encode(digest).decode()}'")
    return " ".join(out)


CSP_HTML = (
    "default-src 'none'; "
    f"script-src {_script_hashes('index.html', 'login.html')}; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "img-src 'self' data:; connect-src 'self'; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)
CSP_OTHER = "default-src 'none'; frame-ancestors 'none'"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Tolak POST lintas situs (CSRF) untuk endpoint ber-cookie. Agent (Bearer) tidak mengirim Origin.
    if request.method not in SAFE_METHODS and request.url.path != "/api/ingest":
        origin = request.headers.get("origin")
        if origin and origin.split("://", 1)[-1] != request.headers.get("host", ""):
            return JSONResponse({"detail": "Origin tidak diizinkan"}, status_code=403)
    res = await call_next(request)
    is_html = res.headers.get("content-type", "").startswith("text/html")
    h = res.headers
    h["Content-Security-Policy"] = CSP_HTML if is_html else CSP_OTHER
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "DENY"
    h["Referrer-Policy"] = "same-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    h["Strict-Transport-Security"] = "max-age=31536000"
    # robots.txt hanya melarang crawl; header ini mencegah URL yang ditautkan dari luar ikut terindeks
    h["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return res


@app.get("/")
def index(request: Request):
    if not current_user(request):
        return RedirectResponse("/login", status_code=303)
    return FileResponse(BASE_DIR / "static" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/login")
def login_page(request: Request):
    if current_user(request):
        return RedirectResponse("/", status_code=303)
    return FileResponse(BASE_DIR / "static" / "login.html", headers={"Cache-Control": "no-cache"})


init_db()
load_categories()
if report.configured():
    threading.Thread(target=_report_loop, name="weekly-report", daemon=True).start()
