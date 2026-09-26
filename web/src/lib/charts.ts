// Chart SVG buatan sendiri (tanpa library). Spesifikasi visual: batang ≤24px dengan ujung membulat 4px,
// garis 2px, celah 2px warna surface antar segmen, gridline hairline, teks memakai token teks (bukan warna data).
import { esc, pad2 } from "./dom";
import { fmtDate, fmtDur, clockOf, periodLabel } from "./format";
import { L, t } from "./i18n";
import { S, catColor, catLabel } from "./state";
import { hideTip, showTip, tipRow } from "./tooltip";
import type { CatTotal, RhythmDay } from "./types";

type Key = string;

export interface SeriesOpts<R> {
  keys: Key[];
  colorFn: (k: Key) => string;
  valFn: (r: R, k: Key) => number | undefined;
  labelFn: (r: R, short: boolean) => string;
  tipTitle: (r: R) => string;
  height?: number;
  nameFn?: (k: Key) => string;
}

interface Frame {
  W: number; H: number; iw: number; ih: number; band: number;
  m: { l: number; r: number; t: number; b: number };
  y: (sec: number) => number;
  cx: (i: number) => number;
  grid: string;
}

// ---------- skala & sumbu bersama
function niceStep(maxH: number): number {
  for (const s of [0.25, 0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (maxH / s <= 5) return s;
  return 1000;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Kerangka chart berbasis periode: sumbu Y (jam) + label X; posisi titik = tengah band. */
function frame<R>(el: HTMLElement, rows: R[], maxSec: number, labelFn: SeriesOpts<R>["labelFn"], height: number): Frame {
  const W = Math.max(280, el.clientWidth), H = height, m = { l: 34, r: 8, t: 10, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxH = Math.max(1 / 60, maxSec / 3600);
  const step = niceStep(maxH), top = Math.ceil(maxH / step) * step;
  const band = iw / Math.max(1, rows.length);
  const f: Frame = {
    W, H, m, iw, ih, band,
    y: (sec) => m.t + ih - (sec / 3600 / top) * ih,
    cx: (i) => m.l + band * i + band / 2,
    grid: "",
  };
  for (let v = 0; v <= top + 1e-9; v += step) {
    f.grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${f.y(v * 3600)}" y2="${f.y(v * 3600)}" stroke="var(${v ? "--grid" : "--axis"})"/>`;
    f.grid += `<text x="${m.l - 6}" y="${f.y(v * 3600) + 4}" text-anchor="end">${+v.toFixed(2)}${L().h}</text>`;
  }
  const every = Math.ceil(rows.length / Math.max(1, Math.floor(iw / 46)));
  rows.forEach((r, i) => {
    if (i % every === 0) f.grid += `<text x="${f.cx(i)}" y="${H - 6}" text-anchor="middle">${esc(labelFn(r, true))}</text>`;
  });
  return f;
}

/** Tooltip satu-untuk-semua-seri pada satu periode. */
function seriesTip(ev: MouseEvent, title: string, keys: Key[], colorFn: (k: Key) => string,
                   vals: Record<Key, number | undefined>, showTotal: boolean, nameFn: (k: Key) => string = (k) => k): void {
  const rows = keys.filter((k) => vals[k]).map((k) => tipRow(colorFn(k), nameFn(k), fmtDur(vals[k])));
  const total = keys.reduce((a, k) => a + (vals[k] || 0), 0);
  showTip(ev, `<div class="tt">${esc(title)}</div>${rows.join("") || `<div class="mt">${t("noActivity")}</div>`}` +
    (showTotal && rows.length > 1 ? `<div class="row" style="margin-top:4px">${t("total")}<b>${fmtDur(total)}</b></div>` : ""));
}

const valsOf = <R>(r: R, keys: Key[], valFn: SeriesOpts<R>["valFn"]) =>
  Object.fromEntries(keys.map((k) => [k, valFn(r, k)])) as Record<Key, number | undefined>;

// ---------- kolom bertumpuk
export function stackedColumns<R>(el: HTMLElement, rows: R[], o: SeriesOpts<R>): void {
  const { keys, colorFn, valFn, labelFn, tipTitle, height = 220, nameFn } = o;
  const totals = rows.map((r) => keys.reduce((a, k) => a + (valFn(r, k) || 0), 0));
  const f = frame(el, rows, Math.max(...totals, 0), labelFn, height);
  const bw = Math.min(24, Math.max(2, f.band * 0.7)), GAP = 2;
  let marks = "", hits = "";
  rows.forEach((r, i) => {
    const x = f.cx(i) - bw / 2;
    let acc = 0;
    const present = keys.filter((k) => (valFn(r, k) || 0) > 0);
    present.forEach((k, j) => {
      const yBot = f.y(acc) - (j ? GAP : 0), yTop = f.y((acc += valFn(r, k) || 0));
      const hh = yBot - yTop;
      if (hh <= 0) return;
      marks += j === present.length - 1
        ? `<path d="${roundedTop(x, yTop, bw, hh, 4)}" fill="${colorFn(k)}"/>`
        : `<rect x="${x}" y="${yTop}" width="${bw}" height="${hh}" fill="${colorFn(k)}"/>`;
    });
    hits += `<rect class="hit" data-i="${i}" x="${f.m.l + f.band * i}" y="${f.m.t}" width="${f.band}" height="${f.ih}" fill="transparent"/>`;
  });
  el.innerHTML = `<svg width="${f.W}" height="${f.H}" role="img">${f.grid}${marks}${hits}</svg>`;
  el.querySelectorAll<SVGRectElement>(".hit").forEach((h) => {
    const r = rows[+h.dataset.i!];
    h.addEventListener("mousemove", (ev) => {
      h.setAttribute("fill", "var(--wash)");
      seriesTip(ev, tipTitle(r), keys, colorFn, valsOf(r, keys, valFn), true, nameFn);
    });
    h.addEventListener("mouseleave", () => { h.setAttribute("fill", "transparent"); hideTip(); });
  });
}

/** Crosshair bersama untuk garis & area: snap ke periode terdekat. i = -1 saat kursor keluar. */
function attachCrosshair(el: HTMLElement, f: Frame, count: number, onMove: (ev: MouseEvent | null, i: number) => void): void {
  const svg = el.querySelector("svg")!, cross = svg.querySelector<SVGLineElement>(".cross")!;
  svg.addEventListener("mousemove", (ev) => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    const i = Math.max(0, Math.min(count - 1, Math.round((px - f.m.l - f.band / 2) / f.band)));
    cross.setAttribute("x1", String(f.cx(i))); cross.setAttribute("x2", String(f.cx(i))); cross.style.opacity = "1";
    onMove(ev, i);
  });
  svg.addEventListener("mouseleave", () => { cross.style.opacity = "0"; onMove(null, -1); hideTip(); });
}

// ---------- garis (tren per perangkat + total)
export function lineChart<R>(el: HTMLElement, rows: R[], o: SeriesOpts<R> & { totalKey?: string | null }): void {
  const { keys, colorFn, valFn, labelFn, tipTitle, height = 220, totalKey } = o;
  const series = keys.map((k) => ({ k, color: colorFn(k), vals: rows.map((r) => valFn(r, k) || 0) }));
  if (totalKey) {
    series.push({ k: totalKey, color: "var(--ink-2)", vals: rows.map((_, i) => series.reduce((a, s) => a + s.vals[i], 0)) });
  }
  const f = frame(el, rows, Math.max(0, ...series.flatMap((s) => s.vals)), labelFn, height);
  const pts = (vals: number[]) => vals.map((v, i) => `${f.cx(i)},${f.y(v)}`).join(" ");
  const last = rows.length - 1;
  let marks = "";
  // area wash hanya untuk seri tunggal (banyak wash bertumpuk jadi keruh)
  if (series.length === 1 && rows.length > 1) {
    marks += `<polygon points="${f.cx(0)},${f.y(0)} ${pts(series[0].vals)} ${f.cx(last)},${f.y(0)}" fill="${series[0].color}" opacity=".10"/>`;
  }
  for (const s of series) {
    marks += `<polyline points="${pts(s.vals)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    marks += `<circle cx="${f.cx(last)}" cy="${f.y(s.vals[last])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  const dots = series.map((s, j) =>
    `<circle class="hd" data-j="${j}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2" style="opacity:0"/>`).join("");
  el.innerHTML = `<svg width="${f.W}" height="${f.H}" role="img">${f.grid}
    <line class="cross" y1="${f.m.t}" y2="${f.m.t + f.ih}" stroke="var(--axis)" style="opacity:0"/>${marks}${dots}
    <rect x="${f.m.l}" y="${f.m.t}" width="${f.iw}" height="${f.ih}" fill="transparent"/></svg>`;
  const hd = el.querySelectorAll<SVGCircleElement>(".hd");
  const allKeys = series.map((s) => s.k), colorOf = Object.fromEntries(series.map((s) => [s.k, s.color]));
  attachCrosshair(el, f, rows.length, (ev, i) => {
    hd.forEach((c) => {
      if (i < 0) { c.style.opacity = "0"; return; }
      const s = series[+c.dataset.j!];
      c.setAttribute("cx", String(f.cx(i))); c.setAttribute("cy", String(f.y(s.vals[i]))); c.style.opacity = "1";
    });
    if (ev && i >= 0) {
      seriesTip(ev, tipTitle(rows[i]), allKeys, (k) => colorOf[k], Object.fromEntries(series.map((s) => [s.k, s.vals[i]])), false);
    }
  });
}

// ---------- area bertumpuk (komposisi kategori per periode)
export function stackedArea<R>(el: HTMLElement, rows: R[], o: SeriesOpts<R>): void {
  if (rows.length < 2) return stackedColumns(el, rows, o);
  const { keys, colorFn, valFn, labelFn, tipTitle, height = 220, nameFn } = o;
  const cum = rows.map(() => 0);
  const layers: { k: Key; lo: number[]; hi: number[] }[] = [];
  for (const k of keys) {
    const lo = cum.slice();
    rows.forEach((r, i) => { cum[i] += valFn(r, k) || 0; });
    layers.push({ k, lo, hi: cum.slice() });
  }
  const f = frame(el, rows, Math.max(0, ...cum), labelFn, height);
  let marks = "";
  for (const ly of layers) {
    const up = ly.hi.map((v, i) => `${f.cx(i)},${f.y(v)}`);
    const down = ly.lo.map((v, i) => `${f.cx(i)},${f.y(v)}`).reverse();
    // tepi berwarna surface = celah antar lapisan (bukan border)
    marks += `<polygon points="${up.join(" ")} ${down.join(" ")}" fill="${colorFn(ly.k)}" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  el.innerHTML = `<svg width="${f.W}" height="${f.H}" role="img">${f.grid}${marks}
    <line class="cross" y1="${f.m.t}" y2="${f.m.t + f.ih}" stroke="var(--ink-2)" style="opacity:0"/>
    <rect x="${f.m.l}" y="${f.m.t}" width="${f.iw}" height="${f.ih}" fill="transparent"/></svg>`;
  attachCrosshair(el, f, rows.length, (ev, i) => {
    if (!ev || i < 0) return;
    const r = rows[i], sorted = keys.slice().sort((a, b) => (valFn(r, b) || 0) - (valFn(r, a) || 0));
    seriesTip(ev, tipTitle(r), sorted, colorFn, valsOf(r, keys, valFn), true, nameFn);
  });
}

// ---------- donut (bagian dari total, maks 6 segmen)
interface DonutSeg { name: string; sec: number; color?: string | null; members?: string[] }

export function donut(el: HTMLElement, items: CatTotal[], total: number): void {
  const MAX = 6;
  let segs: DonutSeg[] = items.filter((c) => c.sec > 0);
  if (segs.length > MAX) {
    const rest = segs.slice(MAX - 1);
    segs = [...segs.slice(0, MAX - 1), { name: "__other__", sec: rest.reduce((a, c) => a + c.sec, 0),
                                         members: rest.map((c) => c.name), color: "var(--s-none)" }];
  }
  const D = 168, R = 64, SW = 22, C = 2 * Math.PI * R, GAP = segs.length > 1 ? 2 : 0;
  let off = 0, arcs = "";
  segs.forEach((c, i) => {
    const len = (c.sec / total) * C, draw = Math.max(0.5, len - GAP);
    arcs += `<circle class="arc" data-i="${i}" cx="${D / 2}" cy="${D / 2}" r="${R}" fill="none" stroke="${c.color || catColor(c.name)}"
      stroke-width="${SW}" stroke-dasharray="${draw} ${C - draw}" stroke-dashoffset="${-off}"
      transform="rotate(-90 ${D / 2} ${D / 2})"/>`;
    off += len;
  });
  el.innerHTML = `<svg width="${D}" height="${D}" role="img" aria-label="${t("cat.title")}">${arcs}
    <text x="${D / 2}" y="${D / 2 - 2}" text-anchor="middle" style="fill:var(--ink);font-size:18px;font-weight:600">${fmtDur(total)}</text>
    <text x="${D / 2}" y="${D / 2 + 16}" text-anchor="middle">${t("active")}</text></svg>`;
  el.querySelectorAll<SVGCircleElement>(".arc").forEach((a) => {
    const c = segs[+a.dataset.i!];
    a.addEventListener("mousemove", (ev) => {
      a.setAttribute("stroke-width", String(SW + 4));
      showTip(ev, tipRow(c.color || catColor(c.name), catLabel(c.name), `${fmtDur(c.sec)} · ${Math.round((c.sec / total) * 100)}%`) +
        (c.members ? `<div class="mt" style="margin-top:4px">${esc(c.members.map(catLabel).join(", "))}</div>` : ""));
    });
    a.addEventListener("mouseleave", () => { a.setAttribute("stroke-width", String(SW)); hideTip(); });
  });
}

// ---------- heatmap hari × jam (rata-rata menit aktif per jam)
const HEAT_BINS = [5, 15, 30, 45]; // menit: <5 → q1, 5–15 → q2, ..., ≥45 → q5

export function heatmap(el: HTMLElement, heat: { weekday_count: number[]; cells: number[][] }): void {
  const order = [...Array(24).keys()].map((h) => (S.dayStartHour + h) % 24);
  const W = Math.max(280, el.clientWidth), m = { l: 34, r: 4, t: 4, b: 22 }, gap = 2;
  const cw = (W - m.l - m.r) / 24, ch = Math.min(26, Math.max(16, cw * 0.9)), H = m.t + 7 * ch + m.b;
  const NAMES = L().wkShort, FULL = L().wkFull;
  let g = "", cells = "";
  NAMES.forEach((n, wd) => { g += `<text x="${m.l - 6}" y="${m.t + wd * ch + ch / 2 + 4}" text-anchor="end">${n}</text>`; });
  order.forEach((h, j) => {
    if (j % (cw < 22 ? 3 : 2) === 0) g += `<text x="${m.l + j * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${pad2(h)}</text>`;
  });
  for (let wd = 0; wd < 7; wd++) {
    const n = heat.weekday_count[wd];
    order.forEach((h, j) => {
      const avgMin = n ? heat.cells[wd][h] / n / 60 : 0;
      const q = avgMin <= 0 ? 0 : 1 + HEAT_BINS.filter((b) => avgMin >= b).length;
      cells += `<rect class="hc" data-w="${wd}" data-h="${h}" x="${m.l + j * cw + gap / 2}" y="${m.t + wd * ch + gap / 2}"
        width="${cw - gap}" height="${ch - gap}" rx="3" fill="var(--q${q})"/>`;
    });
  }
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${t("hours.subHeat")}">${g}${cells}</svg>`;
  el.querySelectorAll<SVGRectElement>(".hc").forEach((c) => {
    c.addEventListener("mousemove", (ev) => {
      const wd = +c.dataset.w!, h = +c.dataset.h!, n = heat.weekday_count[wd], sec = heat.cells[wd][h];
      c.setAttribute("stroke", "var(--ink)"); c.setAttribute("stroke-width", "1.5");
      showTip(ev, `<div class="tt">${FULL[wd]} · ${pad2(h)}:00–${pad2((h + 1) % 24)}:00</div>
        <div class="row">${t("heat.avg")}<b>${n ? fmtDur(sec / n) : "–"}</b></div>
        <div class="row">${t("heat.total", { n, day: FULL[wd] })}<b>${fmtDur(sec)}</b></div>`);
    });
    c.addEventListener("mouseleave", () => { c.removeAttribute("stroke"); hideTip(); });
  });
}

export function heatLegend(): string {
  const labels = ["0", "<5m", "5–15m", "15–30m", "30–45m", "≥45m"];
  return `<span>${t("heat.legend")}</span>` +
    labels.map((l, q) => `<span><i class="sw" style="background:var(--q${q})"></i>${l}</span>`).join("");
}

// ---------- sparkline kecil untuk tile total
export function sparkline(vals: number[]): string {
  if (vals.length < 2) return "";
  const W = 96, H = 32, max = Math.max(...vals, 1);
  const x = (i: number) => 3 + (i / (vals.length - 1)) * (W - 6), y = (v: number) => H - 4 - (v / max) * (H - 8);
  const last = vals.length - 1;
  return `<svg class="spark" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${x(last)}" cy="${y(vals[last])}" r="3.5" fill="var(--dev-1)" stroke="var(--surface)" stroke-width="2"/></svg>`;
}

// ---------- ritme harian: batang mengambang (sumbu Y = jam dalam hari, atas = pagi)
export const LATE_CLOCK = 22;   // aktivitas terakhir lewat jam ini = "malam larut"

export function rangeChart(el: HTMLElement, days: RhythmDay[], lateSec: number): void {
  const W = Math.max(280, el.clientWidth), H = 240, m = { l: 44, r: 8, t: 8, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const lo = Math.max(0, Math.floor(Math.min(...days.map((d) => d.start)) / 3600) - 1) * 3600;
  const hi = Math.min(24, Math.ceil(Math.max(...days.map((d) => d.end), lateSec) / 3600) + 1) * 3600;
  const y = (sec: number) => m.t + ((sec - lo) / (hi - lo)) * ih;
  const band = iw / days.length, bw = Math.min(18, Math.max(3, band * 0.6));
  let g = "", marks = "", hits = "";
  const stepH = (hi - lo) / 3600 > 12 ? 3 : 2;
  for (let s = Math.ceil(lo / 3600 / stepH) * stepH * 3600; s <= hi; s += stepH * 3600) {
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(s)}" y2="${y(s)}" stroke="var(--grid)"/>`;
    g += `<text x="${m.l - 6}" y="${y(s) + 4}" text-anchor="end">${clockOf(s)}</text>`;
  }
  // garis acuan "malam larut"
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(lateSec)}" y2="${y(lateSec)}" stroke="var(--s2)" stroke-opacity=".6"/>`;
  g += `<text x="${W - m.r}" y="${y(lateSec) - 4}" text-anchor="end">${pad2(LATE_CLOCK)}:00</text>`;
  const every = Math.ceil(days.length / Math.max(1, Math.floor(iw / 46)));
  days.forEach((d, i) => {
    const cx = m.l + band * i + band / 2, x = cx - bw / 2, r = Math.min(4, bw / 2);
    const seg = (a: number, b: number) =>
      y(b) - y(a) > 0.5 ? `<rect x="${x}" y="${y(a)}" width="${bw}" height="${y(b) - y(a)}" rx="${r}" fill="var(--s1)"/>` : "";
    if (d.break_start != null) {
      marks += seg(d.start, d.break_start) + seg(d.break_start + d.break, d.end);
      // istirahat: garis tipis penghubung, bukan batang
      marks += `<line x1="${cx}" x2="${cx}" y1="${y(d.break_start)}" y2="${y(d.break_start + d.break)}" stroke="var(--s1)" stroke-opacity=".45" stroke-width="1.5"/>`;
    } else {
      marks += seg(d.start, d.end);
    }
    if (i % every === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(periodLabel(d.day, "day", true))}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${t("rh.title")}">${g}${marks}${hits}</svg>`;
  el.querySelectorAll<SVGRectElement>(".hit").forEach((h) => {
    const d = days[+h.dataset.i!];
    h.addEventListener("mousemove", (ev) => {
      h.setAttribute("fill", "var(--wash)");
      const brk = d.break && d.break_start != null
        ? `${fmtDur(d.break)} (${clockOf(d.break_start)}–${clockOf(d.break_start + d.break)})` : t("rh.noBreak");
      showTip(ev, `<div class="tt">${esc(fmtDate(d.day, true))}</div>
        <div class="row">${t("rh.spanRow")}<b>${clockOf(d.start)} – ${clockOf(d.end)}</b></div>
        <div class="row">${t("rh.active")}<b>${fmtDur(d.active)}</b></div>
        <div class="row">${t("rh.breakRow")}<b>${brk}</b></div>`);
    });
    h.addEventListener("mouseleave", () => { h.setAttribute("fill", "transparent"); hideTip(); });
  });
}
