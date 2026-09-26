"""Buat hash bcrypt untuk AW_HUB_DASH_PASSWORD.

    python hashpw.py                          # password diketik tanpa echo
    echo -n 'rahasia' | python hashpw.py      # atau dari stdin
    docker compose exec -T app python hashpw.py < file_berisi_password

Tempel hasilnya ke .env dengan tanda kutip TUNGGAL (tanda $ jangan sampai diinterpolasi Docker Compose):
    AW_HUB_DASH_PASSWORD='$2b$12$...'
"""
import getpass
import sys

import bcrypt

pw = getpass.getpass("Password: ") if sys.stdin.isatty() else sys.stdin.read().rstrip("\r\n")
if not pw:
    sys.exit("Password kosong.")
if len(pw.encode()) > 72:
    sys.exit("Password maksimal 72 byte (batas bcrypt).")
print(bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode())
