// State dashboard + pemetaan warna/label. Warna mengikuti entitas, bukan peringkat.
import type { Group } from "./i18n-dict";
import type { AppConfig, CatMeta, Device, Stats, Timeline } from "./types";
import { getLang, t } from "./i18n";

export interface FilterState { category: string | null; app: string | null; q: string }

export const S = {
  from: "" as string,
  to: "" as string,
  group: "day" as Group,
  preset: "7d" as string | null,
  hidden: new Set<string>(),
  tlDay: null as string | null,
  today: "" as string,
  tz: "Asia/Jakarta",
  dayStartHour: 4,
  devices: [] as Device[],
  cats: [] as CatMeta[],
  cfg: null as AppConfig | null,
  stats: null as Stats | null,
  tl: null as Timeline | null,
  seriesMode: "line" as "line" | "bar",
  hourMode: "heat" as "heat" | "bar",
  flt: { category: null, app: null, q: "" } as FilterState,
};

/** Titik sambung antar-modul (diisi dashboard.ts) agar tidak ada import melingkar. */
export const hooks = {
  load: async (): Promise<void> => {},
  setFilter: (_kind: keyof FilterState, _value: string): void => {},
};

export const visibleDevices = (): string[] => S.devices.map((d) => d.name).filter((n) => !S.hidden.has(n));

// perangkat: ramp biru terurut nama; kategori: slot palet dari config
export const devColor = (name: string): string =>
  `var(--dev-${(S.devices.findIndex((d) => d.name === name) % 4) + 1})`;

export function catColor(name: string): string {
  const c = S.cats.find((x) => x.name === name);
  if (c?.color) return c.color;
  return c?.slot ? `var(--s${c.slot})` : "var(--s-none)";
}

/** Label kategori sesuai bahasa: name_en saat EN; "__other__" = gabungan segmen kecil di donut. */
export function catLabel(name: string): string {
  if (name === "__other__") return t("other");
  const c = S.cats.find((x) => x.name === name);
  return getLang() === "en" && c?.name_en ? c.name_en : name;
}
