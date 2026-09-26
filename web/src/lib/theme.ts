// Tema: otomatis → terang → gelap, disimpan per browser (localStorage "awhub-theme").
export type Theme = "auto" | "light" | "dark";
export const THEMES: Theme[] = ["auto", "light", "dark"];

export const THEME_ICON: Record<Theme, string> = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
};

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem("awhub-theme");
    return v === "light" || v === "dark" ? v : "auto";
  } catch { return "auto"; }
}

/** Pasang tema & perbarui tombolnya. label: fungsi terjemahan "theme.<nama>". */
export function applyTheme(theme: Theme, btn: HTMLElement, label: (k: string) => string): void {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("awhub-theme", theme); } catch { /* abaikan */ }
  btn.innerHTML = THEME_ICON[theme] + label("theme." + theme);
  btn.title = label("theme.title") + ": " + label("theme." + theme);
}

export const nextTheme = (): Theme => THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
