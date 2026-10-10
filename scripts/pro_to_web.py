"""
Pro -> Web: produtos DouroRisk da app gerados a partir dos rasters nativos (EPSG:3763).

Lê SEMPRE os valores dos rasters da geodatabase do ArcGIS Pro (arcpy.RasterToNumPyArray),
nunca cores de PNG antigos, e escreve:

  a) public/data/dourorisk/a11y/*_classes.png   grelhas de classes (PNG L, valor = classe, 0 = sem dados)
  b) public/data/dourorisk/a11y/*.png            imagens de visualização (RGBA) pintadas a partir das classes
  c) public/data/dourorisk/valores/              grelhas de valores exatos (PNG L, 255 = sem dados),
                                                 mdt.bin (Int16 LE) e máscara concelho_25m.png
  d) src/data/dourorisk-grids.json               manifest importado pela app (grelhas 3763, codificações, sha256)
     public/data/dourorisk/a11y/README.json

Cada PNG tem as MESMAS dimensões da grelha nativa: píxel (coluna, linha) = célula (coluna, linha),
linha 0 a norte. A georreferenciação está no manifest (x0 = xmin, y0 = ymax, cell em metros, EPSG:3763).

Idempotente: correr duas vezes dá ficheiros byte-idênticos (PNG sem metadados de data; JSON com chaves
ordenadas e "generated" = data de modificação mais recente dos rasters de origem, não o relógio).
Só reescreve um ficheiro quando o conteúdo muda.

Uso (Python do ArcGIS Pro):
    "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\Scripts\\propy.bat" scripts\\pro_to_web.py [--paleta oficial|segura]
        [--gdb RASTER_DATA.gdb] [--repo RAIZ_DO_REPO] [--out-root PASTA_DE_TESTE]
ou dentro do ArcGIS Pro (janela Python):
    import runpy, sys
    sys.argv = ["pro_to_web.py", "--out-root", r"C:\\tmp\\teste"]
    runpy.run_path(r"...\\scripts\\pro_to_web.py", run_name="__main__")

Substitui scripts/prepare_a11y_layers.py e scripts/update_risk_colors.py (ficam no histórico git), que
derivavam as classes das cores de PNG coloridos. As regras abaixo foram inferidas desses PNG e
reproduzem-nos píxel a píxel a partir dos valores nativos.
"""
import argparse
import datetime
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

import arcpy

GDB_POR_OMISSAO = r"C:\Users\PcVIP\Documents\ArcGIS\Packages\DouroRisk_Alijo_aec603\commondata\raster_data.gdb"
CONCELHO_GEOJSON = os.path.join("public", "data", "alijo-concelho.geojson")
MANIFEST = os.path.join("src", "data", "dourorisk-grids.json")
WEB = "/data/dourorisk"                       # caminho público (public/ é a raiz do site)
PASTA = os.path.join("public", "data", "dourorisk")

WKID = 3763                                   # ETRS89 / Portugal TM06
SR_TM06 = arcpy.SpatialReference(WKID)
SR_WGS84 = arcpy.SpatialReference(4326)       # sem transformação de datum: ETRS89 = WGS84 (como a app)

# Rasters da geodatabase (nomes exatos) e a grelha a que pertencem.
R_RISCO = "Risco_Cenario_2025_Incendios_Parametros_Historicos_10m"
R_PERIGO = "Perigosidade_Modelo_Tese_Cenario_2025_10m"
R_ICNF_CONJ = "Perigosidade_Conjuntural_ICNF_2025_25m"
R_ICNF_ESTR = "Perigosidade_Estrutural_ICNF_2020_2030_25m"
R_RECORRENCIA = "Recorrencia_1990_2025_25m"
R_ULTIMO_ANO = "Ultimo_Ano_Ardido_1990_2025_25m"
R_TEMPO_POS_FOGO = "Tempo_Pos_Fogo_1990_2025_25m"
R_BIOMASSA = "Biomassa_Metodo_Original_2025_25m"
R_DECLIVE = "Declive_Percentagem_25m"
R_EXPOSICAO = "Exposicao_25m"
R_MDT = "MDT_Original_25m_EPSG3763"

GRELHAS = {
    "g10_risco": [R_RISCO],
    "g10_perigosidade": [R_PERIGO],
    # todos os rasters de 25 m têm de partilhar a mesma grelha (o script confirma)
    "g25": [R_ICNF_CONJ, R_ICNF_ESTR, R_RECORRENCIA, R_ULTIMO_ANO, R_TEMPO_POS_FOGO, R_BIOMASSA, R_DECLIVE, R_EXPOSICAO, R_MDT],
}

# ---------------------------------------------------------------------------
# Regras das classes (a11y/*_classes.png). Inferidas dos PNG atuais: com estas regras
# as grelhas saem iguais às anteriores célula a célula.
# ---------------------------------------------------------------------------

# Risco/perigo 1..5: a classe é o próprio valor do raster; NoData -> 0.
# No ICNF conjuntural não há NoData: o valor 0 (as mesmas células que são NoData no estrutural,
# fora da área classificada pelo ICNF) também fica 0 = sem dados.
PALAVRAS_RISCO = ("muito baixo", "baixo", "médio", "alto", "muito alto")

# Quantas vezes ardeu: 1, 2, 3, 4 e 5 = 5 ou mais (o raster vai até 9). 0 = nunca ardeu desde 1990
# (o raster não tem NoData: 0 cobre também o exterior do concelho).
RECORRENCIA_MAX = 5

# Declive (%): classe 1 se declive < 15, 2 se < 30, 3 se < 50, 4 se >= 50 (comparação em float32).
DECLIVE_LIMIARES = (15.0, 30.0, 50.0)
PALAVRAS_DECLIVE = ("suave", "moderado", "forte", "escarpado")

# Exposição (graus, 0 = norte, sentido horário): 1 = virada ao sol se 135 <= exposição <= 270
# (sueste, sul, sudoeste e oeste, limites incluídos); 3 = plano se exposição < 0 (convenção -1 do
# ArcGIS; não ocorre neste raster); 2 = virada à sombra (restantes); NoData -> 0 (2622 células,
# sobretudo zonas planas onde a exposição não está definida).
EXPOSICAO_SOL = (135.0, 270.0)

# Biomassa (t/ha): classe 1 se < 5, 2 se < 15, 3 se < 25, 4 se < 32, 5 se >= 32; NoData -> 0.
BIOMASSA_LIMIARES = (5.0, 15.0, 25.0, 32.0)

# ---------------------------------------------------------------------------
# Tabelas de cor (classe -> RGBA). Classe sem cor = transparente (0, 0, 0, 0).
# "oficial": inferidas dos PNG atuais (escala verde -> vermelho escolhida pelo utilizador, commit 5810305).
# "segura": escala aprovada para daltonismo (amarelo-pálido -> castanho-escuro, luminância sempre a
# descer), com a mesma transparência da oficial. Recorrência, sol e biomassa são iguais nas duas.
# ---------------------------------------------------------------------------
ALFA_RISCO = (205, 215, 225, 235, 245)


def _hex(h, a):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), a)


RISCO_OFICIAL = {k + 1: _hex(h, a) for k, (h, a) in enumerate(zip(("#036403", "#88B302", "#FFFE06", "#FE9900", "#DD2203"), ALFA_RISCO))}
RISCO_SEGURA = {k + 1: _hex(h, a) for k, (h, a) in enumerate(zip(("#F7D98A", "#EFA650", "#D0672A", "#983519", "#47180D"), ALFA_RISCO))}
# declive: a classe 1 (suave) fica transparente
DECLIVE_OFICIAL = {2: _hex("#88B302", 190), 3: _hex("#FE9900", 215), 4: _hex("#DD2203", 235)}
DECLIVE_SEGURA = {2: _hex("#F7D98A", 190), 3: _hex("#D0672A", 215), 4: _hex("#47180D", 235)}
# quantas vezes ardeu: 1-2, 3-4, 5 ou mais
RECORRENCIA_CORES = {1: _hex("#EFA650", 190), 2: _hex("#EFA650", 190), 3: _hex("#D0672A", 215), 4: _hex("#D0672A", 215), 5: _hex("#47180D", 235)}
SOL_CORES = {1: _hex("#EFA650", 185)}
BIOMASSA_CORES = {1: _hex("#EDF8E9", 160), 2: _hex("#BAE4B3", 185), 3: _hex("#74C476", 205), 4: _hex("#31A354", 225), 5: _hex("#006D2C", 245)}

PALETAS = {
    "oficial": {"risco": RISCO_OFICIAL, "declive": DECLIVE_OFICIAL, "recorrencia": RECORRENCIA_CORES, "sol": SOL_CORES, "biomassa": BIOMASSA_CORES},
    "segura": {"risco": RISCO_SEGURA, "declive": DECLIVE_SEGURA, "recorrencia": RECORRENCIA_CORES, "sol": SOL_CORES, "biomassa": BIOMASSA_CORES},
}

# ---------------------------------------------------------------------------
# Codificação das grelhas de valores exatos (valores/*.png, 8 bits, 255 = sem dados).
# ---------------------------------------------------------------------------
SEM_DADOS = 255
ULTIMO_ANO_BASE = 1989          # ultimo_ano.png: valor = ano - 1989 (1990 -> 1 ... 2025 -> 36); 0 = nunca ardeu
TEMPO_NUNCA = 254               # tempo_pos_fogo.png: anos desde o último fogo (0 = ardeu em 2025); 254 = nunca ardeu
EXPOSICAO_PASSO = 2             # exposicao.png: graus / 2 arredondado (0..179, 360° volta a 0 = norte)
EXPOSICAO_PLANO = 254           # exposicao.png: exposição < 0 (plano); não ocorre neste raster
MDT_SEM_DADOS = -32768          # mdt.bin: Int16 little-endian; o raster não tem NoData


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------
# tipo de píxel -> duas sentinelas distintas que cabem no tipo
_SENTINELAS = {"U8": (200, 201), "U16": (60000, 60001), "S16": (-32000, -32001), "F32": (-12345.0, -23456.0)}


def ler(gdb, nome):
    """Valores do raster (NoData posto a 0), máscara de NoData exata e ficha do raster.

    O NoData destes rasters não vem declarado (noDataValue = None) e o preenchimento por omissão
    do RasterToNumPyArray mistura 0 e 255/65535 consoante o bloco; por isso lê-se duas vezes com
    sentinelas diferentes: as células que mudam são NoData."""
    caminho = os.path.join(gdb, nome)
    r = arcpy.Raster(caminho)
    a_val, b_val = _SENTINELAS[r.pixelType]
    a = arcpy.RasterToNumPyArray(caminho, nodata_to_value=a_val)
    b = arcpy.RasterToNumPyArray(caminho, nodata_to_value=b_val)
    nd = a != b
    ext = arcpy.Describe(caminho).extent
    assert r.spatialReference.factoryCode == WKID, f"{nome}: esperava EPSG:{WKID}"
    assert abs(r.meanCellWidth - r.meanCellHeight) < 1e-9, f"{nome}: células não quadradas"
    assert a.shape == (r.height, r.width), f"{nome}: dimensões inesperadas"
    info = {
        "pixelType": r.pixelType,
        "width": int(r.width),
        "height": int(r.height),
        "cell": _num(r.meanCellWidth),
        # precisão total do double (repr no JSON): x0/y0 das grelhas saem daqui e a app tem de bater
        # com o Pro ao µm (arredondar a 0,1 mm deslocava a grelha g10_perigosidade 6 µm)
        "extent": {"xmin": float(ext.XMin), "ymin": float(ext.YMin), "xmax": float(ext.XMax), "ymax": float(ext.YMax)},
        "nodataCells": int(nd.sum()),
    }
    v = a[~nd]
    info["min"] = _num(v.min()) if v.size else None
    info["max"] = _num(v.max()) if v.size else None
    return np.where(nd, 0, a).astype(a.dtype), nd, info


def _num(x):
    """Número curto e estável para o JSON (float32 com a representação mais curta)."""
    if isinstance(x, (np.floating, float)):
        f = float(np.format_float_positional(np.float32(x), unique=True, trim="-"))
        return int(f) if f.is_integer() else f
    return int(x)


def datas_modificacao(gdb, nomes):
    """Data de modificação de cada raster: a mais recente dos ficheiros das suas tabelas na gdb
    (o raster, fras_ras_/aux_/blk_/bnd_ e VAT_), via GDB_SystemCatalog (linha N -> aNNNNNNNN.*)."""
    ficheiros = os.listdir(gdb)
    ids = {}
    with arcpy.da.SearchCursor(os.path.join(gdb, "GDB_SystemCatalog"), ["ID", "Name"]) as cur:
        for i, n in cur:
            ids.setdefault(n.lower(), int(i))
    datas = {}
    for nome in nomes:
        tabelas = [nome] + [p + nome for p in ("fras_ras_", "fras_aux_", "fras_blk_", "fras_bnd_", "VAT_")]
        prefixos = ["a%08x." % ids[t.lower()] for t in tabelas if t.lower() in ids]
        assert prefixos, f"{nome}: não encontrei as tabelas na gdb"
        t = max(os.path.getmtime(os.path.join(gdb, f)) for f in ficheiros if any(f.lower().startswith(p) for p in prefixos) and not f.endswith(".lock"))
        datas[nome] = datetime.datetime.fromtimestamp(int(t), datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datas


# ---------------------------------------------------------------------------
# Grelhas e geometria (EPSG:3763)
# ---------------------------------------------------------------------------
def grelha(info):
    """{width, height, x0, y0, cell}: x0 = xmin e y0 = ymax (bordos exteriores das células), em metros."""
    return {"width": info["width"], "height": info["height"], "x0": info["extent"]["xmin"], "y0": info["extent"]["ymax"], "cell": info["cell"]}


def cantos_wgs84(g):
    """4 cantos exteriores da grelha em lon/lat (arcpy, sem transformação), só para verificação."""
    x1 = g["x0"] + g["width"] * g["cell"]
    y1 = g["y0"] - g["height"] * g["cell"]
    out = {}
    for k, (x, y) in (("tl", (g["x0"], g["y0"])), ("tr", (x1, g["y0"])), ("br", (x1, y1)), ("bl", (g["x0"], y1))):
        p = arcpy.PointGeometry(arcpy.Point(x, y), SR_TM06).projectAs(SR_WGS84).firstPoint
        out[k] = [round(p.X, 9), round(p.Y, 9)]
    return out


def mascara_concelho(geojson, g):
    """1 = centro da célula dentro do limite do concelho (GeoJSON lon/lat projetado para 3763 com arcpy).
    Ponto-no-polígono par-ímpar, linha a linha: cruzamentos da horizontal do centro com as arestas."""
    with open(geojson, encoding="utf-8") as f:
        fc = json.load(f)
    aneis = []
    for feat in fc["features"]:
        geom = feat["geometry"]
        poligonos = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for pol in poligonos:
            for anel in pol:
                xy = []
                for lon, lat in (c[:2] for c in anel):
                    p = arcpy.PointGeometry(arcpy.Point(lon, lat), SR_WGS84).projectAs(SR_TM06).firstPoint
                    xy.append((p.X, p.Y))
                aneis.append(np.array(xy, dtype=np.float64))
    xa = np.concatenate([a[:, 0] for a in aneis])
    ya = np.concatenate([a[:, 1] for a in aneis])
    xb = np.concatenate([np.roll(a[:, 0], -1) for a in aneis])
    yb = np.concatenate([np.roll(a[:, 1], -1) for a in aneis])
    cx = g["x0"] + (np.arange(g["width"]) + 0.5) * g["cell"]
    m = np.zeros((g["height"], g["width"]), np.uint8)
    for row in range(g["height"]):
        cy = g["y0"] - (row + 0.5) * g["cell"]
        cruza = (ya > cy) != (yb > cy)
        if not cruza.any():
            continue
        xi = np.sort(xa[cruza] + (cy - ya[cruza]) * (xb[cruza] - xa[cruza]) / (yb[cruza] - ya[cruza]))
        m[row] = (np.searchsorted(xi, cx, side="left") % 2).astype(np.uint8)
    return m


# ---------------------------------------------------------------------------
# Classes, cores e valores
# ---------------------------------------------------------------------------
def classes_risco(v, nd):
    c = np.where(nd, 0, v).astype(np.uint8)
    assert set(np.unique(c).tolist()) <= {0, 1, 2, 3, 4, 5}
    return c


def classes_recorrencia(v, nd):
    return np.where(nd, 0, np.minimum(v, RECORRENCIA_MAX)).astype(np.uint8)


def classes_por_limiares(v, nd, limiares):
    c = (np.digitize(v, np.asarray(limiares, dtype=v.dtype), right=False) + 1).astype(np.uint8)  # v < l1 -> 1 ...
    c[nd] = 0
    return c


def classes_sol(v, nd):
    sol = (v >= EXPOSICAO_SOL[0]) & (v <= EXPOSICAO_SOL[1])
    return np.select([nd, v < 0, sol], [0, 3, 1], default=2).astype(np.uint8)


def pintar(cls, cores):
    rgba = np.zeros(cls.shape + (4,), np.uint8)
    for k, cor in cores.items():
        rgba[cls == k] = cor
    return rgba


def valores_ultimo_ano(v, nd, rec):
    # no raster, NoData = nunca ardeu (as mesmas células que recorrência 0)
    out = np.where(nd, 0, v.astype(np.int32) - ULTIMO_ANO_BASE)
    out[nd & (rec != 0)] = SEM_DADOS
    assert out[~nd].max() <= 254 and out[~nd].min() >= 1
    return out.astype(np.uint8)


def valores_tempo(v, nd, rec):
    out = np.where(nd, TEMPO_NUNCA, v.astype(np.int32))
    out[nd & (rec != 0)] = SEM_DADOS
    assert out[~nd].max() < TEMPO_NUNCA
    return out.astype(np.uint8)


def valores_declive(v, nd):
    out = np.floor(v.astype(np.float64) + 0.5)  # inteiro mais próximo, 0,5 para cima
    assert out[~nd].max() < SEM_DADOS
    out[nd] = SEM_DADOS
    return out.astype(np.uint8)


def valores_exposicao(v, nd):
    out = np.floor(v.astype(np.float64) / EXPOSICAO_PASSO + 0.5) % (360 // EXPOSICAO_PASSO)
    out[v < 0] = EXPOSICAO_PLANO
    out[nd] = SEM_DADOS
    return out.astype(np.uint8)


def valores_biomassa(v, nd):
    lut = np.unique(v[~nd])
    assert lut.size < 255, "biomassa: demasiados valores distintos para um índice de 8 bits"
    out = np.searchsorted(lut, v).astype(np.int32)
    out[nd] = SEM_DADOS
    return out.astype(np.uint8), [_num(x) for x in lut]


# ---------------------------------------------------------------------------
# Escrita
# ---------------------------------------------------------------------------
def png_bytes(arr):
    """PNG sem metadados (sem tIME/gAMA/iCCP): modo L para 2D uint8, RGBA para HxWx4."""
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(arr)).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


class Escritor:
    def __init__(self, out_root):
        self.out_root = out_root
        self.sha = {}
        self.estado = []

    def gravar(self, rel, dados, web=None):
        """Grava só se o conteúdo mudou. rel = caminho relativo à raiz de saída."""
        caminho = os.path.join(self.out_root, rel)
        os.makedirs(os.path.dirname(caminho), exist_ok=True)
        antigo = None
        if os.path.exists(caminho):
            with open(caminho, "rb") as f:
                antigo = f.read()
        if antigo != dados:
            with open(caminho, "wb") as f:
                f.write(dados)
        self.estado.append((rel, "novo" if antigo is None else ("igual" if antigo == dados else "alterado"), len(dados)))
        if web:
            self.sha[web] = hashlib.sha256(dados).hexdigest()
        return web


def web_de(rel):
    return "/" + os.path.relpath(rel, "public").replace(os.sep, "/")


def main(argv=None):
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description="Gera os produtos web DouroRisk a partir dos rasters do ArcGIS Pro.")
    ap.add_argument("--gdb", default=GDB_POR_OMISSAO)
    ap.add_argument("--repo", default=raiz, help="raiz do repo (lê public/data/alijo-concelho.geojson)")
    ap.add_argument("--out-root", default=None, help="raiz onde escrever (por omissão a do repo)")
    ap.add_argument("--paleta", choices=sorted(PALETAS), default="oficial")
    args = ap.parse_args(argv)
    out_root = args.out_root or args.repo
    cores = PALETAS[args.paleta]
    esc = Escritor(out_root)
    print(f"gdb: {args.gdb}\nrepo: {args.repo}\nsaída: {out_root}\npaleta: {args.paleta}", flush=True)

    # --- leitura -------------------------------------------------------------
    nomes = [n for ns in GRELHAS.values() for n in ns]
    dados, nodata, fontes = {}, {}, {}
    for n in nomes:
        dados[n], nodata[n], fontes[n] = ler(args.gdb, n)
        print(f"  lido {n}: {fontes[n]['width']}x{fontes[n]['height']} {fontes[n]['pixelType']} NoData={fontes[n]['nodataCells']}", flush=True)
    for n, d in datas_modificacao(args.gdb, nomes).items():
        fontes[n]["modified"] = d
    grids = {}
    for gid, ns in GRELHAS.items():
        grids[gid] = grelha(fontes[ns[0]])
        for n in ns[1:]:
            assert grelha(fontes[n]) == grids[gid], f"{n} não está na grelha {gid}"

    a11y = os.path.join(PASTA, "a11y")
    val = os.path.join(PASTA, "valores")
    layers = {}

    def camada(chave, grid, fonte, files, encoding, classes=()):
        layers[chave] = {
            "grid": grid,
            "source": fonte,
            "files": {k: v for k, v in files.items() if v},
            "encoding": encoding,
            "classes": [{"value": k, "rule": r} for k, r in classes],
            "sha256": {w: esc.sha[w] for w in files.values() if w},
        }

    def cls_png(nome, cls):
        return esc.gravar(os.path.join(a11y, nome + "_classes.png"), png_bytes(cls), web_de(os.path.join(a11y, nome + "_classes.png")))

    def rgba_png(rel, cls, tabela):
        return esc.gravar(rel, png_bytes(pintar(cls, tabela)), web_de(rel))

    enc_classes = {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados"}}

    # --- a) + b) camadas de classes e imagens --------------------------------
    for chave, raster, grid in (("risco_2025", R_RISCO, "g10_risco"), ("perigosidade_2025", R_PERIGO, "g10_perigosidade"),
                                ("icnf_conjuntural", R_ICNF_CONJ, "g25"), ("icnf_estrutural", R_ICNF_ESTR, "g25")):
        cls = classes_risco(dados[raster], nodata[raster])
        regras = [(k, f"{raster} = {k} ({PALAVRAS_RISCO[k - 1]})") for k in range(1, 6)]
        enc = dict(enc_classes)
        if chave == "icnf_conjuntural":
            enc["special"] = {"0": "sem dados (valor 0 no raster, fora da área classificada pelo ICNF)"}
        camada(chave, grid, raster, {"classes": cls_png(chave, cls), "display": rgba_png(os.path.join(a11y, chave + ".png"), cls, cores["risco"])}, enc, regras)

    cls = classes_recorrencia(dados[R_RECORRENCIA], nodata[R_RECORRENCIA])
    regras = [(k, f"{R_RECORRENCIA} = {k}") for k in range(1, RECORRENCIA_MAX)] + [(RECORRENCIA_MAX, f"{R_RECORRENCIA} >= {RECORRENCIA_MAX}")]
    camada("recorrencia_a11y", "g25", R_RECORRENCIA,
           {"classes": cls_png("recorrencia", cls), "display": rgba_png(os.path.join(a11y, "recorrencia.png"), cls, cores["recorrencia"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "nunca ardeu desde 1990 (o raster não tem NoData; inclui o exterior do concelho)"}}, regras)

    cls = classes_por_limiares(dados[R_DECLIVE], nodata[R_DECLIVE], DECLIVE_LIMIARES)
    lim = DECLIVE_LIMIARES
    regras = [(1, f"declive < {lim[0]:g} % ({PALAVRAS_DECLIVE[0]}; transparente)"), (2, f"{lim[0]:g} % <= declive < {lim[1]:g} % ({PALAVRAS_DECLIVE[1]})"),
              (3, f"{lim[1]:g} % <= declive < {lim[2]:g} % ({PALAVRAS_DECLIVE[2]})"), (4, f"declive >= {lim[2]:g} % ({PALAVRAS_DECLIVE[3]})")]
    camada("declive_a11y", "g25", R_DECLIVE,
           {"classes": cls_png("declive", cls), "display": rgba_png(os.path.join(a11y, "declive.png"), cls, cores["declive"])}, dict(enc_classes), regras)

    cls = classes_sol(dados[R_EXPOSICAO], nodata[R_EXPOSICAO])
    regras = [(1, f"{EXPOSICAO_SOL[0]:g}° <= exposição <= {EXPOSICAO_SOL[1]:g}° (virada ao sol: sueste a oeste)"),
              (2, "restantes exposições (virada à sombra)"), (3, "exposição < 0 (plano; não ocorre neste raster)")]
    camada("exposicao_sol", "g25", R_EXPOSICAO,
           {"classes": cls_png("exposicao_sol", cls), "display": rgba_png(os.path.join(a11y, "exposicao_sol.png"), cls, cores["sol"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados (NoData no raster: exposição indefinida, sobretudo zonas planas)"}}, regras)

    cls = classes_por_limiares(dados[R_BIOMASSA], nodata[R_BIOMASSA], BIOMASSA_LIMIARES)
    lim = BIOMASSA_LIMIARES
    regras = [(1, f"biomassa < {lim[0]:g} t/ha")] + [(k + 2, f"{lim[k]:g} t/ha <= biomassa < {lim[k + 1]:g} t/ha") for k in range(3)] + [(5, f"biomassa >= {lim[3]:g} t/ha")]
    camada("biomassa_2025", "g25", R_BIOMASSA,
           {"classes": cls_png("biomassa", cls), "display": rgba_png(os.path.join(a11y, "biomassa.png"), cls, cores["biomassa"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados (NoData no raster: nunca ardeu desde 1990 ou ardeu em 2025)"}}, regras)

    # --- c) grelhas de valores exatos ----------------------------------------
    def val_png(nome, arr):
        rel = os.path.join(val, nome + ".png")
        return esc.gravar(rel, png_bytes(arr), web_de(rel))

    rec, rec_nd = dados[R_RECORRENCIA], nodata[R_RECORRENCIA]
    arr = np.where(rec_nd, SEM_DADOS, rec).astype(np.uint8)
    camada("recorrencia_valor", "g25", R_RECORRENCIA, {"values": val_png("recorrencia", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "vezes", "special": {"255": "sem dados"},
            "note": "número de vezes que ardeu de 1990 a 2025 (0 = nunca; o raster não tem NoData e cobre também o exterior do concelho)"})

    arr = valores_ultimo_ano(dados[R_ULTIMO_ANO], nodata[R_ULTIMO_ANO], rec)
    camada("ultimo_ano", "g25", R_ULTIMO_ANO, {"values": val_png("ultimo_ano", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": ULTIMO_ANO_BASE, "unit": "ano",
            "special": {"0": "nunca ardeu desde 1990", "255": "sem dados"}, "note": "ano = valor + 1989 (1990..2025)"})

    arr = valores_tempo(dados[R_TEMPO_POS_FOGO], nodata[R_TEMPO_POS_FOGO], rec)
    camada("tempo_pos_fogo", "g25", R_TEMPO_POS_FOGO, {"values": val_png("tempo_pos_fogo", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "anos",
            "special": {str(TEMPO_NUNCA): "nunca ardeu desde 1990 (NoData no raster, as mesmas células que recorrência 0)", "255": "sem dados"},
            "note": "anos desde o último fogo em 2025 (0 = ardeu em 2025; = 2025 - último ano)"})

    arr = valores_declive(dados[R_DECLIVE], nodata[R_DECLIVE])
    camada("declive_pct", "g25", R_DECLIVE, {"values": val_png("declive_pct", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "%", "special": {"255": "sem dados"},
            "note": "declive arredondado ao inteiro mais próximo (0,5 para cima)"})

    arr = valores_exposicao(dados[R_EXPOSICAO], nodata[R_EXPOSICAO])
    camada("exposicao_graus", "g25", R_EXPOSICAO, {"values": val_png("exposicao", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": EXPOSICAO_PASSO, "offset": 0, "unit": "graus",
            "special": {str(EXPOSICAO_PLANO): "plano (exposição < 0; não ocorre)", "255": "sem dados"},
            "note": "graus = valor x 2 (0 = norte, sentido horário; arredondado, erro <= 1°; 360° volta a 0)"})

    arr, lut = valores_biomassa(dados[R_BIOMASSA], nodata[R_BIOMASSA])
    camada("biomassa_t_ha", "g25", R_BIOMASSA, {"values": val_png("biomassa", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "lut": lut, "unit": "t/ha", "special": {"255": "sem dados (nunca ardeu desde 1990 ou ardeu em 2025)"},
            "note": "t/ha = lut[valor] (valores exatos do raster, float32 na representação mais curta)"})

    mdt = np.where(nodata[R_MDT], MDT_SEM_DADOS, dados[R_MDT]).astype("<i2")
    rel = os.path.join(val, "mdt.bin")
    camada("mdt", "g25", R_MDT, {"values": esc.gravar(rel, mdt.tobytes(), web_de(rel))},
           {"format": "int16le", "nodata": MDT_SEM_DADOS, "scale": 1, "offset": 0, "unit": "m",
            "note": "Int16 little-endian, width x height valores, linha a linha de norte para sul, de oeste para este"})

    conc = mascara_concelho(os.path.join(args.repo, CONCELHO_GEOJSON), grids["g25"])
    camada("concelho_25m", "g25", CONCELHO_GEOJSON.replace(os.sep, "/"), {"values": val_png("concelho_25m", conc)},
           {"format": "png-l8", "special": {"0": "fora do concelho", "1": "centro da célula dentro do concelho"},
            "note": "limite do concelho (GeoJSON lon/lat) projetado para EPSG:3763 com arcpy, sem transformação de datum"})

    # --- d) manifest e README -------------------------------------------------
    casa = os.path.expanduser("~")
    gdb_txt = args.gdb
    if gdb_txt.lower().startswith(casa.lower()):
        gdb_txt = "~" + gdb_txt[len(casa):]
    manifest = {
        "version": 1,
        "generated": max(f["modified"] for f in fontes.values()),
        "script": "scripts/pro_to_web.py",
        "palette": args.paleta,
        "source": {"gdb": gdb_txt.replace("\\", "/"), "rasters": fontes},
        "crs": {"wkid": WKID, "name": "ETRS89 / Portugal TM06"},
        "grids": grids,
        "layers": layers,
        "cornersWgs84": {gid: cantos_wgs84(g) for gid, g in grids.items()},
    }
    texto = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    esc.gravar(MANIFEST, texto.encode("utf-8"))
    readme = {"generated_by": "scripts/pro_to_web.py", "manifest": "src/data/dourorisk-grids.json", "palette": args.paleta,
              "note": "Grelhas e imagens geradas a partir dos rasters nativos EPSG:3763; georreferenciação no manifest."}
    esc.gravar(os.path.join(a11y, "README.json"), (json.dumps(readme, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"))

    for rel, estado, n in esc.estado:
        print(f"  {estado:8s} {n:>9d}  {rel}")
    print(f"ok: {len(esc.estado)} ficheiros ({sum(e == 'alterado' for _, e, _ in esc.estado)} alterados, "
          f"{sum(e == 'novo' for _, e, _ in esc.estado)} novos)", flush=True)
    return manifest


if __name__ == "__main__":
    main(sys.argv[1:])
