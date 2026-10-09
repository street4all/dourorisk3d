"""
Camadas acessíveis para o Modo Visita (Onde Pode Arder?).

1. Recolore as imagens DouroRisk com a escala segura para daltonismo
   (amarelo-pálido -> castanho-escuro, luminância sempre a descer).
2. Gera grelhas de classes (PNG em tons de cinzento, valor = classe) para a app
   poder dizer, por palavras, o que existe no sítio onde se toca no mapa.
3. Gera a camada 'encosta virada ao sol' a partir do raster de exposição.

Uso:
    python scripts/prepare_a11y_layers.py --exposicao EXP.npy
(EXP.npy = Exposicao_25m exportado com arcpy.RasterToNumPyArray, mesma grelha da recorrência.)
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

SRC = os.path.join("public", "data", "dourorisk")
OUT = os.path.join(SRC, "a11y")

# Escala de perigo 1..5 (especificação de acessibilidade)
RISK = {1: (247, 217, 138, 170), 2: (239, 166, 80, 190), 3: (208, 103, 42, 210), 4: (152, 53, 25, 225), 5: (71, 24, 13, 235)}
# Cores originais (export_dourorisk_to_web.py)
ORIG_RISK = {(26, 150, 65): 1, (166, 217, 106): 2, (254, 224, 139): 3, (244, 109, 67): 4, (215, 25, 28): 5}
ORIG_REC = {(254, 217, 118): 1, (254, 178, 76): 2, (253, 141, 60): 3, (240, 59, 32): 4, (189, 0, 38): 5}
ORIG_DECL = {(153, 216, 201): 1, (254, 232, 157): 2, (253, 180, 98): 3, (215, 48, 39): 4}
ORIG_BIO = {(237, 248, 233): 1, (186, 228, 179): 2, (116, 196, 118): 3, (49, 163, 84): 4, (0, 109, 44): 5}
# Quantas vezes ardeu: 1-2, 3-4, 5 ou mais
REC = {1: (239, 166, 80, 190), 2: (239, 166, 80, 190), 3: (208, 103, 42, 215), 4: (208, 103, 42, 215), 5: (71, 24, 13, 235)}
# Encosta inclinada: suave (transparente), moderada, forte, escarpada
DECL = {1: (0, 0, 0, 0), 2: (247, 217, 138, 150), 3: (208, 103, 42, 200), 4: (71, 24, 13, 230)}


def classes_from_png(path, lut):
    a = np.array(Image.open(path).convert("RGBA"))
    cls = np.zeros(a.shape[:2], np.uint8)
    for rgb, k in lut.items():
        cls[(a[..., 0] == rgb[0]) & (a[..., 1] == rgb[1]) & (a[..., 2] == rgb[2]) & (a[..., 3] > 0)] = k
    return cls


def paint(cls, palette):
    rgba = np.zeros(cls.shape + (4,), np.uint8)
    for k, col in palette.items():
        rgba[cls == k] = col
    return Image.fromarray(rgba, "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exposicao", help="EXP.npy (graus, -1/-9999 = plano)")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    for name, out in (("dourorisk_risco_2025_10m", "risco_2025"), ("dourorisk_perigosidade_2025_10m", "perigosidade_2025"),
                      ("dourorisk_perigosidade_icnf_2025", "icnf_conjuntural"), ("dourorisk_perigosidade_estrutural_icnf", "icnf_estrutural")):
        cls = classes_from_png(os.path.join(SRC, name + ".png"), ORIG_RISK)
        paint(cls, RISK).save(os.path.join(OUT, out + ".png"), optimize=True)
        Image.fromarray(cls, "L").save(os.path.join(OUT, out + "_classes.png"), optimize=True)
        print("ok", out, cls.shape)

    rec = classes_from_png(os.path.join(SRC, "dourorisk_recorrencia_1990_2025.png"), ORIG_REC)
    paint(rec, REC).save(os.path.join(OUT, "recorrencia.png"), optimize=True)
    Image.fromarray(rec, "L").save(os.path.join(OUT, "recorrencia_classes.png"), optimize=True)
    print("ok recorrencia", rec.shape)

    decl = classes_from_png(os.path.join(SRC, "dourorisk_declive_25m.png"), ORIG_DECL)
    paint(decl, DECL).save(os.path.join(OUT, "declive.png"), optimize=True)
    Image.fromarray(decl, "L").save(os.path.join(OUT, "declive_classes.png"), optimize=True)
    print("ok declive", decl.shape)

    bio = classes_from_png(os.path.join(SRC, "dourorisk_biomassa_2025.png"), ORIG_BIO)
    Image.fromarray(bio, "L").save(os.path.join(OUT, "biomassa_classes.png"), optimize=True)
    print("ok biomassa", bio.shape)

    if args.exposicao:
        e = np.load(args.exposicao)
        sunny = (e >= 135) & (e <= 270)          # vertentes viradas a sueste, sul, sudoeste e oeste
        # 0 = sem dados, 1 = virada ao sol, 2 = virada à sombra, 3 = plano (exposição < 0)
        cls = np.select([e <= -9000, (e < 0), sunny], [0, 3, 1], default=2).astype(np.uint8)
        paint(cls, {1: (239, 166, 80, 185)}).save(os.path.join(OUT, "exposicao_sol.png"), optimize=True)
        Image.fromarray(cls, "L").save(os.path.join(OUT, "exposicao_sol_classes.png"), optimize=True)
        print("ok exposicao", cls.shape, round(float(sunny.mean()), 3))

    json.dump({"generated_by": "scripts/prepare_a11y_layers.py"}, open(os.path.join(OUT, "README.json"), "w"))


if __name__ == "__main__":
    main()
