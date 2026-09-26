import { $, esc } from "./dom";

let tipEl: HTMLElement | null = null;
const tip = (): HTMLElement => (tipEl ??= $("#tip"));

export function showTip(ev: MouseEvent, html: string): void {
  const el = tip();
  el.innerHTML = html;
  el.style.opacity = "1";
  const r = el.getBoundingClientRect(), pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  el.style.left = Math.max(8, x) + "px";
  el.style.top = Math.max(8, y) + "px";
}

export const hideTip = (): void => { tip().style.opacity = "0"; };

export const tipRow = (sw: string, label: string, val: string): string =>
  `<div class="row"><span class="sw" style="background:${sw}"></span>${esc(label)}<b>${val}</b></div>`;
