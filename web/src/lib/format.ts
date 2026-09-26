// Tanggal (string YYYY-MM-DD, aritmetika di UTC agar bebas zona waktu browser) & durasi.
import type { Group } from "./i18n-dict";
import { L, t } from "./i18n";
import { pad2 } from "./dom";
import { S } from "./state";

export const toD = (s: string): Date => new Date(s + "T00:00:00Z");
export const toS = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
export const diffDays = (a: string, b: string): number => Math.round((toD(b).getTime() - toD(a).getTime()) / 864e5);

export function presetRange(p: string, today: string): [string, string] {
  const d = toD(today);
  switch (p) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "week": return [addDays(today, -((d.getUTCDay() + 6) % 7)), today];
    case "30d": return [addDays(today, -29), today];
    case "90d": return [addDays(today, -89), today];
    case "month": return [today.slice(0, 8) + "01", today];
    case "lastmonth": {
      const first = today.slice(0, 8) + "01", end = addDays(first, -1);
      return [end.slice(0, 8) + "01", end];
    }
    default: return [addDays(today, -6), today];   // "7d"
  }
}

export function autoGroup(from: string, to: string): Group {
  const n = diffDays(from, to) + 1;
  return n > 120 ? "month" : n > 45 ? "week" : "day";
}

export function fmtDate(s: string, withYear = false): string {
  const d = toD(s);
  return `${L().days[d.getUTCDay()]}, ${d.getUTCDate()} ${L().months[d.getUTCMonth()]}${withYear ? " " + d.getUTCFullYear() : ""}`;
}

export function periodLabel(k: string, group: Group, short: boolean): string {
  const d = toD(k);
  if (group === "month") return `${L().months[d.getUTCMonth()]}${short ? "" : " " + d.getUTCFullYear()}`;
  if (group === "week") return `${short ? "" : t("weekOf")}${d.getUTCDate()} ${L().months[d.getUTCMonth()]}`;
  return short ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}` : fmtDate(k);
}

export function fmtDur(sec: number | undefined): string {
  const s = Math.round(sec || 0);
  if (s < 60) return s > 0 ? "<1m" : "0m";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}${L().h} ${pad2(m)}m` : `${m}m`;
}

export const fmtClock = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString(L().locale, { hour: "2-digit", minute: "2-digit", timeZone: S.tz });

/** Detik sejak awal hari logis → "HH:MM" jam dinding. */
export const clockOf = (sec: number): string => {
  const m = Math.round(sec / 60) + S.dayStartHour * 60;
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
};

export const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);
