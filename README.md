# AW Hub

Dashboard gabungan [ActivityWatch](https://activitywatch.net) untuk beberapa laptop.

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

Edit `config/categories.json`. Aturan dicek dari atas ke bawah dan yang pertama cocok menang.
`match` bisa `app`, `title`, atau `both`, sedangkan `slot` (2–8) adalah warna tetap kategori tersebut.
Server membaca ulang file ini otomatis, jadi cukup refresh dashboard. Kategori dihitung saat dashboard dibuka,
sehingga perubahan aturan langsung berlaku juga untuk data lama.

## Catatan keamanan

- Dashboard dan API terbuka ke internet. Pakai password panjang, dan kalau bisa batasi akses di firewall/Caddy
  (misalnya `remote_ip`) atau taruh di belakang Tailscale/Cloudflare Access.
- Judul window bisa memuat data sensitif (nama file, subjek email). Pakai `hide_title_regex` di laptop kantor
  dan pastikan hal ini sesuai kebijakan kantor.
- Token agent hanya bisa menulis data. Kalau bocor, ganti `AW_HUB_INGEST_TOKEN` lalu perbarui `config.json` di laptop.
