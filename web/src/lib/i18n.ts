// Bahasa UI: default en, pilihan disimpan per browser (localStorage "awhub-lang").
import { I18N, type Dict, type Lang } from "./i18n-dict";

let lang: Lang = "en";
try { if (localStorage.getItem("awhub-lang") === "id") lang = "id"; } catch { /* storage diblokir */ }

export const getLang = (): Lang => lang;
export const L = (): Dict => I18N[lang];

export function setLang(next: Lang): void {
  lang = next;
  try { localStorage.setItem("awhub-lang", next); } catch { /* abaikan */ }
}

/** t("kunci", {var}) — kunci yang tidak ada jatuh ke bahasa Inggris, lalu ke kunci itu sendiri. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const v = I18N[lang][key] ?? I18N.en[key] ?? key;
  let str = typeof v === "string" ? v : key;
  if (vars) for (const k in vars) str = str.split(`{${k}}`).join(String(vars[k]));
  return str;
}

/** Terjemahkan elemen statis: data-i18n (teks), -aria, -title, -ph (placeholder). */
export function applyStatic(root: ParentNode = document, tr: (k: string) => string = t): void {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", tr(el.dataset.i18nAria!)));
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => el.setAttribute("title", tr(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", tr(el.dataset.i18nPh!)));
}
