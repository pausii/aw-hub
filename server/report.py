"""Ringkasan mingguan ke Telegram (dikirim otomatis tiap Senin pagi)."""
import html
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

log = logging.getLogger("aw-hub.report")

BOT_TOKEN = os.environ.get("AW_HUB_TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("AW_HUB_TELEGRAM_CHAT_ID", "")
REPORT_WEEKDAY = int(os.environ.get("AW_HUB_REPORT_WEEKDAY", "0"))   # 0 = Senin
REPORT_HOUR = int(os.environ.get("AW_HUB_REPORT_HOUR", "7"))
PUBLIC_URL = os.environ.get("AW_HUB_PUBLIC_URL") or (
    f"https://{os.environ['AW_HUB_DOMAIN']}" if os.environ.get("AW_HUB_DOMAIN") else "")

DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
BLOCKS = " ▏▎▍▌▋▊▉█"


def configured() -> bool:
    return bool(BOT_TOKEN and CHAT_ID)


def last_full_week(today: date) -> tuple[date, date]:
    """Senin–Minggu terakhir yang sudah selesai sebelum `today`."""
    this_monday = today - timedelta(days=today.weekday())
    return this_monday - timedelta(days=7), this_monday - timedelta(days=1)


def dur(sec: float) -> str:
    sec = int(round(sec or 0))
    h, m = divmod(sec // 60, 60)
    return f"{h}j {m:02d}m" if h else f"{m}m"


def fdate(d: date, year=False) -> str:
    return f"{d.day} {MONTHS[d.month - 1]}" + (f" {d.year}" if year else "")


def bar(value: float, max_value: float, width: int = 10) -> str:
    if max_value <= 0:
        return " " * width
    units = value / max_value * width
    full = int(units)
    part = BLOCKS[int((units - full) * 8)] if full < width else ""
    return ("█" * full + part).ljust(width)


def build_text(st: dict, d_from: date, d_to: date) -> str:
    e = html.escape
    lines = [f"📊 <b>Ringkasan minggu {fdate(d_from)} – {fdate(d_to, True)}</b>", ""]
    total, prev = st["total"], st["prev_total"]
    if prev:
        delta = (total - prev) / prev * 100
        cmp = f"{'▲' if delta >= 0 else '▼'} {abs(delta):.0f}% vs minggu lalu ({dur(prev)})"
    else:
        cmp = "minggu lalu tidak ada data"
    lines.append(f"⏱ Total aktif <b>{dur(total)}</b> — {cmp}")
    lines.append(f"📅 {st['active_days']} hari aktif · rata-rata {dur(st['avg_per_active_day'])}/hari")
    if st["per_device"]:
        lines.append("💻 " + " · ".join(f"{e(k)} {dur(v)}" for k, v in sorted(st["per_device"].items())))

    w = st.get("work")
    if w and w["config"]["categories"]:
        lines += ["", "<b>Kerja vs pribadi</b>"]
        share = w["work_total"] / total * 100 if total else 0
        lines.append(f"🏢 Kerja <b>{dur(w['work_total'])}</b> ({share:.0f}%) — jam kerja {dur(w['in_hours'])}, "
                     f"lembur {dur(w['overtime'])}, akhir pekan {dur(w['weekend'])}")
        if w["overtime_days"]:
            lines.append(f"🌙 {w['overtime_days']} hari lembur (≥ 30 menit di luar jam kerja)")
        if w["work_on_personal_device"] >= 60:
            lines.append(f"🏠 Kerja di laptop pribadi {dur(w['work_on_personal_device'])}")
        if w["personal_in_hours"] >= 60:
            lines.append(f"☕ Non-kerja di jam kerja {dur(w['personal_in_hours'])}")

    days = [(date.fromisoformat(r["period"]), sum(r["per_device"].values())) for r in st["series"]]
    mx = max((v for _, v in days), default=0)
    lines += ["", "<b>Harian</b>", "<pre>" + "\n".join(
        f"{DAYS[d.weekday()]} {bar(v, mx)} {dur(v):>7}" for d, v in days) + "</pre>"]

    if st["categories"]:
        lines.append("<b>Kategori teratas</b>")
        for i, c in enumerate(st["categories"][:4], 1):
            pct = c["sec"] / total * 100 if total else 0
            lines.append(f"{i}. {e(c['name'])} — {dur(c['sec'])} ({pct:.0f}%)")
    if st["apps"]:
        lines += ["", "<b>Aplikasi teratas</b>"]
        for i, a in enumerate(st["apps"][:5], 1):
            name = a["app"][:-4] if a["app"].lower().endswith(".exe") else a["app"]
            lines.append(f"{i}. {e(name)} — {dur(a['sec'])}")
    bd, bsec = st["busiest_day"]
    if bd:
        bd = date.fromisoformat(str(bd))
        lines += ["", f"🔥 Hari tersibuk: {DAYS[bd.weekday()]}, {fdate(bd)} ({dur(bsec)})"]
    if PUBLIC_URL:
        lines += ["", f'<a href="{PUBLIC_URL}/#from={d_from}&amp;to={d_to}&amp;group=day">Buka dashboard →</a>']
    return "\n".join(lines)


def send(text: str) -> dict:
    if not configured():
        raise RuntimeError("AW_HUB_TELEGRAM_BOT_TOKEN / AW_HUB_TELEGRAM_CHAT_ID belum di-set")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=json.dumps({"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML",
                         "disable_web_page_preview": True}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as ex:
        # jangan bocorkan URL berisi token ke log / response
        raise RuntimeError(f"Telegram HTTP {ex.code}: {ex.read()[:300].decode(errors='replace')}") from None


def due(now_local: datetime, last_sent_week: str | None) -> str | None:
    """Kunci minggu (tanggal Senin minggu yang dilaporkan) bila laporan jatuh tempo, else None."""
    if not configured() or now_local.weekday() != REPORT_WEEKDAY or now_local.hour < REPORT_HOUR:
        return None
    week_from, _ = last_full_week(now_local.date())
    key = week_from.isoformat()
    return None if key == last_sent_week else key
