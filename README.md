# AW Hub

Dashboard *self-hosted* yang menggabungkan data [ActivityWatch](https://activitywatch.net) dari beberapa laptop
dalam satu tempat. Proyek independen, bukan bagian resmi ActivityWatch.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dashboard-overview-dark.png">
  <img alt="Dashboard AW Hub: total waktu aktif, tren harian per laptop, dan timeline 24 jam" src="docs/screenshots/dashboard-overview-light.png">
</picture>

**Fitur utama**

- Total waktu aktif per laptop, perbandingan dengan periode sebelumnya, tren harian/mingguan/bulanan
- Timeline 24 jam, ritme harian (jam mulai, selesai, istirahat terpanjang), heatmap hari × jam
- Kategori aktivitas yang bisa diatur dari dashboard, insight **kerja vs pribadi** (lembur, akhir pekan)
- Klik untuk memfilter semua chart, pencarian judul window
- Ringkasan mingguan otomatis ke **Telegram**
- Mode terang/gelap, bahasa Inggris/Indonesia, bisa dipasang sebagai aplikasi (PWA)
- Login dengan batas percobaan, CSP ketat, agent tanpa dependency (Python standard library)

## Tampilan

<table>
  <tr>
    <td width="50%"><img alt="Timeline 24 jam per laptop" src="docs/screenshots/timeline.png"></td>
    <td width="50%"><img alt="Ritme harian: jam mulai, selesai, dan istirahat" src="docs/screenshots/daily-rhythm.png"></td>
  </tr>
  <tr>
    <td><img alt="Kategori (donut) dan daftar" src="docs/screenshots/categories.png"></td>
    <td><img alt="Heatmap ritme mingguan hari × jam" src="docs/screenshots/hourly-heatmap.png"></td>
  </tr>
  <tr>
    <td><img alt="Tren kategori per hari" src="docs/screenshots/category-trend.png"></td>
    <td><img alt="Insight kerja vs pribadi" src="docs/screenshots/work-vs-personal.png"></td>
  </tr>
  <tr>
    <td><img alt="Halaman login (terang)" src="docs/screenshots/login-light.png"></td>
    <td><img alt="Halaman login (gelap)" src="docs/screenshots/login-dark.png"></td>
  </tr>
</table>

Tampilan satu halaman penuh: [terang](docs/screenshots/dashboard-full-light.png) · [gelap](docs/screenshots/dashboard-full-dark.png).
Judul window pada screenshot sengaja disamarkan.

## Cara kerja

```
Laptop kantor  ─┐  agent (tiap 15 mnt, HTTPS + token)
                ├──►  Server Linux: FastAPI + SQLite ──► dashboard (login)
Laptop pribadi ─┘
```

- Setiap laptop tetap menjalankan ActivityWatch seperti biasa, jadi data tetap tercatat walau sedang offline.
- **Agent** mengambil event window yang beririsan dengan status *not-afk*. Ini query yang sama dengan
  web UI ActivityWatch, jadi angka "waktu aktif"-nya konsisten. Agent lalu mengirim data per potongan 1 hari.
  Server **mengganti** data potongan itu, sehingga pengiriman ulang tidak menghasilkan data ganda.
  Kalau server tidak terjangkau, agent mencoba lagi pada run berikutnya.
- **Dashboard:** total waktu aktif dan perbandingan dengan periode sebelumnya, grafik harian/mingguan/bulanan
  per laptop, timeline 24 jam, kategori, pola jam, aplikasi teratas, dan judul window teratas.
  Rentang tanggal bisa bebas. Filter tersimpan di URL, jadi tampilan bisa di-bookmark.

## 1. Server (Linux, Docker)

Prasyarat: Docker + compose plugin, dan domain/subdomain dengan A record ke IP publik server.

```bash
git clone <repo-ini> aw-hub && cd aw-hub
cp .env.example .env
openssl rand -hex 32          # → AW_HUB_INGEST_TOKEN
nano .env                     # isi domain, token, password dashboard
```

Ada dua pilihan, tergantung apakah port 80/443 server sudah dipakai:

- **Sudah ada nginx di host** (mis. di belakang Cloudflare): `docker compose up -d --build`.
  App hanya listen di `127.0.0.1:8077` (ubah lewat `AW_HUB_PORT`). Pasang vhost dari
  `deploy/nginx-aw-hub.conf`.
- **Port 80/443 masih kosong:** `docker compose --profile caddy up -d --build`.
  Caddy akan mengurus HTTPS Let's Encrypt otomatis untuk `AW_HUB_DOMAIN`.

Buka `https://<domain>` lalu login dengan `AW_HUB_DASH_USER` / `AW_HUB_DASH_PASSWORD`.
Login dibatasi **5 percobaan gagal per IP per 15 menit**. Kunci berikutnya berlipat ganda, maksimal 24 jam.
Ada juga batas global 30 kegagalan per 15 menit dari semua IP. Batas global ini melindungi dari serangan
terdistribusi, dengan konsekuensi login ikut tertahan sementara saat terjadi serangan. Sesi berlaku 30 hari.
Mengganti password akan mengeluarkan semua sesi.

`AW_HUB_DASH_PASSWORD` boleh berisi password biasa **atau hash bcrypt** (disarankan, karena password asli tidak tersimpan di server). Cara membuat hash:

```bash
docker compose exec app python hashpw.py      # ketik password (tanpa echo)
```

Tempel hasilnya ke `.env` **dengan kutip tunggal**, yaitu `AW_HUB_DASH_PASSWORD='$2b$12$...'`, lalu jalankan `docker compose up -d`. Tanpa kutip, Docker Compose akan menganggap `$` sebagai variabel sehingga hash-nya rusak. Dalam kasus itu server menolak start dan menampilkan pesan yang menjelaskan masalahnya.
Database ada di `./data/aw-hub.db`. Untuk backup, cukup salin file itu.

### Tanpa Docker (sudah punya nginx/caddy sendiri)

```bash
cd aw-hub/server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
set -a; . ../.env; set +a
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --proxy-headers
```

Buat unit systemd dengan `EnvironmentFile=/path/aw-hub/.env`, lalu reverse-proxy HTTPS ke `127.0.0.1:8000`.

## 2. Agent di tiap laptop

Syarat: Python 3.9+. Agent hanya memakai library bawaan Python, jadi tidak perlu `pip install`.

**Windows** (PowerShell, dari folder `agent/`):

```powershell
.\install-windows.ps1 -ServerUrl https://aw.contoh.com -Token <AW_HUB_INGEST_TOKEN> -DeviceName Kantor
```

Script ini membuat `config.json` dan Scheduled Task **AW Hub Agent** yang berjalan tiap 15 menit dan saat login.
Run pertama mengirim seluruh riwayat. Contohnya, ±75 hari butuh sekitar 7 menit karena query di aw-server lambat.
Run berikutnya hanya butuh sekitar 15 detik. Untuk menghapus task: `.\install-windows.ps1 -Uninstall`.

**Linux (systemd)**, dari folder `agent/`:

```bash
./install-linux.sh --server https://aw.contoh.com --token <AW_HUB_INGEST_TOKEN> --device Pribadi
```

Script ini membuat `config.json` dan systemd *user* timer `aw-hub-agent.timer` yang berjalan tiap 15 menit
selama kamu login. Jadwal yang terlewat saat laptop sleep dijalankan begitu laptop menyala.
Sinkron awal langsung dijalankan. Status: `systemctl --user list-timers | grep aw-hub`,
log run terakhir: `journalctl --user -u aw-hub-agent -n 20`. Untuk menghapus: `./install-linux.sh --uninstall`.

> **Wayland:** `aw-watcher-window` bawaan ActivityWatch tidak mencatat window di Wayland
> (default GNOME Debian 12+). Pakai [awatcher](https://github.com/2e3s/awatcher) atau sesi Xorg.

**macOS / tanpa systemd:** salin `config.example.json` → `config.json`, lalu jadwalkan lewat cron:
`*/15 * * * * /usr/bin/python3 /path/aw-hub/agent/aw_hub_agent.py`.

Opsi `config.json`:

| Kunci | Keterangan |
| --- | --- |
| `device_name` | Nama laptop di dashboard (mis. `Kantor`, `Pribadi`). Jangan diubah setelah data terkirim. |
| `hide_title_regex` | Judul window dari app/judul yang cocok diganti `(disembunyikan)` sebelum dikirim, mis. `"outlook\|teams\|sap"`. |
| `aw_url` | Alamat aw-server lokal, default `http://localhost:5600`. |

Perintah manual: `python aw_hub_agent.py` (sinkron biasa), `--days 30` (kirim ulang 30 hari terakhir),
`--full` (kirim ulang semua). Log disimpan di `agent/aw-hub-agent.log`.

## 3. Kategori

**Cara termudah:** klik tombol **Edit** di kartu *Categories* pada dashboard. Di sana kamu bisa mengubah nama, warna, urutan, dan regex; mengatur jam dan hari kerja; lalu **menguji aturan** pada data 30 hari terakhir. Aplikasi atau judul yang belum punya kategori bisa langsung dimasukkan ke kategori tertentu. Aturan hasil edit disimpan di `data/categories.json` di server, jadi tidak tertimpa saat deploy. *Reset to default* akan kembali memakai file di repo.

<p align="center"><img alt="Editor kategori di dashboard" src="docs/screenshots/category-editor.png" width="85%"></p>

Secara manual: edit `config/categories.json`. Aturan dicek dari atas ke bawah dan yang pertama cocok menang.
`match` bisa `app`, `title`, atau `both`, sedangkan `slot` (2–8) adalah warna tetap kategori tersebut.
Server membaca ulang file ini otomatis, jadi cukup refresh dashboard. Kategori dihitung saat dashboard dibuka,
sehingga perubahan aturan langsung berlaku juga untuk data lama.

## 4. Insight kerja vs pribadi

Atur bagian `work` di `config/categories.json`:

```json
"work": {
  "categories": ["Programming", "Dokumen & Office", "Riset & AI", "Komunikasi"],
  "days": [0, 1, 2, 3, 4],
  "start_hour": 8, "end_hour": 17,
  "office_devices": ["Kantor"]
}
```

Dashboard menampilkan:
- total waktu kerja;
- lembur (kerja di luar jam kerja) dan kerja di akhir pekan;
- kerja di laptop selain `office_devices`;
- aktivitas non-kerja di jam kerja;
- matriks perangkat × kerja/non-kerja.

Jam kerja dihitung per jam lokal, dan jam 00–03 masuk ke hari kalender berikutnya.

## 5. Ringkasan mingguan Telegram

1. Buat bot lewat [@BotFather](https://t.me/BotFather) dan catat token-nya.
2. Kirim pesan apa saja ke bot, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` untuk melihat `chat.id`.
3. Isi `AW_HUB_TELEGRAM_BOT_TOKEN` dan `AW_HUB_TELEGRAM_CHAT_ID` di `.env`, lalu jalankan `docker compose up -d`.

Server akan mengirim ringkasan minggu lalu (Senin–Minggu) setiap **Senin 07:00** (ubah lewat
`AW_HUB_REPORT_WEEKDAY` / `AW_HUB_REPORT_HOUR`). Minggu yang sudah terkirim dicatat di database,
jadi restart server tidak menyebabkan laporan terkirim dua kali. Dari kartu *Kerja vs pribadi* di dashboard,
laporan bisa **dipratinjau** atau **dikirim sekarang**.

## 6. Filter & pencarian

Klik kategori (di daftar atau donut), aplikasi, segmen timeline, atau judul window untuk memfilter **semua**
chart. Klik item yang sama sekali lagi, atau tanda × pada chip filter, untuk menghapus filternya. Kotak pencarian
mencari teks di judul window. Filter tersimpan di URL, jadi tampilan terfilter bisa di-bookmark.

<p align="center"><img alt="Filter kategori aktif" src="docs/screenshots/filter-active.png" width="85%"></p>

## 7. Ritme harian

Kartu *Daily rhythm* menampilkan jam mulai dan selesai tiap hari (aktivitas pertama dan terakhir), rentang hari,
istirahat terpanjang (jeda ≥ 5 menit), dan jumlah *malam larut* (aktivitas terakhir lewat 22:00).
Hari dengan aktivitas kurang dari 5 menit diabaikan.

## 8. Pasang sebagai aplikasi (PWA)

Di Chrome/Edge (desktop atau Android) pilih **Install app**. Di iPhone, pakai **Share → Add to Home Screen**.
Service worker hanya menyimpan ikon dan halaman offline di cache. Data dan halaman dashboard **tidak** pernah
di-cache, jadi data pribadi tidak tersimpan di perangkat.
Ikon dan favicon dibuat dengan `python deploy/make-icons.py` (butuh Pillow).

<p align="center">
  <img alt="Dashboard di HP (terang)" src="docs/screenshots/mobile-dashboard-light.png" width="30%">
  <img alt="Dashboard di HP (gelap)" src="docs/screenshots/mobile-dashboard-dark.png" width="30%">
  <img alt="Login di HP (gelap)" src="docs/screenshots/mobile-login-dark.png" width="30%">
</p>

## 9. Bahasa (EN / ID)

Dashboard dan halaman login tersedia dalam bahasa Inggris (default) dan Indonesia. Ganti lewat tombol 🌐 di pojok kanan atas.
Pilihan bahasa disimpan per browser. Nama kategori memakai `name_en` di `config/categories.json` saat bahasa Inggris aktif.
Bahasa ringkasan Telegram diatur terpisah lewat `AW_HUB_REPORT_LANG` (`en` | `id`).

<p align="center"><img alt="Dashboard dalam bahasa Indonesia" src="docs/screenshots/dashboard-overview-id.png" width="85%"></p>

## 10. Pengembangan frontend

Frontend ada di `web/` (Astro + TypeScript + Tailwind CSS). Hasil build-nya berupa file statis yang disajikan FastAPI,
jadi tidak ada server Node di production (image Docker membangunnya di tahap terpisah).

```bash
cd web
npm ci
npm run dev        # http://localhost:4321, /api di-proxy ke FastAPI lokal di :8765
npm run typecheck  # tsc --noEmit (strict)
npm run build      # → web/dist (dipakai server lokal otomatis)
```

## Catatan keamanan

- Dashboard terbuka ke internet dan dilindungi login dengan batas percobaan. Pakai password panjang.
  Kalau mau lebih ketat, tambahkan Cloudflare Access di depannya dan kecualikan `/api/ingest`.
- Judul window bisa memuat data sensitif (nama file, subjek email). Pakai `hide_title_regex` di laptop kantor
  dan pastikan hal ini sesuai kebijakan kantor.
- Token agent hanya bisa menulis data. `AW_HUB_INGEST_TOKEN` boleh berisi beberapa token dipisah koma, jadi token
  bisa diganti tanpa putus sync: pasang `baru,lama`, perbarui `config.json` di semua laptop, lalu hapus token lama.
- Ganti password dashboard dengan `deploy/set-password.sh`, dan nilai rahasia lain (mis. token bot Telegram) dengan
  `deploy/set-secret.sh`. Keduanya meminta nilai di terminal, jadi tidak tersimpan di riwayat shell.

## Lisensi

[MIT](LICENSE) © 2026 Ahmad Pausi
