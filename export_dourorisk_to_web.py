import os
import json
import numpy as np
from PIL import Image

# Import ArcPy from ArcGIS Pro
import arcpy

print("=== DouroRisk -> Web App 3D Data Bridge (ArcPy) ===", flush=True)

gdb_path = r"C:\Users\PcVIP\Documents\ArcGIS\Packages\DouroRisk_Alijo_aec603\commondata\raster_data.gdb"
vector_gdb = r"C:\Users\PcVIP\Documents\ArcGIS\Packages\DouroRisk_Alijo_aec603\commondata\mad_sgifr_template.gdb"
output_dir = os.path.abspath("public/data/dourorisk")
os.makedirs(output_dir, exist_ok=True)

sr_src = arcpy.SpatialReference(3763) # PT-TM06
sr_wgs = arcpy.SpatialReference(4326) # WGS84

# Official SGIFR / ICNF Fire Risk Palette (RGBA)
# 0/255: Transparent, 1: Muito Baixo, 2: Baixo, 3: Médio, 4: Alto, 5: Muito Alto
COLOR_PALETTE = {
    0: (0, 0, 0, 0),
    255: (0, 0, 0, 0),
    1: (26, 150, 65, 175),    # Verde floresta (Muito Baixo)
    2: (166, 217, 106, 185),  # Verde claro (Baixo)
    3: (254, 224, 139, 195),  # Amarelo (Médio)
    4: (244, 109, 67, 215),   # Laranja intenso (Alto)
    5: (215, 25, 28, 235),    # Vermelho escuro (Muito Alto / Extremo)
}

def export_raster_to_rgba_png(raster_name, out_filename):
    print(f"\nA processar raster: {raster_name}...", flush=True)
    r_path = os.path.join(gdb_path, raster_name)
    r = arcpy.Raster(r_path)
    ext = arcpy.Describe(r).extent

    p_bl = arcpy.PointGeometry(arcpy.Point(ext.XMin, ext.YMin), sr_src).projectAs(sr_wgs).firstPoint
    p_tr = arcpy.PointGeometry(arcpy.Point(ext.XMax, ext.YMax), sr_src).projectAs(sr_wgs).firstPoint

    extent_wgs = {
        "xmin": round(p_bl.X, 6),
        "ymin": round(p_bl.Y, 6),
        "xmax": round(p_tr.X, 6),
        "ymax": round(p_tr.Y, 6),
    }
    print(f"Extensão WGS84: {extent_wgs}", flush=True)

    arr = arcpy.RasterToNumPyArray(r)
    h, w = arr.shape
    print(f"Dimensões: {w} x {h} células", flush=True)

    # Downsample slightly if > 2000px for web performance (keeps 10m crisp fidelity)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for val, col in COLOR_PALETTE.items():
        mask = (arr == val)
        rgba[mask] = col

    # Class statistics
    stats = {}
    total_valid = np.sum((arr >= 1) & (arr <= 5))
    class_labels = {
        1: "Muito Baixo",
        2: "Baixo",
        3: "Médio",
        4: "Alto",
        5: "Muito Alto"
    }
    for c in range(1, 6):
        cnt = int(np.sum(arr == c))
        pct = round((cnt / total_valid) * 100, 1) if total_valid > 0 else 0
        stats[c] = {
            "label": class_labels[c],
            "count": cnt,
            "pct": pct
        }
        print(f" - Classe {c} ({class_labels[c]}): {pct}% ({cnt} células)", flush=True)

    img = Image.fromarray(rgba, mode="RGBA")
    
    # Save optimized PNG
    out_png_path = os.path.join(output_dir, out_filename)
    img.save(out_png_path, "PNG", optimize=True)
    size_kb = os.path.getsize(out_png_path) / 1024
    print(f"Guardado com sucesso: {out_png_path} ({size_kb:.1f} KB)", flush=True)

    return {
        "id": out_filename.replace(".png", ""),
        "name": raster_name,
        "image": f"/data/dourorisk/{out_filename}",
        "extent": extent_wgs,
        "resolution": f"{desc_cell(r)}m",
        "stats": stats
    }

def desc_cell(r):
    try:
        return int(arcpy.Describe(r).meanCellWidth)
    except:
        return 10

def main():
    metadata = {
        "project": "DouroRisk Alijó — Inteligência Territorial do Risco de Incêndio",
        "description": "Modelos matriciais de risco de incêndio e perigosidade gerados pelo DouroRisk / ICNF para o Concelho de Alijó",
        "layers": []
    }

    # 1. Risco de Incêndio da Tese - Cenário 2025 (10m)
    r1 = export_raster_to_rgba_png(
        "Risco_Cenario_2025_Incendios_Parametros_Historicos_10m",
        "dourorisk_risco_2025_10m.png"
    )
    r1["title"] = "Risco de Incêndio (Cenário 2025 — 10m)"
    r1["category"] = "tese"
    metadata["layers"].append(r1)

    # 2. Perigosidade de Incêndio da Tese - Cenário 2025 (10m)
    r2 = export_raster_to_rgba_png(
        "Perigosidade_Modelo_Tese_Cenario_2025_10m",
        "dourorisk_perigosidade_2025_10m.png"
    )
    r2["title"] = "Perigosidade de Incêndio (Modelo Tese — 10m)"
    r2["category"] = "tese"
    metadata["layers"].append(r2)

    # 3. Perigosidade Conjuntural Oficial ICNF 2025 (25m)
    r3 = export_raster_to_rgba_png(
        "Perigosidade_Conjuntural_ICNF_2025_25m",
        "dourorisk_perigosidade_icnf_2025.png"
    )
    r3["title"] = "Perigosidade Conjuntural ICNF (Oficial 2025)"
    r3["category"] = "icnf"
    metadata["layers"].append(r3)

    # 4. Perigosidade Estrutural Oficial ICNF 2020-2030 (25m)
    r4 = export_raster_to_rgba_png(
        "Perigosidade_Estrutural_ICNF_2020_2030_25m",
        "dourorisk_perigosidade_estrutural_icnf.png"
    )
    r4["title"] = "Perigosidade Estrutural ICNF (2020–2030)"
    r4["category"] = "icnf"
    metadata["layers"].append(r4)

    # 5. Recorrência do Fogo (1990-2025)
    r5 = export_recorrencia_raster(
        "Recorrencia_1990_2025_25m",
        "dourorisk_recorrencia_1990_2025.png"
    )
    r5["title"] = "Recorrência de Incêndios (1990–2025)"
    r5["category"] = "historico"
    metadata["layers"].append(r5)

    # 6. Biomassa / Carga de Combustível (2025)
    r6 = export_biomassa_raster(
        "Biomassa_Metodo_Original_2025_25m",
        "dourorisk_biomassa_2025.png"
    )
    r6["title"] = "Biomassa Vegetal Estimada (2025)"
    r6["category"] = "combustivel"
    metadata["layers"].append(r6)

    # 7. Declive Topográfico (%)
    r7 = export_declive_raster(
        "Declive_Percentagem_25m",
        "dourorisk_declive_25m.png"
    )
    r7["title"] = "Declive do Terreno (%)"
    r7["category"] = "orografia"
    metadata["layers"].append(r7)

    # Write metadata JSON
    meta_path = os.path.join(output_dir, "dourorisk_metadata.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"\nMetadata guardado em: {meta_path}", flush=True)
    print("=== EXPORTAÇÃO ARCPY CONCLUÍDA COM SUCESSO! ===", flush=True)

def export_recorrencia_raster(raster_name, out_filename):
    print(f"\nA processar raster de recorrência: {raster_name}...", flush=True)
    r_path = os.path.join(gdb_path, raster_name)
    r = arcpy.Raster(r_path)
    ext = arcpy.Describe(r).extent

    p_bl = arcpy.PointGeometry(arcpy.Point(ext.XMin, ext.YMin), sr_src).projectAs(sr_wgs).firstPoint
    p_tr = arcpy.PointGeometry(arcpy.Point(ext.XMax, ext.YMax), sr_src).projectAs(sr_wgs).firstPoint
    extent_wgs = {"xmin": round(p_bl.X, 6), "ymin": round(p_bl.Y, 6), "xmax": round(p_tr.X, 6), "ymax": round(p_tr.Y, 6)}

    arr = arcpy.RasterToNumPyArray(r, nodata_to_value=0)
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    # 0 = Nunca ardeu (transparente)
    # 1 = Amarelo suave
    # 2 = Amarelo alaranjado
    # 3 = Laranja forte
    # 4 = Vermelho intenso
    # >=5 = Vermelho profundo / Carmim
    RECORR_PALETTE = {
        0: (0, 0, 0, 0),
        1: (254, 217, 118, 175),
        2: (254, 178, 76, 195),
        3: (253, 141, 60, 215),
        4: (240, 59, 32, 235),
        5: (189, 0, 38, 245),
    }

    for val, col in RECORR_PALETTE.items():
        if val == 5:
            mask = (arr >= 5)
        else:
            mask = (arr == val)
        rgba[mask] = col

    stats = {
        1: {"label": "1 Vez", "count": int(np.sum(arr == 1)), "pct": round(float(np.sum(arr == 1)) / float(np.sum(arr > 0)) * 100, 1) if np.sum(arr > 0) else 0},
        2: {"label": "2 Vezes", "count": int(np.sum(arr == 2)), "pct": round(float(np.sum(arr == 2)) / float(np.sum(arr > 0)) * 100, 1) if np.sum(arr > 0) else 0},
        3: {"label": "3 Vezes", "count": int(np.sum(arr == 3)), "pct": round(float(np.sum(arr == 3)) / float(np.sum(arr > 0)) * 100, 1) if np.sum(arr > 0) else 0},
        4: {"label": "4 Vezes", "count": int(np.sum(arr == 4)), "pct": round(float(np.sum(arr == 4)) / float(np.sum(arr > 0)) * 100, 1) if np.sum(arr > 0) else 0},
        5: {"label": "≥ 5 Vezes", "count": int(np.sum(arr >= 5)), "pct": round(float(np.sum(arr >= 5)) / float(np.sum(arr > 0)) * 100, 1) if np.sum(arr > 0) else 0},
    }

    img = Image.fromarray(rgba, mode="RGBA")
    out_png_path = os.path.join(output_dir, out_filename)
    img.save(out_png_path, "PNG", optimize=True)

    return {
        "id": out_filename.replace(".png", ""),
        "name": raster_name,
        "image": f"/data/dourorisk/{out_filename}",
        "extent": extent_wgs,
        "resolution": "25m",
        "stats": stats
    }

def export_biomassa_raster(raster_name, out_filename):
    print(f"\nA processar raster de biomassa: {raster_name}...", flush=True)
    r_path = os.path.join(gdb_path, raster_name)
    r = arcpy.Raster(r_path)
    ext = arcpy.Describe(r).extent

    p_bl = arcpy.PointGeometry(arcpy.Point(ext.XMin, ext.YMin), sr_src).projectAs(sr_wgs).firstPoint
    p_tr = arcpy.PointGeometry(arcpy.Point(ext.XMax, ext.YMax), sr_src).projectAs(sr_wgs).firstPoint
    extent_wgs = {"xmin": round(p_bl.X, 6), "ymin": round(p_bl.Y, 6), "xmax": round(p_tr.X, 6), "ymax": round(p_tr.Y, 6)}

    arr = arcpy.RasterToNumPyArray(r, nodata_to_value=-9999)
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid_mask = (arr != -9999)
    # Continuous color ramp (Verde suave a Verde escuro / Castanho floresta)
    # <5: Muito baixa, 5-15: Baixa, 15-25: Média, 25-32: Alta, >32: Muito Alta
    rgba[(valid_mask) & (arr < 5)] = (237, 248, 233, 160)
    rgba[(valid_mask) & (arr >= 5) & (arr < 15)] = (186, 228, 179, 185)
    rgba[(valid_mask) & (arr >= 15) & (arr < 25)] = (116, 196, 118, 205)
    rgba[(valid_mask) & (arr >= 25) & (arr < 32)] = (49, 163, 84, 225)
    rgba[(valid_mask) & (arr >= 32)] = (0, 109, 44, 245)

    stats = {
        1: {"label": "< 5 t/ha (M. Baixa)", "count": int(np.sum((valid_mask) & (arr < 5))), "pct": round(float(np.sum((valid_mask) & (arr < 5))) / float(np.sum(valid_mask)) * 100, 1)},
        2: {"label": "5-15 t/ha (Baixa)", "count": int(np.sum((valid_mask) & (arr >= 5) & (arr < 15))), "pct": round(float(np.sum((valid_mask) & (arr >= 5) & (arr < 15))) / float(np.sum(valid_mask)) * 100, 1)},
        3: {"label": "15-25 t/ha (Média)", "count": int(np.sum((valid_mask) & (arr >= 15) & (arr < 25))), "pct": round(float(np.sum((valid_mask) & (arr >= 15) & (arr < 25))) / float(np.sum(valid_mask)) * 100, 1)},
        4: {"label": "25-32 t/ha (Alta)", "count": int(np.sum((valid_mask) & (arr >= 25) & (arr < 32))), "pct": round(float(np.sum((valid_mask) & (arr >= 25) & (arr < 32))) / float(np.sum(valid_mask)) * 100, 1)},
        5: {"label": "> 32 t/ha (M. Alta)", "count": int(np.sum((valid_mask) & (arr >= 32))), "pct": round(float(np.sum((valid_mask) & (arr >= 32))) / float(np.sum(valid_mask)) * 100, 1)},
    }

    img = Image.fromarray(rgba, mode="RGBA")
    out_png_path = os.path.join(output_dir, out_filename)
    img.save(out_png_path, "PNG", optimize=True)

    return {
        "id": out_filename.replace(".png", ""),
        "name": raster_name,
        "image": f"/data/dourorisk/{out_filename}",
        "extent": extent_wgs,
        "resolution": "25m",
        "stats": stats
    }

def export_declive_raster(raster_name, out_filename):
    print(f"\nA processar raster de declive: {raster_name}...", flush=True)
    r_path = os.path.join(gdb_path, raster_name)
    r = arcpy.Raster(r_path)
    ext = arcpy.Describe(r).extent

    p_bl = arcpy.PointGeometry(arcpy.Point(ext.XMin, ext.YMin), sr_src).projectAs(sr_wgs).firstPoint
    p_tr = arcpy.PointGeometry(arcpy.Point(ext.XMax, ext.YMax), sr_src).projectAs(sr_wgs).firstPoint
    extent_wgs = {"xmin": round(p_bl.X, 6), "ymin": round(p_bl.Y, 6), "xmax": round(p_tr.X, 6), "ymax": round(p_tr.Y, 6)}

    arr = arcpy.RasterToNumPyArray(r, nodata_to_value=-9999)
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid_mask = (arr >= 0)
    # <15%: Plano/Suave, 15-30%: Moderado, 30-50%: Forte, >50%: Muito Forte / Escarpado
    rgba[(valid_mask) & (arr < 15)] = (153, 216, 201, 150)
    rgba[(valid_mask) & (arr >= 15) & (arr < 30)] = (254, 232, 157, 185)
    rgba[(valid_mask) & (arr >= 30) & (arr < 50)] = (253, 180, 98, 210)
    rgba[(valid_mask) & (arr >= 50)] = (215, 48, 39, 235)

    stats = {
        1: {"label": "< 15% (Suave)", "count": int(np.sum((valid_mask) & (arr < 15))), "pct": round(float(np.sum((valid_mask) & (arr < 15))) / float(np.sum(valid_mask)) * 100, 1)},
        2: {"label": "15-30% (Moderado)", "count": int(np.sum((valid_mask) & (arr >= 15) & (arr < 30))), "pct": round(float(np.sum((valid_mask) & (arr >= 15) & (arr < 30))) / float(np.sum(valid_mask)) * 100, 1)},
        3: {"label": "30-50% (Forte)", "count": int(np.sum((valid_mask) & (arr >= 30) & (arr < 50))), "pct": round(float(np.sum((valid_mask) & (arr >= 30) & (arr < 50))) / float(np.sum(valid_mask)) * 100, 1)},
        4: {"label": "> 50% (Escarpado)", "count": int(np.sum((valid_mask) & (arr >= 50))), "pct": round(float(np.sum((valid_mask) & (arr >= 50))) / float(np.sum(valid_mask)) * 100, 1)},
    }

    img = Image.fromarray(rgba, mode="RGBA")
    out_png_path = os.path.join(output_dir, out_filename)
    img.save(out_png_path, "PNG", optimize=True)

    return {
        "id": out_filename.replace(".png", ""),
        "name": raster_name,
        "image": f"/data/dourorisk/{out_filename}",
        "extent": extent_wgs,
        "resolution": "25m",
        "stats": stats
    }

if __name__ == "__main__":
    main()

