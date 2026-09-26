// Editor kategori (<dialog>). Disimpan server di data/categories.json (menggantikan config dari repo).
import { api, sendJson } from "./api";
import { $, esc, pad2 } from "./dom";
import { fmtDur } from "./format";
import { L, t } from "./i18n";
import { S, catLabel, hooks } from "./state";
import type { CatMeta, CategoryConfig, CategoryPreview, CategoryRule, WorkConfig } from "./types";

const SLOTS = [2, 3, 4, 5, 6, 7, 8];
const DEFAULT_WORK: WorkConfig = { categories: [], days: [0, 1, 2, 3, 4], start_hour: 8, end_hour: 17, office_devices: [] };
const escRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ED = {
  cfg: null as CategoryConfig | null,
  source: "default" as string,
  dirty: false,
  test: null as CategoryPreview | null,
};
const cfg = (): CategoryConfig => ED.cfg!;
const dialog = () => $<HTMLDialogElement>("#catDialog");
const setErr = (msg: string) => { $("#edErr").textContent = msg; };

async function openEditor(): Promise<void> {
  setErr("");
  const r = await api<{ source: string; config: Partial<CategoryConfig> }>("/api/categories/config");
  const c = structuredClone(r.config);
  ED.cfg = { categories: c.categories ?? [], work: { ...DEFAULT_WORK, ...(c.work ?? {}) } };
  ED.source = r.source; ED.dirty = false; ED.test = null;
  renderEditor();
  dialog().showModal();
}

function ruleHtml(c: CategoryRule, i: number, n: number): string {
  const slots = SLOTS.map((sl) =>
    `<label style="background:var(--s${sl})" title="${sl}"><input type="radio" name="slot${i}" data-i="${i}" data-f="slot" value="${sl}" ${c.slot === sl ? "checked" : ""}><i></i></label>`).join("");
  const opt = (v: string) => `<option value="${v}" ${c.match === v ? "selected" : ""}>${t("ed.m." + v)}</option>`;
  return `<div class="ed-rule">
    <div class="ord"><button type="button" data-act="up" data-i="${i}" ${i ? "" : "disabled"} aria-label="${t("ed.up")}">▲</button>
      <button type="button" data-act="down" data-i="${i}" ${i < n - 1 ? "" : "disabled"} aria-label="${t("ed.down")}">▼</button></div>
    <input data-i="${i}" data-f="name" value="${esc(c.name)}" maxlength="50" aria-label="${t("ed.name")}" placeholder="${t("ed.name")}">
    <input data-i="${i}" data-f="name_en" value="${esc(c.name_en || "")}" maxlength="50" aria-label="${t("ed.nameEn")}" placeholder="${t("ed.nameEn")}">
    <select data-i="${i}" data-f="match" aria-label="${t("ed.match")}">${opt("both")}${opt("app")}${opt("title")}</select>
    <button type="button" class="ed-x" data-act="del" data-i="${i}" aria-label="${t("ed.delete")}" title="${t("ed.delete")}">✕</button>
    <div class="ed-slots" style="grid-column:2/-1" role="radiogroup" aria-label="${t("ed.color")}">${slots}</div>
    <textarea data-i="${i}" data-f="regex" maxlength="4000" spellcheck="false" aria-label="Regex" placeholder="regex, mis. Code\\.exe|GitHub">${esc(c.regex || "")}</textarea>
  </div>`;
}

function renderEditor(): void {
  const c = cfg(), w = c.work, names = c.categories.map((x) => x.name);
  $("#edSource").textContent = t(ED.source === "custom" ? "ed.custom" : "ed.default");
  $<HTMLButtonElement>("#edReset").disabled = ED.source !== "custom";
  const check = (group: string, val: string | number, on: boolean, label: string) =>
    `<label><input type="checkbox" data-w="${group}" value="${esc(String(val))}" ${on ? "checked" : ""}>${esc(label)}</label>`;
  const hours = (f: "start_hour" | "end_hour", from: number, to: number) =>
    `<select data-wf="${f}">${Array.from({ length: to - from + 1 }, (_, k) => from + k)
      .map((h) => `<option value="${h}" ${w[f] === h ? "selected" : ""}>${pad2(h)}:00</option>`).join("")}</select>`;
  $("#edBody").innerHTML = `
    <p class="ed-help">${t("ed.help")}</p>
    <div id="edRules">${c.categories.map((r, i) => ruleHtml(r, i, c.categories.length)).join("")}</div>
    <button class="btn" type="button" data-act="add">${t("ed.add")}</button>
    <div class="ed-sec">${t("ed.work")}</div>
    <div class="ed-work">
      <span>${t("ed.workCats")}</span><div class="ed-checks">${names.map((n) => check("categories", n, w.categories.includes(n), n)).join("")}</div>
      <span>${t("ed.workDays")}</span><div class="ed-checks">${L().wkShort.map((d, k) => check("days", k, w.days.includes(k), d)).join("")}</div>
      <span>${t("ed.workHours")}</span><div style="display:flex;gap:8px;align-items:center;max-width:280px">${hours("start_hour", 0, 23)} ${t("ed.to")} ${hours("end_hour", 1, 24)}</div>
      <span>${t("ed.office")}</span><div class="ed-checks">${S.devices.map((d) => check("office_devices", d.name, w.office_devices.includes(d.name), d.name)).join("")}</div>
    </div>
    <div class="ed-sec" style="display:flex;align-items:center;gap:10px">
      <button class="btn" type="button" data-act="test">${t("ed.test")}</button></div>
    <div id="edTest">${ED.test ? testHtml(ED.test) : ""}</div>`;
}

function testHtml(r: CategoryPreview): string {
  const names = cfg().categories.map((c) => c.name), total = r.per_category.reduce((a, c) => a + c.sec, 0) || 1;
  const sel = (kind: string, val: string) =>
    `<select data-add="${kind}" data-val="${esc(val)}"><option value="">${t("ed.addTo")}</option>${names.map((n) => `<option>${esc(n)}</option>`).join("")}</select>`;
  const list = (items: { app: string; title?: string; sec: number }[], kind: "app" | "title") => items.length
    ? `<table><tbody>${items.map((it) => {
        const val = kind === "app" ? it.app : it.title ?? "";
        return `<tr><td><div class="t">${esc(val)}</div>${kind === "title" ? `<div class="m">${esc(it.app)}</div>` : ""}</td>
          <td class="n">${fmtDur(it.sec)}</td><td>${sel(kind, val)}</td></tr>`;
      }).join("")}</tbody></table>`
    : `<div class="empty">${t("ed.allDone")}</div>`;
  return `<div class="legend" style="margin:0 0 6px">${t("ed.perCat")}:</div><div class="legend" style="margin-bottom:12px">${r.per_category.map((c) =>
      `<span>${esc(catLabel(c.name))} <b>${fmtDur(c.sec)}</b> (${Math.round((c.sec / total) * 100)}%)</span>`).join("")}</div>
    <div class="ed-test"><div><div class="ed-sec" style="margin-top:0">${t("ed.unApps")}</div>${list(r.uncategorized_apps, "app")}</div>
    <div><div class="ed-sec" style="margin-top:0">${t("ed.unTitles")}</div>${list(r.uncategorized_titles, "title")}</div></div>`;
}

async function runTest(): Promise<void> {
  setErr("");
  $("#edTest").innerHTML = `<div class="empty">${t("ed.testing")}</div>`;
  try {
    ED.test = await sendJson<CategoryPreview>("POST", "/api/categories/preview?days=30", cfg());
    renderEditor();
  } catch (e) { $("#edTest").innerHTML = ""; setErr((e as Error).message); }
}

async function afterConfigChange(): Promise<void> {
  S.cats = await api<CatMeta[]>("/api/categories");
  dialog().close();
  await hooks.load();
}

function closeEditor(): void {
  if (!ED.dirty || confirm(t("ed.unsaved"))) { ED.dirty = false; dialog().close(); }
}

export function initEditor(): void {
  const body = $("#edBody");
  // input: ubah model tanpa render ulang (fokus tetap)
  body.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const { i, f, w: grp, wf } = el.dataset;
    if (i != null && f) {
      const rule = cfg().categories[+i];
      if (f === "slot") rule.slot = +el.value;
      else if (f === "name") {
        const old = rule.name; rule.name = el.value;
        cfg().work.categories = cfg().work.categories.map((n) => (n === old ? el.value : n));
      } else if (f === "match") rule.match = el.value as CategoryRule["match"];
      else if (f === "name_en" || f === "regex") rule[f] = el.value;
      ED.dirty = true;
    } else if (grp) {
      const work = cfg().work;
      if (grp === "days") {
        const v = +el.value;
        work.days = el.checked ? [...new Set([...work.days, v])] : work.days.filter((x) => x !== v);
      } else if (grp === "categories" || grp === "office_devices") {
        const arr = work[grp];
        work[grp] = el.checked ? [...new Set([...arr, el.value])] : arr.filter((x) => x !== el.value);
      }
      ED.dirty = true;
    } else if (wf === "start_hour" || wf === "end_hour") {
      cfg().work[wf] = +el.value; ED.dirty = true;
    }
  });
  body.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.f === "name") renderEditor();     // perbarui daftar kategori kerja & "tambah ke"
    if (el.dataset.add && el.value) {                  // tambah item tanpa kategori ke aturan kategori terpilih
      const rule = cfg().categories.find((c) => c.name === el.value);
      if (!rule) return;
      const part = escRe(el.dataset.val ?? "");
      rule.regex = rule.regex ? `${rule.regex}|${part}` : part;
      if (el.dataset.add === "app" && rule.match === "title") rule.match = "both";
      if (el.dataset.add === "title" && rule.match === "app") rule.match = "both";
      ED.dirty = true;
      void runTest();
    }
  });
  body.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button[data-act]");
    if (!b) return;
    const act = b.dataset.act, i = +(b.dataset.i ?? -1), rules = cfg().categories;
    if (act === "test") { void runTest(); return; }
    if (act === "add") {
      rules.push({ name: `${t("ed.new")} ${rules.length + 1}`, name_en: "", slot: SLOTS[rules.length % SLOTS.length], match: "both", regex: "" });
    } else if (act === "del") {
      const [gone] = rules.splice(i, 1);
      cfg().work.categories = cfg().work.categories.filter((n) => n !== gone.name);
    } else if (act === "up" && i > 0) [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
    else if (act === "down" && i < rules.length - 1) [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
    ED.dirty = true;
    renderEditor();
  });

  $("#edSave").addEventListener("click", async () => {
    const b = $<HTMLButtonElement>("#edSave");
    b.disabled = true; b.textContent = t("ed.saving"); setErr("");
    try {
      await sendJson("PUT", "/api/categories/config", cfg());
      ED.dirty = false;
      await afterConfigChange();
    } catch (e) { setErr((e as Error).message); }
    b.disabled = false; b.textContent = t("ed.save");
  });
  $("#edReset").addEventListener("click", async () => {
    if (!confirm(t("ed.resetConfirm"))) return;
    try { await sendJson("DELETE", "/api/categories/config"); ED.dirty = false; await afterConfigChange(); }
    catch (e) { setErr((e as Error).message); }
  });
  $("#edCancel").addEventListener("click", closeEditor);
  $("#edClose").addEventListener("click", closeEditor);
  dialog().addEventListener("cancel", (e) => { e.preventDefault(); closeEditor(); });   // tombol Esc
  $("#catEditBtn").addEventListener("click", () => { openEditor().catch((e: Error) => alert(e.message)); });
}
