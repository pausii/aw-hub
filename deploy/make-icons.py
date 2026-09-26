"""Buat favicon & ikon PWA AW Hub → server/static/icons/ (butuh Pillow: pip install pillow).

Motif: jam 24 jam (00 di atas, searah jarum jam). Busur luar biru = jam kerja siang
(08–17), busur dalam biru muda = malam (19–01), titik tengah = "sekarang".
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "server" / "static" / "icons"
BG, TRACK, OUTER, INNER, DOT = "#0f1216", "#232a33", "#3987e5", "#9ec5f4", "#ffffff"
SS = 4  # supersampling agar tepi halus


def hour_to_pil(h: float) -> float:
    # sudut jam (0 jam di atas, searah jarum jam) → sudut Pillow (0° di kanan, searah jarum jam)
    return h / 24 * 360 - 90


def draw(size: int, maskable: bool = False, rounded: bool = True) -> Image.Image:
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, S, S], fill=BG)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    # maskable: isi di dalam zona aman 80% (lingkaran r=40%)
    scale = 0.78 if maskable else 1.0
    c = S / 2

    def ring(r_frac, w_frac, h0, h1, color, track=True):
        r, w = S * r_frac * scale, max(SS * 2, S * w_frac * scale)
        box = [c - r, c - r, c + r, c + r]
        if track:
            d.ellipse(box, outline=TRACK, width=int(w))
        d.arc(box, hour_to_pil(h0), hour_to_pil(h1), fill=color, width=int(w))

    ring(0.34, 0.12, 8, 17, OUTER)
    ring(0.19, 0.10, 19, 25, INNER)
    dr = S * 0.055 * scale
    d.ellipse([c - dr, c - dr, c + dr, c + dr], fill=DOT)
    return img.resize((size, size), Image.LANCZOS)


SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="{BG}"/>
  <circle cx="32" cy="32" r="21.8" fill="none" stroke="{TRACK}" stroke-width="7.7"/>
  <circle cx="32" cy="32" r="21.8" fill="none" stroke="{OUTER}" stroke-width="7.7"
          stroke-dasharray="51.4 200" transform="rotate(30 32 32)"/>
  <circle cx="32" cy="32" r="12.2" fill="none" stroke="{TRACK}" stroke-width="6.4"/>
  <circle cx="32" cy="32" r="12.2" fill="none" stroke="{INNER}" stroke-width="6.4"
          stroke-dasharray="19.2 200" transform="rotate(195 32 32)"/>
  <circle cx="32" cy="32" r="3.5" fill="{DOT}"/>
</svg>
"""

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192).save(OUT / "icon-192.png", optimize=True)
    draw(512).save(OUT / "icon-512.png", optimize=True)
    draw(512, maskable=True).save(OUT / "icon-maskable-512.png", optimize=True)
    draw(180, rounded=False).save(OUT / "apple-touch-icon.png", optimize=True)   # iOS membulatkan sendiri
    draw(256).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    (OUT / "favicon.svg").write_text(SVG, encoding="utf-8")
    print("ikon dibuat di", OUT)
