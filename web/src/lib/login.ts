// Halaman login: jam 24 jam dekoratif, tema, bahasa, dan form dengan batas percobaan.
import { $, pad2 } from "./dom";
import { applyStatic, getLang, setLang } from "./i18n";
import { LOGIN_I18N } from "./login-dict";
import { applyTheme, getTheme, nextTheme } from "./theme";

const TZ = "Asia/Jakarta";
const NS = "http://www.w3.org/2000/svg";

function t(key: string, vars?: Record<string, string | number>): string {
  if (key === "theme.title") key = "theme";
  let s = LOGIN_I18N[getLang()][key] ?? LOGIN_I18N.en[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

function applyTexts(): void {
  applyStatic(document, t);
  document.title = (getLang() === "id" ? "Masuk" : "Sign in") + " · AW Hub";
  // hanya teks kamus statis milik halaman ini (berisi <br>), bukan input pengguna
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml!); });
  $("#langLabel").textContent = getLang().toUpperCase();
}

// ---------- tema & bahasa
const themeBtn = $("#themeBtn");
applyTexts();
applyTheme(getTheme(), themeBtn, t);
themeBtn.addEventListener("click", () => applyTheme(nextTheme(), themeBtn, t));
$("#langBtn").addEventListener("click", () => {
  setLang(getLang() === "en" ? "id" : "en");
  applyTexts(); applyTheme(getTheme(), themeBtn, t); tick();
  if (!btn.disabled) btn.textContent = t("signIn");
});

// ---------- jam 24 jam (dekoratif: segmen acak berbiji tetap, bukan data asli)
type Seg = [number, number, string];
function rng(seed: number): () => number {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent.appendChild(n);
  return n;
}
const ang = (h: number) => (h / 24) * 2 * Math.PI - Math.PI / 2;   // 00:00 di atas
const pt = (h: number, r: number): [number, number] => [Math.cos(ang(h)) * r, Math.sin(ang(h)) * r];
function arcPath(h0: number, h1: number, r: number): string {
  const [x0, y0] = pt(h0, r), [x1, y1] = pt(h1, r);
  return `M${x0},${y0} A${r},${r} 0 ${h1 - h0 > 12 ? 1 : 0} 1 ${x1},${y1}`;
}
function segments(rand: () => number, from: number, to: number, colors: string[]): Seg[] {
  const out: Seg[] = [];
  let h = from;
  while (h < to) {
    const len = 0.15 + rand() * 0.9, gap = rand() < 0.2 ? 0.25 + rand() * 0.6 : 0.06;
    out.push([h, Math.min(to, h + len), colors[Math.floor(rand() * colors.length)]]);
    h += len + gap;
  }
  return out;
}

function drawDial(): void {
  const svg = $<SVGSVGElement>("#dial"), rand = rng(20260926);
  svg.innerHTML = "";
  el("circle", { r: 236, fill: "none", stroke: "var(--grid)" }, svg);
  el("circle", { r: 150, fill: "var(--surface)", stroke: "var(--border)" }, svg);
  for (let h = 0; h < 24; h++) {                            // tick jam
    const major = h % 6 === 0, [x0, y0] = pt(h, major ? 222 : 228), [x1, y1] = pt(h, 236);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: major ? "var(--ink-2)" : "var(--muted)", "stroke-width": major ? 2 : 1 }, svg);
    if (major) {
      const [tx, ty] = pt(h, 250);
      el("text", { x: tx, y: ty + 4, "text-anchor": "middle", fill: "var(--muted)", "font-size": 13 }, svg).textContent = pad2(h);
    }
  }
  el("circle", { r: 199, fill: "none", stroke: "var(--dial)", "stroke-width": 26 }, svg);
  el("circle", { r: 168, fill: "none", stroke: "var(--dial)", "stroke-width": 22 }, svg);
  // cincin luar = Kantor (pagi–sore), cincin dalam = Pribadi (malam)
  const cats = ["var(--ring-kantor)", "var(--ring-kantor)", "var(--s7)", "var(--s3)", "var(--s2)", "var(--s6)"];
  const rings = [
    { r: 199, w: 26, segs: segments(rand, 7.6, 12.1, cats).concat(segments(rand, 13, 17.4, cats)) },
    { r: 168, w: 22, segs: segments(rand, 19.2, 23.9, ["var(--ring-pribadi)", "var(--ring-pribadi)", "var(--s5)", "var(--s4)", "var(--s7)"])
        .concat(segments(rand, 24, 25.3, ["var(--ring-pribadi)", "var(--s5)"]).map(([a, b, c]): Seg => [a - 24, b - 24, c])) },
  ];
  let k = 0;
  for (const ring of rings) {
    for (const [a, b, color] of ring.segs) {
      const p = el("path", { d: arcPath(a, b, ring.r), class: "arc", stroke: color, "stroke-width": ring.w }, svg);
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = String(len);
      p.style.transition = `stroke-dashoffset .5s cubic-bezier(.2,.7,.2,1) ${0.25 + k++ * 0.018}s`;
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() =>
    svg.querySelectorAll<SVGPathElement>(".arc").forEach((p) => { p.style.strokeDashoffset = "0"; })));
  // jarum hanya di area cincin, tidak menimpa teks jam di tengah
  el("line", { id: "hand", stroke: "var(--ink)", "stroke-width": 2, "stroke-linecap": "round" }, svg);
  el("circle", { id: "handTip", r: 6, fill: "var(--ink)", stroke: "var(--surface)", "stroke-width": 3 }, svg);
  el("text", { id: "clock", y: -6, "text-anchor": "middle", fill: "var(--ink)", "font-size": 54, "font-weight": 500, "letter-spacing": "-1.5" }, svg);
  el("text", { id: "clockDate", y: 26, "text-anchor": "middle", fill: "var(--ink-2)", "font-size": 14 }, svg);
  el("text", { y: 48, "text-anchor": "middle", fill: "var(--muted)", "font-size": 11, "letter-spacing": "2" }, svg).textContent = "WIB";
  tick();
}

function nowParts() {
  const f = new Intl.DateTimeFormat(t("locale"), {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    weekday: "long", day: "numeric", month: "long",
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { h: +p.hour % 24, m: +p.minute, s: +p.second, label: `${p.weekday}, ${p.day} ${p.month}` };
}

function tick(): void {
  const hand = document.getElementById("hand");
  if (!hand) return;
  const n = nowParts(), hf = n.h + n.m / 60 + n.s / 3600, [x, y] = pt(hf, 232), [x0, y0] = pt(hf, 150);
  hand.setAttribute("x1", String(x0)); hand.setAttribute("y1", String(y0));
  hand.setAttribute("x2", String(x)); hand.setAttribute("y2", String(y));
  $("#handTip").setAttribute("cx", String(x)); $("#handTip").setAttribute("cy", String(y));
  $("#clock").textContent = `${pad2(n.h)}:${pad2(n.m)}`;
  $("#clockDate").textContent = n.label;
  $("#greet").textContent = t(n.h < 4 ? "night" : n.h < 11 ? "morning" : n.h < 15 ? "afternoon" : n.h < 18 ? "evening" : "night");
}
drawDial();
setInterval(tick, 1000);

// ---------- form
const form = $<HTMLFormElement>("#form"), btn = $<HTMLButtonElement>("#submit"), msg = $("#msg");
const pwd = $<HTMLInputElement>("#password");
let lockTimer: number | undefined;

$("#peek").addEventListener("click", () => { pwd.type = pwd.type === "password" ? "text" : "password"; pwd.focus(); });

function showMsg(text: string, remaining?: number): void {
  $("#msgText").textContent = text;
  $("#dots").innerHTML = remaining == null ? ""
    : Array.from({ length: 5 }, (_, i) => `<i class="${i < 5 - remaining ? "on" : ""}"></i>`).join("");
  msg.classList.add("show");
}

function lockFor(sec: number): void {
  clearInterval(lockTimer);
  const until = Date.now() + sec * 1000;
  const upd = () => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    if (!left) { clearInterval(lockTimer); btn.disabled = false; btn.textContent = t("signIn"); msg.classList.remove("show"); return; }
    btn.disabled = true;
    btn.textContent = t("retryIn", { t: `${Math.floor(left / 60)}:${pad2(left % 60)}` });
    showMsg(t("locked"));
  };
  upd();
  lockTimer = window.setInterval(upd, 1000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $<HTMLInputElement>("#username").value.trim(), password = pwd.value;
  if (!username || !password) { showMsg(t("empty")); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + t("checking");
  try {
    const r = await fetch(location.origin + "/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    const data = (await r.json().catch(() => ({}))) as { remaining?: number; retry_after?: number };
    if (r.ok) {
      btn.textContent = t("success");
      const next = new URLSearchParams(location.search).get("next");
      // hanya dashboard sendiri: "/" atau "/#..." (fragmen tak bisa pindah situs) → cegah open redirect
      location.replace(next && /^\/(#.*)?$/.test(next) ? next : "/");
      return;
    }
    pwd.value = ""; pwd.setAttribute("aria-invalid", "true"); pwd.focus();
    if (r.status === 429) { lockFor(data.retry_after || 60); return; }
    showMsg(t("wrong", { n: data.remaining ?? "?" }), data.remaining);
  } catch {
    showMsg(t("network"));
  }
  btn.disabled = false; btn.textContent = t("signIn");   // gagal tanpa terkunci → boleh coba lagi
});
pwd.addEventListener("input", () => pwd.removeAttribute("aria-invalid"));
$("#username").focus();

if ("serviceWorker" in navigator) addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
