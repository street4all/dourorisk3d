import urllib.request
import gzip
import json
import time
import os

print("=== Extração de Edifícios Microsoft AI para Todo o Concelho de Alijó ===", flush=True)

# 1. Carregar Limite do Concelho e Freguesias
with open('public/data/alijo-concelho.geojson', 'r', encoding='utf-8') as f:
    concelho_data = json.load(f)
    concelho_poly = concelho_data['features'][0]['geometry']['coordinates'][0]

with open('public/data/alijo-freguesias.geojson', 'r', encoding='utf-8') as f:
    freg_features = json.load(f)['features']

freg_polys = []
for ft in freg_features:
    name = ft['properties']['nome_freguesia']
    coords = ft['geometry']['coordinates'][0]
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    freg_polys.append({
        'name': name,
        'coords': coords,
        'bbox': (min(xs), min(ys), max(xs), max(ys))
    })

c_xs = [p[0] for p in concelho_poly]
c_ys = [p[1] for p in concelho_poly]
c_min_x, c_max_x = min(c_xs), max(c_xs)
c_min_y, c_max_y = min(c_ys), max(c_ys)

def point_in_polygon(x, y, poly_coords, bbox):
    min_x, min_y, max_x, max_y = bbox
    if not (min_x <= x <= max_x and min_y <= y <= max_y):
        return False
    inside = False
    n = len(poly_coords)
    p1x, p1y = poly_coords[0]
    for i in range(1, n):
        p2x, p2y = poly_coords[i]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def get_freguesia(cx, cy):
    for f in freg_polys:
        if point_in_polygon(cx, cy, f['coords'], f['bbox']):
            return f['name']
    return "Alijó"

def calculate_area_m2(coords):
    area = 0.0
    n = len(coords)
    for i in range(n - 1):
        x1 = coords[i][0] * 83000.0
        y1 = coords[i][1] * 111000.0
        x2 = coords[i + 1][0] * 83000.0
        y2 = coords[i + 1][1] * 111000.0
        area += (x1 * y2 - x2 * y1)
    return abs(area / 2.0)

# URL oficial dos Edifícios de Satélite da Microsoft (Portugal / Trás-os-Montes / Douro)
url = "https://bfppub.z5.web.core.windows.net/2026-08-13/global-buildings.geojsonl/RegionName=Portugal/quadkey=031332323/part-00060-110f5303-ff85-4c71-a2bf-c6070024fec8.c000.csv.gz"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})

print("A descarregar e processar contornos de satélite da Microsoft...", flush=True)
t0 = time.time()

buildings = []
roofs = []
count = 0
total_lines = 0

with urllib.request.urlopen(req) as resp:
    with gzip.GzipFile(fileobj=resp) as gz:
        for line in gz:
            total_lines += 1
            if total_lines % 50000 == 0:
                print(f"Linhas processadas: {total_lines}... Edifícios em Alijó: {count} ({time.time()-t0:.1f}s)", flush=True)
            try:
                feat = json.loads(line)
                raw_ring = feat['geometry']['coordinates'][0]
                if len(raw_ring) < 3:
                    continue

                cx = sum(p[0] for p in raw_ring) / len(raw_ring)
                cy = sum(p[1] for p in raw_ring) / len(raw_ring)

                if point_in_polygon(cx, cy, concelho_poly, (c_min_x, c_min_y, c_max_x, c_max_y)):
                    count += 1
                    area_m2 = calculate_area_m2(raw_ring)
                    freg_name = get_freguesia(cx, cy)

                    # Round coordinates to 6 decimals (10cm precision, compact size)
                    clean_ring = [[round(p[0], 6), round(p[1], 6)] for p in raw_ring]
                    clean_geom = {
                        "type": "Polygon",
                        "coordinates": [clean_ring]
                    }

                    if area_m2 > 280:
                        b_type = "Quinta / Adega Vinícola"
                        height = 8.5
                        levels = 2
                    elif area_m2 > 130:
                        b_type = "Habitação Duriense Ampla"
                        height = 7.0
                        levels = 2
                    elif area_m2 < 55:
                        b_type = "Anexo / Lagar Agrícola"
                        height = 3.6
                        levels = 1
                    else:
                        b_type = "Habitação Tradicional Duriense"
                        height = 6.0
                        levels = 2

                    buildings.append({
                        "type": "Feature",
                        "id": count,
                        "geometry": clean_geom,
                        "properties": {
                            "id": count,
                            "freguesia": freg_name,
                            "building_type": b_type,
                            "area_m2": round(area_m2, 1),
                            "wall_height": height,
                            "height": height,
                            "levels": levels,
                            "concelho": "Alijó"
                        }
                    })

                    roofs.append({
                        "type": "Feature",
                        "id": f"roof-{count}",
                        "geometry": clean_geom,
                        "properties": {
                            "id": f"roof-{count}",
                            "freguesia": freg_name,
                            "building_type": b_type,
                            "base_height": height,
                            "roof_thickness": 0.8
                        }
                    })
            except Exception as e:
                pass

print(f"\nExtração concluída em {time.time()-t0:.1f}s!", flush=True)
print(f"Total de edifícios extraídos no Concelho de Alijó: {len(buildings)}", flush=True)

out_dir = os.path.abspath("public/data")
os.makedirs(out_dir, exist_ok=True)

b_path = os.path.join(out_dir, "alijo-all-buildings.geojson")
r_path = os.path.join(out_dir, "alijo-all-roofs.geojson")

with open(b_path, "w", encoding="utf-8") as f:
    json.dump({
        "type": "FeatureCollection",
        "name": "Edificios_3D_Concelho_Alijo",
        "features": buildings
    }, f, ensure_ascii=False)

with open(r_path, "w", encoding="utf-8") as f:
    json.dump({
        "type": "FeatureCollection",
        "name": "Telhados_3D_Concelho_Alijo",
        "features": roofs
    }, f, ensure_ascii=False)

b_size_mb = os.path.getsize(b_path) / (1024 * 1024)
r_size_mb = os.path.getsize(r_path) / (1024 * 1024)

print(f"Ficheiros guardados com sucesso:", flush=True)
print(f" - {b_path} ({b_size_mb:.2f} MB)", flush=True)
print(f" - {r_path} ({r_size_mb:.2f} MB)", flush=True)
