// Render tiap kartu dashboard dari objek Stats/Timeline. Semua string data lewat esc().
import { donut, heatLegend, heatmap, lineChart, LATE_CLOCK, rangeChart, sparkline, stackedArea, stackedColumns } from "./charts";
import { $, esc, pad2 } from "./dom";
import { avg, clockOf, fmtClock, fmtDate, fmtDur, pct, periodLabel } from "./format";
import type { Group } from "./i18n-dict";
import { L, t } from "./i18n";
import { S, catColor, catLabel, devColor, hooks, visibleDevices } from "./state";
import { hideTip, showTip, tipRow } from "./tooltip";
import type { Segment, SeriesRow, Stats, WorkRow } from "./types";

const periodOpts = (g: Group) => ({
  labelFn: (r: { period: string }, short: boolean) => periodLabel(r.period, g, short),
  tipTitle: (r: { period: string }) => periodLabel(r.period, g, false),
});
const devLegend = (): string[] =>
  visibleDevices().map((d) => `<span><i class="sw" style="background:${devColor(d)}"></i>${esc(d)}</span>`);
const sumDevs = (r: SeriesRow, devs: string[]) => devs.reduce((a, d) => a + (r.per_device[d] || 0), 0);
const empty = () => `<div class="empty">${t("noData")}</div>`;

// ---------- kontrol filter atas
export function renderControls(): void {
  $("#presets").innerHTML = Object.entries(L().presets).map(([k, l]) =>
    `<button data-p="${k}" aria-pressed="${S.preset === k}">${l}</button>`).join("");
  $("#group").innerHTML = Object.entries(L().groups).map(([k, l]) =>
    `<button data-g="${k}" aria-pressed="${S.group === k}">${l}</button>`).join("");
  const from = $<HTMLInputElement>("#from"), to = $<HTMLInputElement>("#to");
  from.value = S.from; to.value = S.to; from.max = to.max = S.today;
  $("#devChips").innerHTML = S.devices.map((d) =>
    `<button class="chip" data-d="${esc(d.name)}" aria-pressed="${!S.hidden.has(d.name)}">
       <span class="sw" style="background:${devColor(d.name)}"></span>${esc(d.name)}</button>`).join("");
  document.querySelectorAll<HTMLButtonElement>(".seg[data-mode] button").forEach((b) => {
    const mode = (b.parentElement as HTMLElement).dataset.mode as "seriesMode" | "hourMode";
    b.setAttribute("aria-pressed", String(S[mode] === b.dataset.v));
  });
  renderFilterChip();
  $("#rangeLabel").textContent = S.from === S.to ? fmtDate(S.from, true) : `${fmtDate(S.from)} – ${fmtDate(S.to, true)}`;
}

export function renderFilterChip(): void {
  const parts: [string, string, string][] = [];
  if (S.flt.category) parts.push(["category", t("flt.category"), catLabel(S.flt.category)]);
  if (S.flt.app) parts.push(["app", t("flt.app"), S.flt.app.replace(/\.exe$/i, "")]);
  if (S.flt.q) parts.push(["q", t("flt.search"), `“${S.flt.q}”`]);
  $("#filterChip").innerHTML = parts.map(([k, label, v]) =>
    `<span class="fchip">${esc(label)}: <b>${esc(v)}</b><button type="button" data-clear="${k}" aria-label="${t("flt.clear")}" title="${t("flt.clear")}">×</button></span>`).join(" ");
  const search = $<HTMLInputElement>("#search");
  if (document.activeElement !== search) search.value = S.flt.q;
}

export function renderSync(): void {
  const now = Date.now() / 1000;
  const ago = (ts: number | null) => {
    if (!ts) return t("ago.never");
    const m = Math.round((now - ts) / 60);
    return m < 1 ? t("ago.now") : m < 60 ? t("ago.min", { n: m })
      : m < 1440 ? t("ago.hour", { n: Math.round(m / 60) }) : t("ago.day", { n: Math.round(m / 1440) });
  };
  $("#sync").innerHTML = S.devices.map((d) =>
    `<span title="${t("sync.title")}"><b>${esc(d.name)}</b> sync ${ago(d.last_sync)}</span>`).join("");
}

// ---------- KPI
function renderKpis(st: Stats): void {
  const delta = st.prev_total ? (st.total - st.prev_total) / st.prev_total : null;
  const deltaHtml = delta === null ? `<span>${t("kpi.noPrev")}</span>`
    : `<span class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(0)}%</span>
       vs ${fmtDate(st.prev_range.from)} – ${fmtDate(st.prev_range.to)} (${fmtDur(st.prev_total)})`;
  const devs = visibleDevices();
  const split = devs.map((d) => `<span><i class="sw" style="background:${devColor(d)}"></i>${esc(d)}<b>${fmtDur(st.per_device[d])}</b></span>`).join("");
  const [bd, bsec] = st.busiest_day;
  $("#kpis").innerHTML = `
    <div class="card kpi hero"><div class="label">${t("kpi.total")}</div>
      <div class="value">${fmtDur(st.total)}</div>${sparkline(st.series.map((r) => sumDevs(r, devs)))}
      <div class="delta">${deltaHtml}</div></div>
    <div class="card kpi"><div class="label">${t("kpi.avg")}</div>
      <div class="value">${fmtDur(st.avg_per_active_day)}</div>
      <div class="delta">${t("kpi.activeDays", { a: st.active_days, n: st.range.days })}</div></div>
    <div class="card kpi"><div class="label">${t("kpi.perDevice")}</div><div class="split">${split}</div></div>
    <div class="card kpi"><div class="label">${t("kpi.busiest")}</div>
      <div class="value">${bd ? fmtDur(bsec) : "–"}</div>
      <div class="delta">${bd ? fmtDate(bd, true) : ""}</div></div>`;
}

// ---------- waktu aktif per periode
function renderSeries(st: Stats): void {
  const g = st.range.group, devs = visibleDevices();
  $("#seriesSub").textContent = g === "week" ? t("series.perWeek") : L().per[g];
  const opts = { keys: devs, colorFn: devColor, valFn: (r: SeriesRow, k: string) => r.per_device[k], ...periodOpts(g) };
  if (S.seriesMode === "bar") stackedColumns($("#seriesChart"), st.series, opts);
  else lineChart($("#seriesChart"), st.series, { ...opts, totalKey: devs.length > 1 ? t("total") : null });
  const legend = devLegend();
  if (S.seriesMode !== "bar" && devs.length > 1) legend.push(`<span><i class="sw" style="background:var(--ink-2);height:2px"></i>${t("total")}</span>`);
  $("#seriesLegend").innerHTML = devs.length > 1 ? legend.join("") : "";
  $("#seriesTable").innerHTML = `<table><thead><tr><th>${t("period")}</th>${devs.map((d) => `<th class="n">${esc(d)}</th>`).join("")}<th class="n">${t("total")}</th></tr></thead><tbody>` +
    st.series.map((r) => `<tr><td>${esc(periodLabel(r.period, g, false))}</td>${devs.map((d) => `<td class="n">${fmtDur(r.per_device[d])}</td>`).join("")}<td class="n">${fmtDur(sumDevs(r, devs))}</td></tr>`).join("") +
    `</tbody></table>`;
}

// ---------- pola jam: heatmap atau kolom per jam
function renderHours(st: Stats): void {
  if (S.hourMode === "bar") {
    const s = S.dayStartHour, rows = [...st.hours.slice(s), ...st.hours.slice(0, s)];
    stackedColumns($("#hours"), rows, {
      keys: visibleDevices(), colorFn: devColor, valFn: (r, k) => r.per_device[k], height: 200,
      labelFn: (r) => pad2(r.hour),
      tipTitle: (r) => `${pad2(r.hour)}:00 – ${pad2((r.hour + 1) % 24)}:00`,
    });
    $("#hoursSub").textContent = t("hours.subBar");
    $("#hoursLegend").innerHTML = visibleDevices().length > 1 ? devLegend().join("") : "";
  } else {
    heatmap($("#hours"), st.heat);
    $("#hoursSub").textContent = t("hours.subHeat");
    $("#hoursLegend").innerHTML = heatLegend();
  }
}

// ---------- kategori: donut + daftar (klik = filter)
function renderCategories(st: Stats): void {
  const total = st.total || 1, max = Math.max(1, ...st.categories.map((c) => c.sec));
  if (!st.categories.length) {
    $("#catDonut").innerHTML = "";
    $("#categories").innerHTML = empty();
    return;
  }
  donut($("#catDonut"), st.categories, total);
  $("#categories").innerHTML = st.categories.map((c) => `
    <div class="bar-row clickable${S.flt.category === c.name ? " is-active" : ""}" data-cat="${esc(c.name)}" title="${t("clickToFilter")}"><div class="name"><span class="sw" style="background:${catColor(c.name)}"></span>${esc(catLabel(c.name))}</div>
      <div class="track"><div class="fill" style="width:${(c.sec / max) * 100}%;background:${catColor(c.name)}"></div></div>
      <div class="num">${fmtDur(c.sec)} <span class="m">· ${Math.round((c.sec / total) * 100)}%</span></div></div>`).join("");
}

function renderCatTrend(st: Stats): void {
  // urutan lapisan mengikuti config agar warna & posisi stabil antar-filter
  const present = new Set(st.categories.map((c) => c.name));
  const keys = S.cats.map((c) => c.name).filter((n) => present.has(n));
  $("#catTrendSub").textContent = L().per[st.range.group];
  stackedArea($("#catTrend"), st.category_series, {
    keys, colorFn: catColor, valFn: (r, k) => r.per_category[k], nameFn: catLabel, ...periodOpts(st.range.group),
  });
  $("#catTrendLegend").innerHTML = keys.map((k) => `<span><i class="sw" style="background:${catColor(k)}"></i>${esc(catLabel(k))}</span>`).join("");
}

function renderApps(st: Stats): void {
  const devs = visibleDevices(), max = Math.max(1, ...st.apps.map((a) => a.sec)), multi = devs.length > 1;
  $("#apps").innerHTML = st.apps.length ? `<table><thead><tr><th>${t("app")}</th>${multi ? devs.map((d) => `<th class="n">${esc(d)}</th>`).join("") : ""}<th class="n">${t("total")}</th></tr></thead><tbody>` +
    st.apps.map((a) => `<tr class="clickable${S.flt.app === a.app ? " is-active" : ""}" data-app="${esc(a.app)}" title="${t("clickToFilter")}"><td><div class="t"><span class="sw" style="background:${catColor(a.category)};margin-right:6px"></span>${esc(a.app.replace(/\.exe$/i, ""))}</div>
      <div class="inbar" style="width:${(a.sec / max) * 100}%"></div></td>
      ${multi ? devs.map((d) => `<td class="n m">${a.per_device[d] ? fmtDur(a.per_device[d]) : "–"}</td>`).join("") : ""}
      <td class="n">${fmtDur(a.sec)}</td></tr>`).join("") + `</tbody></table>`
    : empty();
}

function renderTitles(st: Stats): void {
  $("#titles").innerHTML = st.titles.length ? `<table><thead><tr><th>${t("title")}</th><th class="n">${t("duration")}</th></tr></thead><tbody>` +
    st.titles.map((it) => `<tr class="clickable" data-q="${esc(it.title)}"><td><div class="t" title="${esc(it.title)}">${esc(it.title || t("untitled"))}</div>
      <div class="m"><span class="sw" style="background:${catColor(it.category)};margin-right:6px;width:8px;height:8px"></span>${esc(it.app.replace(/\.exe$/i, ""))} · ${esc(catLabel(it.category))}</div></td>
      <td class="n">${fmtDur(it.sec)}</td></tr>`).join("") + `</tbody></table>`
    : empty();
}

// ---------- kerja vs pribadi
const WORK_KINDS: [keyof Omit<WorkRow, "period">, string][] =
  [["in_hours", "var(--s1)"], ["overtime", "var(--s2)"], ["weekend", "var(--s4)"], ["personal", "var(--s-none)"]];
const kindColor = Object.fromEntries(WORK_KINDS) as Record<string, string>;
const kindLabel = (k: string) => t("kind." + k);

function renderWork(st: Stats): void {
  const w = st.work, total = st.total;
  if (!w.config.categories.length) {
    $("#workTiles").innerHTML = `<div class="empty" style="grid-column:1/-1">${t("work.empty")}</div>`;
    $("#workChart").innerHTML = $("#workMatrix").innerHTML = $("#workLegend").innerHTML = "";
    return;
  }
  const extra = w.overtime + w.weekend;
  const tile = (label: string, sw: string | null, value: string, note: string) =>
    `<div class="wk-tile"><div class="label">${sw ? `<i class="sw" style="background:${sw}"></i>` : ""}${label}</div>
    <div class="value">${value}</div><div class="note">${note}</div></div>`;
  $("#workTiles").innerHTML =
    tile(t("work.time"), "var(--s1)", fmtDur(w.work_total), t("work.timeNote", { p: pct(w.work_total, total) })) +
    tile(t("work.extra"), "var(--s2)", fmtDur(extra), w.overtime_days ? t("work.otDays", { n: w.overtime_days }) : t("work.noOt")) +
    tile(t("work.personalDev"), null, fmtDur(w.work_on_personal_device),
         t("work.personalDevNote", { p: pct(w.work_on_personal_device, w.work_total) })) +
    tile(t("work.personalHours"), null, fmtDur(w.personal_in_hours), t("work.personalHoursNote"));

  const g = st.range.group;
  $("#workSub").textContent = L().per[g];
  stackedColumns($("#workChart"), w.series, {
    keys: WORK_KINDS.map(([k]) => k), colorFn: (k) => kindColor[k], valFn: (r, k) => r[k as keyof WorkRow] as number | undefined,
    nameFn: kindLabel, ...periodOpts(g), height: 200,
  });
  $("#workLegend").innerHTML = WORK_KINDS.map(([k, c]) => `<span><i class="sw" style="background:${c}"></i>${kindLabel(k)}</span>`).join("");

  // matriks perangkat × kerja/non-kerja
  const devs = visibleDevices().filter((d) => w.matrix[d]);
  $("#workMatrix").innerHTML = devs.length ? `<table><thead><tr><th>${t("device")}</th><th class="n">${t("work")}</th><th class="n">${t("nonWork")}</th></tr></thead><tbody>` +
    devs.map((d) => {
      const m = w.matrix[d], sum = m.work + m.personal || 1;
      const office = w.config.office_devices.includes(d);
      return `<tr><td><span class="sw" style="background:${devColor(d)};margin-right:6px"></span>${esc(d)}
          <div class="m">${t(office ? "officeLaptop" : "personalLaptop")}</div>
          <div class="split-bar"><i style="width:${(m.work / sum) * 100}%;background:var(--s1)"></i><i style="width:${(m.personal / sum) * 100}%;background:var(--s-none)"></i></div></td>
        <td class="n">${fmtDur(m.work)}<div class="m">${pct(m.work, sum)}%</div></td>
        <td class="n">${fmtDur(m.personal)}<div class="m">${pct(m.personal, sum)}%</div></td></tr>`;
    }).join("") + `</tbody></table>` : "";

  const c = w.config;
  const days = c.days.join() === "0,1,2,3,4" ? t("weekdays") : c.days.map((d) => L().wkShort[d]).join(", ");
  $("#workCfg").textContent = t("work.cfg", { days, s: pad2(c.start_hour), e: pad2(c.end_hour), cats: c.categories.map(catLabel).join(", ") });
  const send = $<HTMLButtonElement>("#reportSendBtn");
  send.disabled = !S.cfg?.telegram;
  send.title = t(S.cfg?.telegram ? "report.sendTitle" : "report.notConfigured");
}

// ---------- ritme harian
function renderRhythm(st: Stats): void {
  const days = st.rhythm;
  if (!days.length) {
    $("#rhTiles").innerHTML = "";
    $("#rhChart").innerHTML = `<div class="empty">${t("rh.empty")}</div>`;
    return;
  }
  const lateSec = ((LATE_CLOCK - S.dayStartHour + 24) % 24) * 3600;
  const withBreak = days.filter((d) => d.break > 0);
  const late = days.filter((d) => d.end > lateSec).length;
  const tile = (label: string, value: string, note: string) =>
    `<div class="wk-tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
  $("#rhTiles").innerHTML =
    tile(t("rh.start"), clockOf(avg(days.map((d) => d.start))), t("rh.earliest", { t: clockOf(Math.min(...days.map((d) => d.start))) })) +
    tile(t("rh.end"), clockOf(avg(days.map((d) => d.end))), t("rh.latest", { t: clockOf(Math.max(...days.map((d) => d.end))) })) +
    tile(t("rh.span"), fmtDur(avg(days.map((d) => d.end - d.start))), t("rh.days", { n: days.length })) +
    tile(t("rh.break"), withBreak.length ? fmtDur(avg(withBreak.map((d) => d.break))) : "–", t("rh.days", { n: withBreak.length })) +
    tile(t("rh.late"), `${late}`, t("rh.lateNote"));
  rangeChart($("#rhChart"), days, lateSec);
}

export function renderAll(st: Stats): void {
  renderKpis(st); renderSeries(st); renderHours(st); renderCategories(st); renderCatTrend(st);
  renderApps(st); renderTitles(st); renderWork(st); renderRhythm(st);
}

// ---------- timeline 24 jam
export function renderTimeline(): void {
  const tl = S.tl, el = $("#timeline"), devs = visibleDevices();
  if (!tl || !S.tlDay) return;
  const dayInput = $<HTMLInputElement>("#tlDay");
  dayInput.value = S.tlDay; dayInput.max = S.today;
  $<HTMLButtonElement>("#tlNext").disabled = S.tlDay >= S.today;
  const segs = tl.segments.filter((s) => devs.includes(s.device));
  const byDev = devs.map((d) => segs.filter((s) => s.device === d).reduce((a, s) => a + s.active, 0));
  $("#tlSub").textContent = t("tl.sub", { date: fmtDate(S.tlDay, true), h: pad2(S.dayStartHour), dur: fmtDur(byDev.reduce((a, b) => a + b, 0)) });
  const W = Math.max(280, el.clientWidth), rowH = 26, gapR = 10, m = { l: 90, r: 8, t: 4, b: 22 };
  const H = m.t + devs.length * (rowH + gapR) - gapR + m.b, iw = W - m.l - m.r;
  const span = tl.end - tl.start, x = (ts: number) => m.l + ((ts - tl.start) / span) * iw;
  let g = "";
  const tickEvery = iw < 500 ? 4 : 2;
  for (let h = 0; h <= 24; h += tickEvery) {
    const xx = m.l + (h / 24) * iw;
    g += `<line x1="${xx}" x2="${xx}" y1="${m.t}" y2="${H - m.b}" stroke="var(--grid)"/>`;
    g += `<text x="${xx}" y="${H - 6}" text-anchor="middle">${pad2((S.dayStartHour + h) % 24)}</text>`;
  }
  devs.forEach((d, i) => {
    const y0 = m.t + i * (rowH + gapR);
    g += `<rect x="${m.l}" y="${y0}" width="${iw}" height="${rowH}" fill="var(--wash)" rx="4"/>`;
    g += `<text x="${m.l - 8}" y="${y0 + rowH / 2 + 4}" text-anchor="end" style="fill:var(--ink-2);font-size:12px">${esc(d)}</text>`;
  });
  let marks = "";
  segs.forEach((s, k) => {
    const y0 = m.t + devs.indexOf(s.device) * (rowH + gapR);
    const x0 = x(s.start), w = Math.max(1, x(s.end) - x0);
    marks += `<rect class="seg" data-k="${k}" x="${x0}" y="${y0}" width="${w}" height="${rowH}" fill="${catColor(s.category)}"/>`;
  });
  el.innerHTML = segs.length || devs.length
    ? `<svg width="${W}" height="${H}" role="img" aria-label="${t("timeline.title")}">${g}${marks}</svg>` +
      (segs.length ? "" : `<div class="empty">${t("tl.empty")}</div>`)
    : "";
  const svg = el.querySelector("svg");
  if (svg) {
    // hit target dicari dari posisi kursor agar segmen sangat tipis tetap bisa di-hover
    let hovered: Segment | null = null;   // segmen di bawah kursor → klik = filter aplikasinya
    svg.addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      const i = Math.floor((py - m.t) / (rowH + gapR));
      hovered = null; svg.style.cursor = "";
      if (i < 0 || i >= devs.length || py - m.t - i * (rowH + gapR) > rowH) return hideTip();
      let best: Segment | null = null, bestDist = 4;
      for (const s of segs) {
        if (s.device !== devs[i]) continue;
        const a = x(s.start), b = x(s.end), dist = px < a ? a - px : px > b ? px - b : 0;
        if (dist < bestDist || (dist === 0 && bestDist === 0 && best && b - a < x(best.end) - x(best.start))) { best = s; bestDist = dist; }
      }
      if (!best) return hideTip();
      hovered = best; svg.style.cursor = "pointer";
      showTip(ev, `<div class="tt">${esc(best.app.replace(/\.exe$/i, ""))}</div>
        <div class="mt">${esc(best.title)}</div>
        ${tipRow(catColor(best.category), catLabel(best.category), "")}
        <div class="row">${fmtClock(best.start)} – ${fmtClock(best.end)} · ${esc(best.device)}<b>${fmtDur(best.active)}</b></div>`);
    });
    svg.addEventListener("mouseleave", () => { hovered = null; hideTip(); });
    svg.addEventListener("click", () => { if (hovered) hooks.setFilter("app", hovered.app); });
  }
  const used = new Set(segs.map((s) => s.category));
  $("#catLegend").innerHTML = S.cats.filter((c) => used.has(c.name))
    .map((c) => `<span><i class="sw" style="background:${catColor(c.name)}"></i>${esc(catLabel(c.name))}</span>`).join("");
}
