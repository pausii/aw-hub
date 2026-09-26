"""Sesi login (cookie bertanda tangan HMAC) + pembatas percobaan login."""
import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import deque
from pathlib import Path

COOKIE_NAME = "awhub_session"
SESSION_TTL = 30 * 86400

# Batas percobaan login.
IP_MAX_FAILS = 5              # gagal per IP dalam jendela → dikunci
IP_WINDOW = 15 * 60
IP_LOCK_BASE = 15 * 60        # kunci pertama; berlipat ganda tiap kali dikunci ulang (maks 24 jam)
IP_LOCK_MAX = 24 * 3600
GLOBAL_MAX_FAILS = 30         # total gagal dari semua IP dalam jendela → semua login ditahan sementara
GLOBAL_WINDOW = 15 * 60
GLOBAL_LOCK = 15 * 60


class Sessions:
    """Token = base64(user|exp).hmac. Kunci HMAC diturunkan dari secret + password,
    sehingga mengganti password otomatis membatalkan semua sesi lama."""

    def __init__(self, secret: bytes, password: str):
        self.key = hashlib.sha256(secret + b"|" + password.encode()).digest()

    def issue(self, user: str) -> str:
        payload = base64.urlsafe_b64encode(f"{user}|{int(time.time()) + SESSION_TTL}".encode()).decode()
        return f"{payload}.{self._sign(payload)}"

    def verify(self, token: str | None) -> str | None:
        if not token or "." not in token:
            return None
        payload, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, self._sign(payload)):
            return None
        try:
            user, exp = base64.urlsafe_b64decode(payload.encode()).decode().rsplit("|", 1)
        except (ValueError, UnicodeDecodeError):
            return None
        return user if int(exp) > time.time() else None

    def _sign(self, payload: str) -> str:
        return hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()


def load_secret(path: Path, env_value: str) -> bytes:
    """Secret dari env, atau dibuat sekali & disimpan di volume data."""
    if env_value:
        return env_value.encode()
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    s = secrets.token_bytes(32)
    path.write_bytes(s)
    path.chmod(0o600)
    return s


class LoginLimiter:
    """In-memory (server satu proses). Restart server = hitungan kembali nol."""

    def __init__(self):
        self.lock = threading.Lock()
        self.fails: dict[str, deque] = {}
        self.locked_until: dict[str, float] = {}
        self.lock_count: dict[str, int] = {}
        self.global_fails: deque = deque()
        self.global_locked_until = 0.0

    def _prune(self, now: float):
        # batasi memori: buang entri basi (IP yang sudah tidak terkunci & tidak ada kegagalan baru)
        if len(self.fails) + len(self.locked_until) < 5000:
            return
        for ip in [k for k, q in self.fails.items() if not q or q[-1] < now - IP_WINDOW]:
            del self.fails[ip]
        for ip in [k for k, t in self.locked_until.items() if t < now]:
            self.locked_until.pop(ip, None)
            if ip not in self.fails:
                self.lock_count.pop(ip, None)

    def check(self, ip: str) -> tuple[bool, int]:
        """(boleh_mencoba, detik_tunggu)."""
        now = time.time()
        with self.lock:
            self._prune(now)
            wait = max(self.locked_until.get(ip, 0), self.global_locked_until) - now
            return (wait <= 0, max(0, int(wait + 0.999)))

    def fail(self, ip: str) -> tuple[int, int]:
        """Catat kegagalan → (sisa_percobaan, detik_kunci)."""
        now = time.time()
        with self.lock:
            q = self.fails.setdefault(ip, deque())
            q.append(now)
            while q and q[0] < now - IP_WINDOW:
                q.popleft()
            self.global_fails.append(now)
            while self.global_fails and self.global_fails[0] < now - GLOBAL_WINDOW:
                self.global_fails.popleft()
            if len(self.global_fails) >= GLOBAL_MAX_FAILS:
                self.global_locked_until = now + GLOBAL_LOCK
                self.global_fails.clear()
            if len(q) >= IP_MAX_FAILS:
                n = self.lock_count.get(ip, 0)
                dur = min(IP_LOCK_MAX, IP_LOCK_BASE * (2 ** n))
                self.lock_count[ip] = n + 1
                self.locked_until[ip] = now + dur
                q.clear()
                return 0, dur
            return IP_MAX_FAILS - len(q), 0

    def success(self, ip: str):
        with self.lock:
            self.fails.pop(ip, None)
            self.lock_count.pop(ip, None)
            self.locked_until.pop(ip, None)


def client_ip(request) -> str:
    # Di belakang Cloudflare → nginx: IP asli ada di CF-Connecting-IP. Header ini bisa
    # dipalsukan bila origin diakses langsung, karena itu ada juga batas global.
    return (request.headers.get("cf-connecting-ip")
            or request.headers.get("x-real-ip")
            or (request.client.host if request.client else "?"))
