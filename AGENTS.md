# AGENTS.md

Panduan kerja untuk AI agent (Claude Code, Codex, Cursor, dll.) di repo **AW Hub**.
Baca seluruh file ini sebelum mengubah apa pun. Bila ada, baca juga **`AGENTS.local.md`**: catatan operasional
instalasi setempat (server, perangkat, isu terbuka) yang sengaja tidak di-commit. Bila tugasmu **memasang agent
di laptop Linux**, langsung ke [bagian 5](#5-tugas-pasang-agent-di-laptop-linux).

Balas pengguna dalam **bahasa Indonesia**, ringkas.

---

## 1. Apa ini

Dashboard gabungan [ActivityWatch](https://activitywatch.net) untuk dua laptop yang dipakai bergantian:

| Device (`device_name`) | Contoh | Installer |
| --- | --- | --- |
| `Kantor` | laptop kantor, Windows | `agent/install-windows.ps1` (Scheduled Task) |
| `Pribadi` | laptop pribadi, Linux | `agent/install-linux.sh` (systemd user timer) |

```
Laptop (ActivityWatch lokal :5600)
   └─ agent/aw_hub_agent.py  — tiap 15 menit, HTTPS + Bearer token
        └─► Cloudflare ─► nginx (host, HANYA IP Cloudflare) ─► container app 127.0.0.1:8077 ─► SQLite
                                                   └─ dashboard (/login, cookie sesi) + Telegram mingguan
```

- **Agent** menjalankan query ActivityWatch: event window yang beririsan dengan status `not-afk`
  (sama dengan web UI AW). Hasilnya digabung (app+judul sama, jeda ≤ 1 detik) lalu dikirim
  per potongan **1 hari UTC** ke `POST /api/ingest`.
- **Server** mengganti (replace) semua event device itu di periode tersebut, jadi pengiriman ulang
  aman dan tidak menghasilkan data ganda. Progres agent disimpan di `agent/state.json` (`synced_until`).
  Setiap run mengulang 1 hari terakhir.
- **Kategori** dihitung saat dashboard dibuka (bukan saat ingest), jadi perubahan aturan berlaku juga untuk data lama.

## 2. Peta file

| Path | Isi |
| --- | --- |
| `server/app.py` | FastAPI: ingest, login/logout, statistik (`/api/stats` termasuk `work`, `rhythm`, filter; `/api/timeline`, `/api/devices`, `/api/categories`, `/api/config`), editor kategori (`/api/categories/config` GET/PUT/DELETE, `/api/categories/preview`), laporan (`/api/report/preview`, `/api/report/send`) + thread penjadwal, aset publik, security headers/CSP |
| `server/auth.py` | `PasswordCheck` (password biasa / bcrypt), sesi cookie bertanda tangan HMAC, `LoginLimiter` (batas percobaan, in-memory) |
| `server/hashpw.py` | Membuat hash bcrypt untuk `AW_HUB_DASH_PASSWORD` |
| `server/Dockerfile` | Multi-stage, **build context = root repo**: tahap `node` membangun `web/` → `dist` disalin ke `/app/static` pada image Python (tanpa Node di image akhir). Jalan sebagai **uid 10001** |
| `server/report.py` | Teks ringkasan mingguan & kirim ke Telegram |
| `web/` | **Frontend: Astro 7 + TypeScript (strict) + Tailwind CSS 4**, situs statis (`build.format: "file"` → `index.html`, `login.html`, `offline.html`, `_astro/*`). Interaksi = vanilla TS (tanpa framework UI), chart = SVG buatan sendiri |
| `web/src/pages/` | `index.astro` (dashboard), `login.astro`, `offline.astro` |
| `web/src/layouts/Base.astro` | `<head>` bersama + script `is:inline` pemasang tema/bahasa sebelum render (satu-satunya script inline) |
| `web/src/lib/` | `dashboard.ts` (entry: hash URL, load, event), `render.ts` (kartu), `charts.ts` (SVG), `editor.ts`, `login.ts`, `i18n.ts` + `i18n-dict.ts`/`login-dict.ts` (kamus), `state.ts`, `format.ts`, `api.ts`, `theme.ts`, `tooltip.ts`, `types.ts` (bentuk respons API) |
| `web/src/styles/global.css` | Token warna (terang/gelap) → `@theme` Tailwind (`bg-surface`, `text-ink`, `border-line`, …), breakpoint `sm`=561px `md`=901px, layer `components` untuk markup yang dibuat dari TS |
| `web/public/` | `icons/`, `manifest.webmanifest`, `sw.js` — disalin apa adanya ke `dist/`; publik tanpa login (`PUBLIC_FILES`, `/icons/{name}`, `/_astro/{name}` di `app.py`) |
| `deploy/make-icons.py` | Generator favicon & ikon PWA (Pillow) |
| `data/categories.json` (server) | Aturan hasil editor dashboard; bila ada, **menggantikan** `config/categories.json`. Hapus = kembali ke default |
| `config/categories.json` | Aturan kategori (regex, urutan = prioritas, `slot` warna 2–8) + bagian `work` (kategori kerja, hari & jam kerja, laptop kantor). Di-reload otomatis saat file berubah |
| `agent/aw_hub_agent.py` | Agent. **Hanya standard library Python**, jangan tambah dependency |
| `agent/install-windows.ps1` | Installer Scheduled Task (Windows PowerShell 5.1) |
| `agent/install-linux.sh` | Installer systemd *user* timer |
| `agent/config.json`, `state.json`, `*.log` | Lokal per laptop, ada di `.gitignore`, **jangan di-commit** |
| `docker-compose.yml` | Service `app` (bind `127.0.0.1:${AW_HUB_PORT:-8077}`); `caddy` opsional via `--profile caddy` |
| `deploy/nginx-aw-hub.conf` | Vhost nginx di belakang Cloudflare (`include` snippet IP Cloudflare, `server_tokens off`) |
| `deploy/update-cloudflare-ips.sh` | Membuat `/etc/nginx/snippets/cloudflare-only.conf` dari daftar IP resmi Cloudflare, lalu `nginx -t` + reload (aman diulang) |
| `.env.example` | Variabel server. `.env` asli hanya ada di server |

## 3. Aturan

- **Rahasia:** jangan pernah menulis `AW_HUB_INGEST_TOKEN`, password dashboard, atau isi `.env` ke file yang
  di-commit, ke dokumentasi, maupun ke pesan commit. Token hanya boleh ada di `agent/config.json` (chmod 600)
  dan di `/opt/aw-hub/.env` di server. Kalau butuh token, **minta ke pengguna**.
- Jangan `git commit` / `git push` kecuali diminta pengguna. Pesan commit berbahasa Indonesia.
- `device_name` **jangan diubah** setelah data terkirim. Nama itu menjadi kunci data di server,
  jadi mengubahnya berarti membuat device baru.
- Agent harus tetap kompatibel dengan Python 3.9+ dan hanya memakai stdlib.
- Server: modul `.py` baru di `server/` otomatis ikut ke image (`COPY *.py`). Folder lain **wajib** ditambahkan ke
  `Dockerfile`. Dependency Python → `server/requirements.txt`; dependency frontend → `web/package.json` (commit
  `package-lock.json` juga, karena image memakai `npm ci`).
- Frontend: ubah di `web/src`, **bukan** di hasil build. Semua data dari server/laptop yang masuk ke `innerHTML`
  wajib lewat `esc()` (`lib/dom.ts`). Jalankan `npm run typecheck` dan `npm run build` sebelum commit.
- Tailwind: utilitas `hidden` (layer `utilities`) selalu menang atas aturan di layer `components`. Elemen yang
  tampil/sembunyinya diatur lewat class komponen (mis. `.msg.show`) jangan diberi utilitas `hidden`.
  Gaya teks SVG chart hanya berlaku di dalam `body.dash` (supaya tidak mengenai SVG jam di halaman login).
- Server Linux dipakai bersama layanan lain (grafana, meeting-ai, dll.). Jangan menyentuh vhost nginx,
  container, maupun port selain milik AW Hub. Jalankan `nginx -t` sebelum `systemctl reload nginx`.
- Dashboard: warna mengikuti entitas, bukan peringkat. Perangkat memakai `--dev-N` (ramp biru),
  kategori memakai `--s2..--s8` (slot 1/biru dicadangkan untuk perangkat). Teks tidak memakai warna data.
  Setiap token warna wajib punya versi dark mode.
- Bila menemukan masalah di luar cakupan permintaan, laporkan saja. Jangan langsung diperbaiki tanpa konfirmasi.
- Auth: semua endpoint dashboard memakai `require_dashboard` (cookie). Endpoint baru **wajib** diberi dependency itu.
  Yang publik hanya: `/healthz`, `/robots.txt`, `/login`, `/api/login`, `/api/ingest` (Bearer token), dan aset statis
  tanpa data pengguna (`PUBLIC_FILES`: favicon, manifest, `sw.js`, `offline.html`, serta `/icons/{name}`).
  Jangan kembali ke HTTP Basic.
- CSRF: middleware `security_headers` menolak POST/PUT/DELETE ber-cookie yang `Origin`-nya bukan host sendiri
  (403). Endpoint pengubah data yang baru otomatis terlindungi. Jangan membuat endpoint GET yang mengubah data.
- Password dashboard: `auth.PasswordCheck` menerima password biasa atau hash bcrypt (`hashpw.py`). Di `.env`,
  hash harus diberi kutip tunggal karena `$` diinterpolasi Docker Compose.
- Mode tema: setiap warna baru di `web/src/styles/global.css` wajib punya nilai di `:root`, di blok
  `prefers-color-scheme: dark`, **dan** di `:root[data-theme="dark"]`, lalu dipetakan di `@theme inline` bila perlu utilitas.
- Bahasa: UI dua bahasa (default **en**, `localStorage` `awhub-lang`). Teks baru **wajib** ditambahkan ke kamus `I18N`
  (`en` dan `id`) di `web/src/lib/i18n-dict.ts` (dashboard) atau `login-dict.ts` (login), lalu dipanggil lewat
  `t("kunci")`. Markup `.astro` memakai atribut `data-i18n`, `data-i18n-aria`, `data-i18n-title`, `data-i18n-ph`. Label kategori ditampilkan lewat `catLabel()` (memakai `name_en`).
  Kategori baru di config sebaiknya punya `name_en`. Teks ringkasan Telegram ada di kamus `L` pada `report.py`.
- Filter `app`/`category`/`q` berlaku untuk `/api/stats` dan `/api/timeline` (kelas `Filter` di `app.py`). `app` dan `q` difilter di SQL
  (LIKE dengan wildcard di-escape), sedangkan `category` difilter di Python lewat `classify()`.
- Service worker **tidak boleh** meng-cache `/api/*` atau halaman ber-login, karena data pribadi tidak boleh tersimpan di perangkat.
  Nama `CACHE` di `sw.js` otomatis = build ID (placeholder `__BUILD_ID__` diisi saat build), jangan diisi manual.
- Update PWA: setiap `npm run build` membuat build ID (`__BUILD_ID__` di kode + `dist/version.json`, disajikan publik
  `no-store`). `lib/update.ts` mencocokkannya berkala & saat tab aktif, lalu menampilkan notifikasi "versi baru"
  (tanpa reload paksa). Build ID bisa ditetapkan lewat env `AW_HUB_BUILD_ID` (dipakai saat pengujian).
- CSP: `script-src 'self'` (bundel `/_astro/*.js`) + hash sha256 tiap `<script>` inline di `index.html`, `login.html`,
  `offline.html`, dihitung saat server start dari hasil build. Jangan menambah inline event handler (`onclick=`), `eval`,
  atau script dari domain lain — semuanya akan diblokir. Astro bisa meng-inline script kecil; itu tetap aman karena di-hash.

## 4. Pelajaran dari insiden (jangan diulang)

| Gejala | Penyebab | Yang sudah dilakukan |
| --- | --- | --- |
| Scheduled Task exit 1, log tidak ada | `Out-File -Encoding utf8` (PS 5.1) menulis **BOM**, sehingga `json.loads` gagal | Agent membaca dengan `utf-8-sig`, installer menulis tanpa BOM |
| `WinError 10053` / HTTP 403 `error code: 1010` | Cloudflare Browser Integrity Check memblokir UA `Python-urllib` | Agent mengirim `User-Agent: aw-hub-agent/<versi>`. Jangan dihapus |
| HTTP 520 sesaat | Gangguan Cloudflare ↔ origin; request tidak sampai ke nginx | `send_with_retry` (3x, backoff) untuk error jaringan/5xx |
| Sinkron awal lama (±6 detik/hari) | Query di aw-server (Python) memang lambat | Normal. Run berikutnya hanya ±2 hari (±15 detik) |
| Redirect loop | SSL mode Cloudflare kemungkinan **Flexible** | Vhost melayani port 80 **dan** 443, tanpa redirect 80→443 |
| Container crash saat deploy (`ModuleNotFoundError: auth`), dashboard down ±2 menit | `Dockerfile` hanya `COPY app.py` | Sekarang `COPY *.py`. Setelah deploy **selalu cek** `docker compose ps` (bukan `Restarting`) dan `curl 127.0.0.1:8077/healthz` |
| App tidak bisa menulis DB/secret/kategori | Container non-root (uid 10001) sementara `data/` milik root | `chown -R 10001:10001 /opt/aw-hub/data` (sudah dilakukan; ulangi bila folder dibuat ulang) |
| Hash bcrypt rusak di container | Docker Compose menginterpolasi `$` di `.env` | Hash diberi kutip tunggal. Server menolak start bila hash tampak rusak |
| Scanner (Censys) mengakses dashboard lewat IP origin | Origin terbuka tanpa melewati Cloudflare | nginx hanya mengizinkan IP Cloudflare (snippet `cloudflare-only.conf`) |

## 5. Tugas: pasang agent di laptop Linux

Kerjakan berurutan dan laporkan hasil tiap langkah ke pengguna. Berhenti dan tanya bila ada langkah yang gagal.

1. **Cek ActivityWatch berjalan & mencatat window**
   ```bash
   echo "$XDG_SESSION_TYPE"
   curl -s localhost:5600/api/0/info
   curl -s localhost:5600/api/0/buckets/ | python3 -m json.tool | grep '"id"'
   ```
   Harus ada `aw-watcher-window_<hostname>` dan `aw-watcher-afk_<hostname>`, dan bucket window harus
   berisi event baru. Cek dengan `curl -s "localhost:5600/api/0/buckets/aw-watcher-window_$(hostname)/events?limit=3"`.
   - Kalau AW belum terpasang atau belum berjalan, **laporkan ke pengguna** dan jangan memasang tanpa izin.
   - Kalau sesinya **Wayland** dan bucket window kosong atau basi, watcher bawaan tidak bekerja.
     Sarankan [awatcher](https://github.com/2e3s/awatcher) (pengganti `aw-watcher-window` + `aw-watcher-afk`)
     atau login dengan sesi Xorg. Minta keputusan pengguna. Agent mencari bucket bertipe `currentwindow`/`afkstatus`
     milik hostname tersebut, jadi awatcher tetap kompatibel.
2. **Pastikan kode terbaru:** `git pull` di repo ini.
3. **Minta URL server dan token agent ke pengguna** (`AW_HUB_INGEST_TOKEN` di `.env` server).
   Jangan menampilkan token di output yang kamu rangkum.
4. **Pasang:**
   ```bash
   cd agent
   ./install-linux.sh --server https://aw.example.com --token '<token>' --device <NamaPerangkat>
   ```
   `--device` harus unik per laptop dan tidak boleh diganti setelah data terkirim.
   Sinkron awal langsung berjalan dan bisa memakan beberapa menit.
5. **Verifikasi:**
   ```bash
   tail -5 agent/aw-hub-agent.log           # harus ada: INFO OK device=<NamaPerangkat> ...
   cat agent/state.json                     # synced_until terisi
   systemctl --user list-timers | grep aw-hub
   journalctl --user -u aw-hub-agent -n 20
   ```
   Tes sekali lagi lewat timer: `systemctl --user start aw-hub-agent.service` lalu cek log
   (harus selesai dalam hitungan detik). Minta pengguna membuka dashboard dan memastikan
   chip perangkat baru muncul dengan status "sync baru saja".
6. Opsional: kalau pengguna ingin timer tetap jalan saat belum login, jalankan `loginctl enable-linger $USER`.
   Biasanya tidak perlu, karena ActivityWatch juga hanya mencatat saat login.

Uninstall: `agent/install-linux.sh --uninstall`.

## 6. Deploy (server dengan Docker)

Detail server milik instalasi setempat (host, path, DNS) ada di `AGENTS.local.md`. Pola umumnya:

```bash
git archive HEAD | ssh <user>@<server> 'tar -x -C /opt/aw-hub'
ssh <user>@<server> 'cd /opt/aw-hub && docker compose up -d --build && docker compose ps'
```

- Setelah deploy, pastikan status container `Up` (bukan `Restarting`) dan `curl -s 127.0.0.1:8077/healthz` → `{"ok":true}`.
- `git archive` tidak menimpa `.env` dan `data/`, karena keduanya tidak ada di git.
- Perubahan `config/categories.json` langsung terbaca tanpa rebuild (di-mount read-only), **kecuali** bila ada
  `data/categories.json` (aturan kustom dari editor) — file itulah yang dipakai.
- **Mengubah `.env`**: backup dulu (`cp -p .env .env.bak-$(date +%F)`), edit, lalu `docker compose up -d`.
  Ganti password dashboard dengan `deploy/set-password.sh` (password diketik di terminal, disimpan sebagai hash bcrypt).
  Mengganti password/username membatalkan semua sesi login.
- **Token agent** boleh lebih dari satu (dipisah koma) di `AW_HUB_INGEST_TOKEN`. Saat mengganti token: pasang
  `baru,lama`, perbarui `config.json` di semua laptop, lalu hapus token lama.
- **IP Cloudflare** berubah sesekali: jalankan `deploy/update-cloudflare-ips.sh` (mis. tiap bulan).

## 7. Menguji secara lokal

```bash
(cd web && npm ci && npm run build)          # server menolak start bila web/dist belum ada
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server && AW_HUB_DB=/tmp/aw-test.db AW_HUB_INGEST_TOKEN=test AW_HUB_DASH_PASSWORD=test \
  ../.venv/bin/uvicorn app:app --port 8765     # memakai ../web/dist otomatis (atau set AW_HUB_STATIC)
# buka http://localhost:8765/login → user "admin" (default AW_HUB_DASH_USER), password "test"
# agent ke server lokal: buat config terpisah (server_url http://localhost:8765, token test,
# state_file & log_file di /tmp) lalu: python3 agent/aw_hub_agent.py -c /tmp/agent-test.json
```

Mengembangkan frontend dengan hot reload: jalankan uvicorn seperti di atas, lalu `cd web && npm run dev`
(http://localhost:4321; `/api` di-proxy ke :8765). Login lewat http://localhost:4321/login.

Setelah mengubah dashboard, render dan lihat hasilnya: layout lebar dan sempit, light dan dark mode, EN dan ID.
Pastikan tidak ada horizontal scroll di lebar HP, dan tidak ada error CSP di console.

Catatan pengujian dengan browser otomatis (Playwright):
- State dashboard ada di dalam modul (tidak ada variabel global `S`); baca kondisi lewat DOM atau `location.hash`.
- CSP melarang `eval`, jadi `page.wait_for_function("...")` akan gagal. Pakai `locator(...).wait_for()` atau
  `page.expect_response(...)` untuk menunggu data.
- Dashboard memuat data secara asinkron (±1 detik). Tunggu respons `/api/stats` sebelum membaca angka.
- Chromium headless memakai lebar minimum sekitar 500 px; screenshot di bawah itu hanya terpotong, bukan bug layout.
- Di Windows, set `PYTHONIOENCODING=utf-8` bila output skrip berisi karakter non-ASCII.
- Jangan uji batas login ke production berulang-ulang; kalau sampai terkunci, IP-mu akan tertahan sampai 15 menit.
