import os
import numpy as np
from PIL import Image

A11Y_DIR = os.path.join("public", "data", "dourorisk", "a11y")
BASE_DIR = os.path.join("public", "data", "dourorisk")

# Novas cores da escala de risco conforme solicitado pelo utilizador:
# 1: Verde escuro (Muito Baixo / Reduzido)
# 2: Verde lima / amarelado (Baixo / Moderado)
# 3: Amarelo vivo (Médio / Elevado)
# 4: Laranja vivo (Alto / Muito Elevado)
# 5: Vermelho vivo (Muito Alto / Extremo / Máximo)
NEW_RISK_PALETTE = {
    0: (0, 0, 0, 0),
    1: (3, 100, 3, 205),      # #036403 Verde escuro
    2: (136, 179, 2, 215),    # #88b302 Verde lima / claro
    3: (255, 254, 6, 225),    # #fffe06 Amarelo vivo
    4: (254, 153, 0, 235),    # #fe9900 Laranja vivo
    5: (221, 34, 3, 245),     # #dd2203 Vermelho vivo
}

layers = [
    ("risco_2025_classes.png", "risco_2025.png", "dourorisk_risco_2025_10m.png"),
    ("perigosidade_2025_classes.png", "perigosidade_2025.png", "dourorisk_perigosidade_2025_10m.png"),
    ("icnf_conjuntural_classes.png", "icnf_conjuntural.png", "dourorisk_perigosidade_icnf_2025.png"),
    ("icnf_estrutural_classes.png", "icnf_estrutural.png", "dourorisk_perigosidade_estrutural_icnf.png"),
]

def repaint(cls, palette):
    h, w = cls.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for k, col in palette.items():
        rgba[cls == k] = col
    return Image.fromarray(rgba, mode="RGBA")

print("A repintar rasters com a nova escala de cores...")
for classes_file, a11y_out, base_out in layers:
    classes_path = os.path.join(A11Y_DIR, classes_file)
    if not os.path.exists(classes_path):
        print(f"Aviso: {classes_path} não encontrado!")
        continue
    
    cls = np.array(Image.open(classes_path))
    img = repaint(cls, NEW_RISK_PALETTE)
    
    # Grava na pasta a11y
    out1 = os.path.join(A11Y_DIR, a11y_out)
    img.save(out1, "PNG", optimize=True)
    print(f" -> Guardado: {out1} ({os.path.getsize(out1)/1024:.1f} KB)")
    
    # Grava também na pasta base
    out2 = os.path.join(BASE_DIR, base_out)
    img.save(out2, "PNG", optimize=True)
    print(f" -> Guardado: {out2} ({os.path.getsize(out2)/1024:.1f} KB)")

print("Concluído com sucesso!")
