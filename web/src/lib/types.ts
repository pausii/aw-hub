// Bentuk respons API server (server/app.py).
import type { Group } from "./i18n-dict";

export type SecMap = Record<string, number>;

export interface Device {
  name: string;
  hostname: string | null;
  last_sync: number | null;
  last_event: number | null;
  agent_version: string | null;
}

export interface CatMeta {
  name: string;
  slot: number | null;
  color: string | null;
  order: number;
  name_en: string | null;
}

export interface AppConfig {
  tz: string;
  day_start_hour: number;
  today: string;
  user: string | null;
  telegram: boolean;
  report_schedule: { weekday: number; hour: number };
  report_lang: string;
}

export interface SeriesRow { period: string; per_device: SecMap }
export interface HourRow { hour: number; per_device: SecMap }
export interface CatTotal { name: string; sec: number; slot: number | null; color: string | null }
export interface AppTotal { app: string; sec: number; per_device: SecMap; category: string }
export interface TitleTotal { app: string; title: string; category: string; sec: number }
export interface RhythmDay {
  day: string; start: number; end: number; active: number; break: number; break_start: number | null;
}
export interface WorkRow { period: string; in_hours?: number; overtime?: number; weekend?: number; personal?: number }
export interface WorkInsight {
  config: { categories: string[]; days: number[]; start_hour: number; end_hour: number; office_devices: string[] };
  work_total: number;
  personal_total: number;
  in_hours: number;
  overtime: number;
  weekend: number;
  personal_in_hours: number;
  work_on_personal_device: number;
  overtime_days: number;
  matrix: Record<string, { work: number; personal: number }>;
  series: WorkRow[];
}

export interface Stats {
  range: { from: string; to: string; days: number; group: Group };
  total: number;
  prev_total: number;
  prev_range: { from: string; to: string };
  filter: { app: string | null; category: string | null; q: string | null };
  active_days: number;
  avg_per_active_day: number;
  per_device: SecMap;
  series: SeriesRow[];
  busiest_day: [string | null, number];
  categories: CatTotal[];
  apps: AppTotal[];
  titles: TitleTotal[];
  hours: HourRow[];
  heat: { weekday_count: number[]; cells: number[][] };
  category_series: { period: string; per_category: SecMap }[];
  work: WorkInsight;
  rhythm: RhythmDay[];
}

export interface Segment {
  device: string; start: number; end: number; active: number; app: string; title: string; category: string;
}
export interface Timeline { day: string; start: number; end: number; segments: Segment[] }

export interface ReportPreview {
  from: string; to: string; text: string; telegram: boolean; report_lang: string; last_sent_week: string | null;
}

// editor kategori
export interface CategoryRule {
  name: string; name_en?: string; slot?: number | null; color?: string; match: "app" | "title" | "both";
  regex: string; ignore_case?: boolean;
}
export interface WorkConfig {
  categories: string[]; days: number[]; start_hour: number; end_hour: number; office_devices: string[];
}
export interface CategoryConfig { categories: CategoryRule[]; work: WorkConfig }
export interface CategoryPreview {
  days: number;
  per_category: { name: string; sec: number }[];
  uncategorized_apps: { app: string; sec: number }[];
  uncategorized_titles: { app: string; title: string; sec: number }[];
}
