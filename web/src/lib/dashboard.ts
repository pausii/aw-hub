// Entry dashboard: state URL (hash), pemuatan data, dan semua event handler.
import { api } from "./api";
import { $ } from "./dom";
import { initEditor } from "./editor";
import { addDays, autoGroup, presetRange } from "./format";
import type { Group } from "./i18n-dict";
import { applyStatic, getLang, L, setLang, t } from "./i18n";
import { renderAll, renderControls, renderSync, renderTimeline } from "./render";
import { S, hooks, visibleDevices, type FilterState } from "./state";
import { applyTheme, getTheme, nextTheme } from "./theme";
import { hideTip } from "./tooltip";
import { initUpdateCheck } from "./update";
import type { AppConfig, CatMeta, Device, ReportPreview, Stats, Timeline } from "./types";

// ---------- state <-> URL hash (tampilan bisa di-bookmark)
function readHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("from") && p.get("to")) { S.from = p.get("from")!; S.to = p.get("to")!; S.preset = p.get("preset"); }
  const g = p.get("group");
  if (g === "day" || g === "week" || g === "month") S.group = g;
  if (p.get("hide")) S.hidden = new Set(p.get("hide")!.split(","));
  if (p.get("day")) S.tlDay = p.get("day");
  if (p.get("sm") === "bar") S.seriesMode = "bar";
  if (p.get("hm") === "bar") S.hourMode = "bar";
  S.flt = { category: p.get("fcat"), app: p.get("fapp"), q: p.get("q") ?? "" };
}

function writeHash(): void {
  const p = new URLSearchParams({ from: S.from, to: S.to, group: S.group });
  if (S.preset) p.set("preset", S.preset);
  if (S.hidden.size) p.set("hide", [...S.hidden].join(","));
  if (S.tlDay) p.set("day", S.tlDay);
  if (S.seriesMode !== "line") p.set("sm", S.seriesMode);
  if (S.hourMode !== "heat") p.set("hm", S.hourMode);
  if (S.flt.category) p.set("fcat", S.flt.category);
  if (S.flt.app) p.set("fapp", S.flt.app);
  if (S.flt.q) p.set("q", S.flt.q);
  history.replaceState(null, "", "#" + p);
}

function addFilterParams(qs: URLSearchParams): void {
  if (S.flt.category) qs.set("category", S.flt.category);
  if (S.flt.app) qs.set("app", S.flt.app);
  if (S.flt.q) qs.set("q", S.flt.q);
}

// ---------- pemuatan data
let loadSeq = 0;
async function load(): Promise<void> {
  const seq = ++loadSeq;
  writeHash(); renderControls();
  const qs = new URLSearchParams({ from: S.from, to: S.to, group: S.group, top: "15" });
  if (S.hidden.size) qs.set("devices", visibleDevices().join(","));
  addFilterParams(qs);
  try {
    const st = await api<Stats>("/api/stats?" + qs);
    if (seq !== loadSeq) return;      // respons usang (filter sudah berganti)
    S.stats = st;
    $("#error").classList.add("hidden");
    renderAll(st);
    if (!S.tlDay || S.tlDay < S.from || S.tlDay > S.to) S.tlDay = S.to;
    await loadTimeline();
  } catch (e) {
    $("#error").textContent = t("loadFail") + (e as Error).message;
    $("#error").classList.remove("hidden");
  }
}

async function loadTimeline(): Promise<void> {
  writeHash();
  const qs = new URLSearchParams({ day: S.tlDay! });
  if (S.hidden.size) qs.set("devices", visibleDevices().join(","));
  addFilterParams(qs);
  S.tl = await api<Timeline>("/api/timeline?" + qs);
  renderTimeline();
}

/** Klik item yang sama sekali lagi untuk mematikan filternya. */
function setFilter(kind: keyof FilterState, value: string): void {
  if (kind === "q") S.flt.q = S.flt.q === value ? "" : value;
  else S.flt[kind] = S.flt[kind] === value ? null : value;
  if (kind === "q") $<HTMLInputElement>("#search").value = S.flt.q;
  hideTip();
  void load();
}
hooks.load = load;
hooks.setFilter = setFilter;

// ---------- kontrol atas
$("#presets").addEventListener("click", (e) => {
  const p = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.p;
  if (!p) return;
  S.preset = p; [S.from, S.to] = presetRange(p, S.today); S.group = autoGroup(S.from, S.to);
  S.tlDay = null; void load();
});
$("#group").addEventListener("click", (e) => {
  const g = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.g as Group | undefined;
  if (!g) return;
  S.group = g; void load();
});
for (const id of ["#from", "#to"]) {
  $(id).addEventListener("change", () => {
    let f = $<HTMLInputElement>("#from").value, to = $<HTMLInputElement>("#to").value;
    if (!f || !to) return;
    if (to < f) [f, to] = [to, f];
    S.from = f; S.to = to; S.preset = null; S.group = autoGroup(f, to); S.tlDay = null; void load();
  });
}
$("#devChips").addEventListener("click", (e) => {
  const d = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.d;
  if (!d) return;
  if (S.hidden.has(d)) S.hidden.delete(d);
  else if (visibleDevices().length > 1) S.hidden.add(d);   // minimal satu perangkat tetap tampil
  void load();
});
$("#seriesToggle").addEventListener("click", () => {
  const hiddenNow = $("#seriesTable").classList.toggle("hidden");
  $("#seriesChart").classList.toggle("hidden", !hiddenNow);
  $("#seriesToggle").textContent = t(hiddenNow ? "viewTable" : "viewChart");
});
$("#tlDay").addEventListener("change", () => {
  const v = $<HTMLInputElement>("#tlDay").value;
  if (v) { S.tlDay = v; void loadTimeline(); }
});
$("#tlPrev").addEventListener("click", () => { S.tlDay = addDays(S.tlDay!, -1); void loadTimeline(); });
$("#tlNext").addEventListener("click", () => { if (S.tlDay! < S.today) { S.tlDay = addDays(S.tlDay!, 1); void loadTimeline(); } });
// toggle bentuk chart: cukup render ulang dari data yang ada, tanpa fetch
document.querySelectorAll<HTMLElement>(".seg[data-mode]").forEach((seg) => seg.addEventListener("click", (e) => {
  const v = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.v;
  if (!v) return;
  if (seg.dataset.mode === "seriesMode") S.seriesMode = v as typeof S.seriesMode;
  else S.hourMode = v as typeof S.hourMode;
  writeHash(); renderControls();
  if (S.stats) renderAll(S.stats);
}));

// ---------- filter klik + pencarian
$("#filterChip").addEventListener("click", (e) => {
  const k = (e.target as Element).closest<HTMLButtonElement>("button")?.dataset.clear as keyof FilterState | undefined;
  if (!k) return;
  if (k === "q") { S.flt.q = ""; $<HTMLInputElement>("#search").value = ""; } else S.flt[k] = null;
  void load();
});
let searchTimer: number | undefined;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const v = $<HTMLInputElement>("#search").value.trim();
    if (v !== S.flt.q) { S.flt.q = v; void load(); }
  }, 400);
});
$("#categories").addEventListener("click", (e) => {
  const c = (e.target as Element).closest<HTMLElement>("[data-cat]")?.dataset.cat;
  if (c) setFilter("category", c);
});
$("#catDonut").addEventListener("click", (e) => {
  const a = (e.target as Element).closest<SVGElement>(".arc");
  if (!a) return;
  const cats = S.stats ? S.stats.categories.filter((c) => c.sec > 0) : [], i = +(a.dataset.i ?? -1);
  if (cats.length > 6 && i === 5) return;   // segmen gabungan "Lain-lain" tidak bisa difilter
  if (cats[i]) setFilter("category", cats[i].name);
});
$("#apps").addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLElement>("[data-app]")?.dataset.app;
  if (a) setFilter("app", a);
});
$("#titles").addEventListener("click", (e) => {
  const q = (e.target as Element).closest<HTMLElement>("[data-q]")?.dataset.q;
  if (q) setFilter("q", q);
});

// ---------- tema, bahasa, keluar
const themeBtn = $("#themeBtn");
applyTheme(getTheme(), themeBtn, t);
themeBtn.addEventListener("click", () => applyTheme(nextTheme(), themeBtn, t));
applyStatic();
$("#langLabel").textContent = getLang().toUpperCase();
$("#langBtn").addEventListener("click", () => {
  setLang(getLang() === "en" ? "id" : "en");
  applyStatic();
  $("#langLabel").textContent = getLang().toUpperCase();
  $("#seriesToggle").textContent = t($("#seriesTable").classList.contains("hidden") ? "viewTable" : "viewChart");
  applyTheme(getTheme(), themeBtn, t);
  if (!S.today) return;
  renderControls(); renderSync();
  if (S.stats) renderAll(S.stats);
  if (S.tl) renderTimeline();
  const box = $("#reportPreview");
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); $("#reportPreviewBtn").click(); }
});
$("#logoutBtn").addEventListener("click", async () => {
  try { await fetch(location.origin + "/api/logout", { method: "POST", credentials: "same-origin" }); } catch { /* tetap keluar */ }
  location.href = "/login";
});

// ---------- ringkasan mingguan: pratinjau & kirim
$("#reportPreviewBtn").addEventListener("click", async () => {
  const box = $("#reportPreview");
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  box.textContent = t("loading"); box.classList.remove("hidden");
  try {
    const r = await api<ReportPreview>("/api/report/preview");
    const sched = S.cfg!.report_schedule;
    const head = S.cfg!.telegram
      ? t("report.auto", { day: L().wkFull[sched.weekday], h: String(sched.hour).padStart(2, "0"), lang: r.report_lang.toUpperCase() }) +
        (r.last_sent_week ? t("report.last", { w: r.last_sent_week }) : "")
      : t("report.previewOnly");
    // DOMParser menghasilkan dokumen inert: tag/atribut di teks laporan tidak pernah dieksekusi
    const plain = new DOMParser().parseFromString(r.text, "text/html").body.textContent ?? "";
    box.textContent = `${head}\n${"─".repeat(40)}\n${plain}`;
  } catch (e) { box.textContent = t("report.previewFail") + (e as Error).message; }
});
$("#reportSendBtn").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("#reportSendBtn"), old = b.textContent;
  b.disabled = true; b.textContent = t("sending");
  try {
    const r = await fetch(location.origin + "/api/report/send", { method: "POST", credentials: "same-origin" });
    const d = (await r.json().catch(() => ({}))) as { detail?: string };
    b.textContent = t(r.ok ? "sent" : "failed");
    if (!r.ok) alert(t("sendFail") + (d.detail || r.status));
  } catch { b.textContent = t("failed"); }
  setTimeout(() => { b.textContent = old; b.disabled = false; }, 2500);
});

initEditor();
initUpdateCheck();

// ---------- mulai
async function init(): Promise<void> {
  const [cfg, devices, cats] = await Promise.all([
    api<AppConfig>("/api/config"), api<Device[]>("/api/devices"), api<CatMeta[]>("/api/categories"),
  ]);
  S.today = cfg.today; S.tz = cfg.tz; S.dayStartHour = cfg.day_start_hour; S.cfg = cfg;
  S.devices = devices; S.cats = cats;
  readHash();
  S.hidden = new Set([...S.hidden].filter((h) => devices.some((d) => d.name === h)));
  if (!S.from) { [S.from, S.to] = presetRange(S.preset ?? "7d", S.today); S.group = autoGroup(S.from, S.to); }
  renderSync();
  await load();
}

let rz: number | undefined;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = window.setTimeout(() => { if (S.stats) renderAll(S.stats); if (S.tl) renderTimeline(); }, 150);
});
init().catch((e: Error) => { $("#error").textContent = t("loadFail") + e.message; $("#error").classList.remove("hidden"); });

// PWA: service worker hanya meng-cache aset statis & halaman offline
if ("serviceWorker" in navigator) addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
