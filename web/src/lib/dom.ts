// Util DOM kecil. Semua data dari server/laptop WAJIB lewat esc() sebelum masuk innerHTML.

export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Elemen tidak ditemukan: ${sel}`);
  return el;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n: number): string => String(n).padStart(2, "0");
