import { t } from "./i18n";

/** GET JSON. 401 → kembali ke halaman login (sesi habis). Pakai origin agar URL berkredensial tak ditolak fetch. */
export async function api<T>(path: string): Promise<T> {
  const r = await fetch(location.origin + path, { credentials: "same-origin" });
  if (r.status === 401) {
    location.href = "/login?next=" + encodeURIComponent("/" + location.hash);
    throw new Error(t("sessionEnded"));
  }
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

interface ErrDetail { loc?: (string | number)[]; msg: string }

/** POST/PUT/DELETE JSON; pesan error validasi FastAPI (422) dirangkai jadi satu kalimat. */
export async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(location.origin + path, {
    method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as { detail?: string | ErrDetail[] } & T;
  if (!r.ok) {
    const det = d.detail;
    throw new Error(typeof det === "string" ? det
      : (det ?? []).map((x) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`).join("; ") || `HTTP ${r.status}`);
  }
  return d;
}
