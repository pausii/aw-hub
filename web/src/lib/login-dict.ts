// Kamus halaman login.
import type { Lang } from "./i18n-dict";

export const LOGIN_I18N: Record<Lang, Record<string, string>> = {
  en: { lang: "Language", theme: "Theme", "theme.auto": "Auto", "theme.light": "Light", "theme.dark": "Dark",
        tagline: "Two laptops, one day.", ringOuter: "outer ring · Office", ringInner: "inner ring · Personal",
        heading: "Sign in to<br>AW Hub", lead: "Activity from both of your laptops, in one place.",
        username: "Username", password: "Password", showPassword: "Show password", signIn: "Sign in",
        limitNote: "Limited to 5 attempts per 15 minutes.", locale: "en-GB",
        morning: "Good morning ☀️", afternoon: "Good afternoon", evening: "Good evening", night: "Good night 🌙",
        checking: "Checking…", success: "Signed in ✓", empty: "Enter your username and password.",
        wrong: "Wrong username or password. {n} attempts left.", network: "Can't reach the server. Check your connection.",
        locked: "Too many failed attempts. Sign-in is temporarily locked for security.", retryIn: "Try again in {t}" },
  id: { lang: "Bahasa", theme: "Tema", "theme.auto": "Otomatis", "theme.light": "Terang", "theme.dark": "Gelap",
        tagline: "Dua laptop, satu hari.", ringOuter: "cincin luar · Kantor", ringInner: "cincin dalam · Pribadi",
        heading: "Masuk ke<br>AW Hub", lead: "Ringkasan aktivitas kedua laptopmu, dalam satu tempat.",
        username: "Username", password: "Password", showPassword: "Tampilkan password", signIn: "Masuk",
        limitNote: "Dibatasi 5 percobaan per 15 menit.", locale: "id-ID",
        morning: "Selamat pagi ☀️", afternoon: "Selamat siang", evening: "Selamat sore", night: "Selamat malam 🌙",
        checking: "Memeriksa…", success: "Berhasil ✓", empty: "Isi username dan password.",
        wrong: "Username atau password salah. Sisa {n} percobaan.", network: "Tidak bisa menghubungi server. Periksa koneksi.",
        locked: "Terlalu banyak percobaan gagal. Login dikunci sementara untuk keamanan.", retryIn: "Coba lagi dalam {t}" },
};
