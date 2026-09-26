"""Ringkasan mingguan ke Telegram (dikirim otomatis tiap Senin pagi). Bahasa: en | id."""
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
REPORT_LANG = os.environ.get("AW_HUB_REPORT_LANG", "en").lower()
PUBLIC_URL = os.environ.get("AW_HUB_PUBLIC_URL") or (
    f"https://{os.environ['AW_HUB_DOMAIN']}" if os.environ.get("AW_HUB_DOMAIN") else "")

BLOCKS = " ▏▎▍▌▋▊▉█"
L = {
    "en": {
        "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        "h": "h",
        "title": "📊 <b>Weekly summary {a} – {b}</b>",
        "vs_prev": "{arrow} {pct}% vs last week ({prev})",
        "no_prev": "no data last week",
        "total": "⏱ Total active <b>{total}</b> — {cmp}",
        "days_active": "📅 {n} active days · avg {avg}/day",
        "work_head": "<b>Work vs personal</b>",
        "work": "🏢 Work <b>{work}</b> ({share}%) — office hours {inh}, overtime {ot}, weekend {we}",
        "ot_days": "🌙 {n} overtime days (≥ 30 min outside office hours)",
        "work_personal": "🏠 Work on personal laptop {d}",
        "personal_hours": "☕ Non-work during office hours {d}",
        "daily": "<b>Daily</b>",
        "top_cats": "<b>Top categories</b>",
        "top_apps": "<b>Top applications</b>",
        "busiest": "🔥 Busiest day: {day}, {date} ({dur})",
        "open": "Open dashboard →",
    },
    "id": {
        "days": ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"],
        "months": ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
        "h": "j",
        "title": "📊 <b>Ringkasan minggu {a} – {b}</b>",
        "vs_prev": "{arrow} {pct}% vs minggu lalu ({prev})",
        "no_prev": "minggu lalu tidak ada data",
        "total": "⏱ Total aktif <b>{total}</b> — {cmp}",
        "days_active": "📅 {n} hari aktif · rata-rata {avg}/hari",
        "work_head": "<b>Kerja vs pribadi</b>",
        "work": "🏢 Kerja <b>{work}</b> ({share}%) — jam kerja {inh}, lembur {ot}, akhir pekan {we}",
        "ot_days": "🌙 {n} hari lembur (≥ 30 menit di luar jam kerja)",
        "work_personal": "🏠 Kerja di laptop pribadi {d}",
        "personal_hours": "☕ Non-kerja di jam kerja {d}",
        "daily": "<b>Harian</b>",
        "top_cats": "<b>Kategori teratas</b>",
        "top_apps": "<b>Aplikasi teratas</b>",
        "busiest": "🔥 Hari tersibuk: {day}, {date} ({dur})",
        "open": "Buka dashboard →",
    },
}


def configured() -> bool:
    return bool(BOT_TOKEN and CHAT_ID)


def last_full_week(today: date) -> tuple[date, date]:
    """Senin–Minggu terakhir yang sudah selesai sebelum `today`."""
    this_monday = today - timedelta(days=today.weekday())
    return this_monday - timedelta(days=7), this_monday - timedelta(days=1)


def bar(value: float, max_value: float, width: int = 10) -> str:
    if max_value <= 0:
        return " " * width
    units = value / max_value * width
    full = int(units)
    part = BLOCKS[int((units - full) * 8)] if full < width else ""
    return ("█" * full + part).ljust(width)


def build_text(st: dict, d_from: date, d_to: date, lang: str = REPORT_LANG, cat_label=lambda n: n) -> str:
    t = L.get(lang, L["en"])
    e = html.escape

    def dur(sec):
        sec = int(round(sec or 0))
        h, m = divmod(sec // 60, 60)
        return f"{h}{t['h']} {m:02d}m" if h else f"{m}m"

    def fdate(d, year=False):
        return f"{d.day} {t['months'][d.month - 1]}" + (f" {d.year}" if year else "")

    total, prev = st["total"], st["prev_total"]
    if prev:
        delta = (total - prev) / prev * 100
        cmp = t["vs_prev"].format(arrow="▲" if delta >= 0 else "▼", pct=f"{abs(delta):.0f}", prev=dur(prev))
    else:
        cmp = t["no_prev"]
    lines = [t["title"].format(a=fdate(d_from), b=fdate(d_to, True)), "",
             t["total"].format(total=dur(total), cmp=cmp),
             t["days_active"].format(n=st["active_days"], avg=dur(st["avg_per_active_day"]))]
    if st["per_device"]:
        lines.append("💻 " + " · ".join(f"{e(k)} {dur(v)}" for k, v in sorted(st["per_device"].items())))

    w = st.get("work")
    if w and w["config"]["categories"]:
        share = w["work_total"] / total * 100 if total else 0
        lines += ["", t["work_head"], t["work"].format(work=dur(w["work_total"]), share=f"{share:.0f}",
                                                         inh=dur(w["in_hours"]), ot=dur(w["overtime"]),
                                                         we=dur(w["weekend"]))]
        if w["overtime_days"]:
            lines.append(t["ot_days"].format(n=w["overtime_days"]))
        if w["work_on_personal_device"] >= 60:
            lines.append(t["work_personal"].format(d=dur(w["work_on_personal_device"])))
        if w["personal_in_hours"] >= 60:
            lines.append(t["personal_hours"].format(d=dur(w["personal_in_hours"])))

    days = [(date.fromisoformat(r["period"]), sum(r["per_device"].values())) for r in st["series"]]
    mx = max((v for _, v in days), default=0)
    lines += ["", t["daily"], "<pre>" + "\n".join(
        f"{t['days'][d.weekday()]} {bar(v, mx)} {dur(v):>7}" for d, v in days) + "</pre>"]

    if st["categories"]:
        lines.append(t["top_cats"])
        for i, c in enumerate(st["categories"][:4], 1):
            pct = c["sec"] / total * 100 if total else 0
            lines.append(f"{i}. {e(cat_label(c['name']))} — {dur(c['sec'])} ({pct:.0f}%)")
    if st["apps"]:
        lines += ["", t["top_apps"]]
        for i, a in enumerate(st["apps"][:5], 1):
            name = a["app"][:-4] if a["app"].lower().endswith(".exe") else a["app"]
            lines.append(f"{i}. {e(name)} — {dur(a['sec'])}")
    bd, bsec = st["busiest_day"]
    if bd:
        bd = date.fromisoformat(str(bd))
        lines += ["", t["busiest"].format(day=t["days"][bd.weekday()], date=fdate(bd), dur=dur(bsec))]
    if PUBLIC_URL:
        lines += ["", f'<a href="{PUBLIC_URL}/#from={d_from}&amp;to={d_to}&amp;group=day">{t["open"]}</a>']
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
