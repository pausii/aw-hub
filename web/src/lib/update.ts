// Deteksi versi baru saat dashboard/PWA sedang terbuka: bandingkan __BUILD_ID__ (ditanam saat build)
// dengan /version.json di server. Tidak ada reload paksa — pengguna memilih kapan memuat ulang
// (filter & rentang tanggal tetap aman karena tersimpan di URL hash).
import { $ } from "./dom";

const CHECK_EVERY = 10 * 60_000;   // ms
const MIN_GAP = 60_000;            // jangan cek lebih sering dari ini (fokus/visibility bisa beruntun)

let lastCheck = 0;
let shown = false;

async function check(): Promise<void> {
  if (shown || Date.now() - lastCheck < MIN_GAP || !navigator.onLine) return;
  lastCheck = Date.now();
  try {
    const r = await fetch(location.origin + "/version.json", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return;
    const { build } = (await r.json()) as { build?: string };
    if (build && build !== __BUILD_ID__) show();
  } catch { /* offline / server sedang deploy: coba lagi nanti */ }
}

function show(): void {
  shown = true;
  $("#updateToast").classList.remove("hidden");
}

export function initUpdateCheck(): void {
  $("#updateReload").addEventListener("click", () => location.reload());
  $("#updateLater").addEventListener("click", () => {
    $("#updateToast").classList.add("hidden");
    // tawarkan lagi nanti, bukan langsung di pemeriksaan berikutnya
    setTimeout(() => { shown = false; }, CHECK_EVERY * 3);
  });
  setInterval(check, CHECK_EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  addEventListener("focus", () => void check());
  addEventListener("online", () => void check());
}
