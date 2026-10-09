"""Gera a marca DouroRisk 3D ("Socalcos em Chama") em SVG, com o texto convertido em contornos.

Uso (Python com fontTools):  python branding/gerar_marca.py <pasta-das-fontes>
Saída: branding/*.svg (e public/images/marca/*.svg para a app e a landing page).
"""
import math
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONTS = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIRS = [HERE, os.path.join(HERE, "..", "public", "images", "marca")]

INK = "#121417"
CREAM = "#F7F3EA"
RIVER = "#1F5C99"
ACCENT = "#E0521C"
# do alto (monte, perigo) para baixo (vinha junto ao rio)
RAMP = ["#B92D1A", "#DA4A1C", "#EE7A1D", "#F4A62A", "#E9C33A", "#A8B533", "#6E9A2B", "#3F7A26"]

N_LINES = 14
STROKE = 16.0


# ------------------------------------------------------------------ texto em contornos (fontTools)
class Face:
    def __init__(self, file):
        self.font = TTFont(os.path.join(FONTS, file))
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upm = self.font["head"].unitsPerEm
        self.hmtx = self.font["hmtx"]

    def path(self, text, size, x, y, tracking=0.0):
        """Contorno do texto com a linha de base em (x, y). Devolve (d, largura)."""
        s = size / self.upm
        pen = SVGPathPen(self.gs)
        cx = x
        for i, ch in enumerate(text):
            g = self.cmap.get(ord(ch))
            if g is None:
                continue
            tp = TransformPen(pen, (s, 0, 0, -s, cx, y))
            self.gs[g].draw(tp)
            cx += self.hmtx[g][0] * s + (tracking * size if i < len(text) - 1 else 0)
        return pen.getCommands(), cx - x


def lerp_hex(a, b, t):
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(pa[k] + (pb[k] - pa[k]) * t):02X}" for k in range(3))


def ramp(t):
    """t = 0 no alto, 1 em baixo."""
    p = t * (len(RAMP) - 1)
    i = min(int(p), len(RAMP) - 2)
    return lerp_hex(RAMP[i], RAMP[i + 1], p - i)


# ------------------------------------------------------------------ o símbolo
def flame_profile(t):
    """Meia-largura relativa da chama à altura t (0 = ponta, 1 = base):
    base redonda, corpo que se estreita em curva e ponta fina."""
    h = math.sin(math.pi * 0.5 * t) ** 2.4
    if t > 0.7:
        h *= math.sqrt(max(0.0, 1 - ((t - 0.7) / 0.33) ** 2))
    return h


def flame_center(t):
    """Eixo da chama: a ponta dobra-se para a direita, como empurrada pelo vento."""
    return 256 + 60 * (1 - t) ** 2.2 - 18 * math.sin(math.pi * t) * (1 - t)


def symbol(ox=0.0, oy=0.0, scale=1.0, river=True, mono=None):
    """Grupo SVG do símbolo numa caixa de 512 × 512 (com margem de respiração)."""
    top, bottom, wmax = 64.0, 384.0, 158.0
    pitch = (bottom - top) / (N_LINES - 1)
    prof = [flame_profile(i / (N_LINES - 1)) for i in range(N_LINES)]
    peak = max(prof)
    parts = []
    for i in range(N_LINES):
        t = i / (N_LINES - 1)
        y = top + i * pitch
        w = max(0.0, wmax * prof[i] / peak)
        c = flame_center(t)
        x0, x1 = c - w, c + w
        color = mono or ramp(t)
        if w < 1.5:
            parts.append(f'<circle cx="{c:.2f}" cy="{y:.2f}" r="{STROKE / 2:.2f}" fill="{color}"/>')
            continue
        # cada patamar curva-se um pouco nas pontas, como a vinha a seguir a encosta
        sag = 3.2 * (w / wmax)
        parts.append(
            f'<path d="M{x0:.2f} {y + sag:.2f} Q{c:.2f} {y - sag:.2f} {x1:.2f} {y + sag:.2f}" '
            f'stroke="{color}" stroke-width="{STROKE}" stroke-linecap="round" fill="none"/>'
        )
    if river:
        # o rio: a única linha que não pertence à chama
        y = bottom + pitch * 1.55
        x0, x1, amp, n = 104.0, 408.0, 6.0, 4
        seg = (x1 - x0) / n
        d = f"M{x0:.2f} {y:.2f}"
        for k in range(n):
            a = x0 + k * seg
            sgn = -1 if k % 2 == 0 else 1
            d += f" C{a + seg * 0.35:.2f} {y + sgn * amp * 1.33:.2f} {a + seg * 0.65:.2f} {y + sgn * amp * 1.33:.2f} {a + seg:.2f} {y:.2f}"
        parts.append(f'<path d="{d}" stroke="{mono or RIVER}" stroke-width="{STROKE}" stroke-linecap="round" fill="none"/>')
    return f'<g transform="translate({ox:.2f} {oy:.2f}) scale({scale:.5f})">' + "".join(parts) + "</g>"


def svg(w, h, body, bg=None, title="DouroRisk 3D"):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{rect}{body}</svg>\n"
    )


def save(name, content):
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            f.write(content)


# ------------------------------------------------------------------ peças
park = Face("NationalPark-Bold.ttf")
jura = Face("Jura-Medium.ttf")
mono = Face("DMMono-Regular.ttf")


def wordmark(x, baseline, size, ink, tag=True, tag_ink=None):
    """'DouroRisk' + '3D' (acento) e, por baixo, a pergunta em maiúsculas espaçadas."""
    d1, w1 = park.path("DouroRisk", size, x, baseline)
    gap = size * 0.16
    d2, w2 = park.path("3D", size, x + w1 + gap, baseline)
    out = f'<path d="{d1}" fill="{ink}"/><path d="{d2}" fill="{ACCENT}"/>'
    width = w1 + gap + w2
    if tag:
        ts = size * 0.25
        d3, w3 = jura.path("ONDE PODE ARDER?", ts, x + size * 0.03, baseline + size * 0.52, tracking=0.32)
        out += f'<path d="{d3}" fill="{tag_ink or ink}"/>'
        width = max(width, w3)
    return out, width


# 1. símbolo sozinho (fundo transparente)
save("logo-simbolo.svg", svg(512, 512, symbol(), title="DouroRisk 3D, símbolo"))

# 2. horizontal (claro: texto escuro; escuro: texto claro)
for variant, ink, tag_ink, bg in (("claro", INK, "#4A4A4A", None), ("escuro", CREAM, "#D9D4C7", None)):
    H = 200
    s = H / 512
    wm, ww = wordmark(H * 0.98, 112, 78, ink, tag_ink=tag_ink)
    W = int(H * 0.98 + ww + 24)
    save(f"logo-horizontal-{variant}.svg", svg(W, H, symbol(0, 0, s) + wm))

# 3. vertical (símbolo sobre o nome), para capas e ecrãs de entrada
for variant, ink, tag_ink in (("claro", INK, "#4A4A4A"), ("escuro", CREAM, "#D9D4C7")):
    W, size = 640, 92
    d1, w1 = park.path("DouroRisk", size, 0, 0)
    d2, w2 = park.path("3D", size, 0, 0)
    total = w1 + size * 0.16 + w2
    x = (W - total) / 2
    wm, _ = wordmark(x, 560, size, ink, tag=False)
    ts = size * 0.25
    _, wt = jura.path("ONDE PODE ARDER?", ts, 0, 0, tracking=0.32)
    dt, _ = jura.path("ONDE PODE ARDER?", ts, (W - wt) / 2, 612, tracking=0.32)
    body = symbol(W / 2 - 256 * 0.86, 10, 0.86) + wm + f'<path d="{dt}" fill="{tag_ink}"/>'
    save(f"logo-vertical-{variant}.svg", svg(W, 640, body))

# 4. ícone de app (quadrado, fundo escuro)
save("logo-icone.svg", svg(512, 512, f'<rect width="512" height="512" rx="112" fill="{INK}"/>' + symbol(46, 40, 0.82), title="DouroRisk 3D, ícone"))

# 5. folha da marca (a peça "canvas-design"): o símbolo como levantamento topográfico
W, H = 2400, 3000
m = 180
parts = [f'<rect width="{W}" height="{H}" fill="{CREAM}"/>']
S = 3.4
sx, sy = (W - 512 * S) / 2, 330
parts.append(symbol(sx, sy, S))
# cotas: uma por patamar, do rio (80 m) ao alto do monte (845 m), alinhadas à esquerda numa régua fina
top, bottom = 64.0, 384.0
pitch = (bottom - top) / (N_LINES - 1)
rx = m + 40
ruler = []
for i in range(N_LINES):
    y = sy + (top + i * pitch) * S
    alt = round(845 - (845 - 80) * (i / (N_LINES - 1)) * 0.86)
    ruler.append(f'<line x1="{rx}" y1="{y:.1f}" x2="{rx + 26}" y2="{y:.1f}" stroke="{INK}" stroke-width="2"/>')
    d, _ = mono.path(f"{alt:>3} m", 26, rx + 44, y + 9)
    ruler.append(f'<path d="{d}" fill="{INK}" fill-opacity="0.72"/>')
y_r = sy + (bottom + pitch * 1.55) * S
ruler.append(f'<line x1="{rx}" y1="{y_r:.1f}" x2="{rx + 26}" y2="{y_r:.1f}" stroke="{RIVER}" stroke-width="2"/>')
d, _ = mono.path(" 80 m  DOURO", 26, rx + 44, y_r + 9)
ruler.append(f'<path d="{d}" fill="{RIVER}"/>')
ruler.append(f'<line x1="{rx}" y1="{sy + top * S:.1f}" x2="{rx}" y2="{y_r:.1f}" stroke="{INK}" stroke-width="2" stroke-opacity="0.5"/>')
parts += ruler
# escala de cor à direita: os mesmos tons, de 1 a 5
cx = W - m - 70
for k in range(5):
    y = sy + 120 + k * 190
    col = ramp(k / 4)
    parts.append(f'<rect x="{cx}" y="{y:.1f}" width="70" height="150" rx="10" fill="{col}"/>')
    d, _ = mono.path(f"{5 - k}", 30, cx - 44, y + 88)
    parts.append(f'<path d="{d}" fill="{INK}" fill-opacity="0.72"/>')
# nome e lugar, em baixo
d1, w1 = park.path("DouroRisk", 236, 0, 0)
d2, w2 = park.path("3D", 236, 0, 0)
tw = w1 + 236 * 0.16 + w2
wm, _ = wordmark((W - tw) / 2, 2420, 236, INK, tag=False)
parts.append(wm)
_, wt = jura.path("ONDE PODE ARDER?", 54, 0, 0, tracking=0.34)
d, _ = jura.path("ONDE PODE ARDER?", 54, (W - wt) / 2, 2540, tracking=0.34)
parts.append(f'<path d="{d}" fill="{INK}"/>')
parts.append(f'<line x1="{m}" y1="2700" x2="{W - m}" y2="2700" stroke="{INK}" stroke-width="2" stroke-opacity="0.35"/>')
d, _ = mono.path("ALIJÓ · DOURO · 297,6 KM²", 28, m, 2780, tracking=0.12)
parts.append(f'<path d="{d}" fill="{INK}" fill-opacity="0.72"/>')
_, wr = mono.path("41.29° N   7.52° W", 28, 0, 0, tracking=0.12)
d, _ = mono.path("41.29° N   7.52° W", 28, W - m - wr, 2780, tracking=0.12)
parts.append(f'<path d="{d}" fill="{INK}" fill-opacity="0.72"/>')
d, _ = mono.path("FIG. 1  SOCALCOS EM CHAMA", 28, m, 2840, tracking=0.12)
parts.append(f'<path d="{d}" fill="{INK}" fill-opacity="0.45"/>')
save("folha-da-marca.svg", svg(W, H, "".join(parts), title="DouroRisk 3D, folha da marca"))
print("ok")
