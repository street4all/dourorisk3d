"""
Pro -> Web: produtos DouroRisk da app gerados a partir dos rasters nativos (EPSG:3763).

Lê SEMPRE os valores dos rasters da geodatabase do ArcGIS Pro (arcpy.RasterToNumPyArray),
nunca cores de PNG antigos, e escreve:

  a) public/data/dourorisk/a11y/*_classes.png   grelhas de classes (PNG L, valor = classe, 0 = sem dados)
  b) public/data/dourorisk/a11y/*.png            imagens de visualização (RGBA) pintadas a partir das classes
  c) public/data/dourorisk/valores/              grelhas de valores exatos (PNG L, 255 = sem dados),
                                                 mdt.bin (Int16 LE), máscara concelho_25m.png e
                                                 rio_douro_25m.png (1 = superfície do rio Douro no MDT)
  d) src/data/dourorisk-grids.json               manifest importado pela app (version 2: grelhas 3763,
                                                 codificações, sha256, layers.*.about = «Como sabemos?»
                                                 e bloco "concelho" com as contagens exatas do concelho)
     public/data/dourorisk/a11y/README.json

Cada PNG tem as MESMAS dimensões da grelha nativa: píxel (coluna, linha) = célula (coluna, linha),
linha 0 a norte. A georreferenciação está no manifest (x0 = xmin, y0 = ymax, cell em metros, EPSG:3763).

Bloco "concelho" do manifest: contagens por classe/valor dentro do concelho (centro da célula dentro do
limite projetado para 3763, uma máscara por grelha: g25, g10_risco e g10_perigosidade), contadas sobre os
arrays nativos (não sobre os PNG); área = células × lado², percentagens com 4 casas decimais.
Os textos de proveniência (SOBRE) são verificados nos rasters (verificar_dados): um texto que deixe de
ser verdade faz o script parar.

Idempotente: correr duas vezes dá ficheiros byte-idênticos (PNG sem metadados de data; JSON com chaves
ordenadas e "generated" = data de modificação mais recente dos rasters de origem, sem as tabelas VAT_,
que são derivadas; não o relógio).
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
import re
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

# Rio Douro no MDT: células planas (declive 0, exposição sem dados) a esta altitude ou menos (a albufeira está a 78–81 m).
RIO_MAX_M = 90

# ---------------------------------------------------------------------------
# «Como sabemos?»: proveniência de cada camada, em Leitura Fácil (pt-PT). É escrita em layers.<chave>.about.
# "ano": "AAAA", "AAAA–AAAA" (travessão U+2013) ou None (terreno, limite). {max_t_ha} e {rio_m} vêm dos dados
# (verificar_dados e o rio, em main). camada() confirma que cada ano está no nome do raster e que nenhuma
# frase de "metodo" ou "nota" passa de 15 palavras; verificar_dados() confirma nos rasters o que os textos
# afirmam (mato só função dos anos sem arder, mato sem dados = nunca ardeu ou ardeu no último ano, exposição
# sem dados = plano, ICNF 2025 mais baixo onde ardeu em 2022 e 2024, último ano = 2025).
# ---------------------------------------------------------------------------
ESTUDO = "estudo DouroRisk"
TERRENO = "terreno do estudo DouroRisk"
OFICIAL = "mapa oficial do ICNF"
CENARIO = "É um cenário para 2025, feito com os fogos do passado. Não é uma medição nem uma previsão."
SEM_NUMERO = "Não dá número a alguns sítios, por exemplo zonas com casas e o rio."
SOBRE = {
    "risco": dict(titulo="Risco de fogo", fonte=ESTUDO, fonte_curta="estudo, 2025", ano="2025",
                  metodo="Junta o perigo de fogo com o que se pode perder.", nota=CENARIO),
    "perigosidade": dict(titulo="Perigo de fogo (estudo)", fonte=ESTUDO, fonte_curta="estudo, 2025", ano="2025",
                         metodo="Um cálculo mostra onde é mais provável arder.", nota=CENARIO),
    "icnf_conjuntural": dict(titulo="Perigo oficial de 2025", fonte=OFICIAL, fonte_curta="ICNF, 2025", ano="2025",
                             metodo="O ICNF faz este mapa todos os anos. Usa o mapa de 2020 a 2030. "
                                    "Onde ardeu de 2022 a 2024, o perigo é mais baixo.",
                             nota=SEM_NUMERO),
    "icnf_estrutural": dict(titulo="Perigo oficial de 2020 a 2030", fonte=OFICIAL, fonte_curta="ICNF, 2020–2030", ano="2020–2030",
                            metodo="Junta os fogos do passado, a inclinação e o que cobre o terreno.", nota=SEM_NUMERO),
    "recorrencia": dict(titulo="Quantas vezes ardeu", fonte=ESTUDO, fonte_curta="estudo, 1990–2025", ano="1990–2025",
                        metodo="Junta os mapas do que ardeu em cada ano. Depois conta as vezes em cada sítio.",
                        nota="Antes de 1990 não há dados."),
    "ultimo_ano": dict(titulo="Último fogo", fonte=ESTUDO, fonte_curta="estudo, 1990–2025", ano="1990–2025",
                       metodo="Guarda o ano do último fogo em cada sítio.", nota="Antes de 1990 não há dados."),
    "tempo_pos_fogo": dict(titulo="Anos sem arder", fonte=ESTUDO, fonte_curta="estudo, até 2025", ano="1990–2025",
                           metodo="Conta os anos entre o último fogo e 2025.", nota="Onde não ardeu de 1990 a 2025, não há valor."),
    "biomassa": dict(titulo="Quanto mato há", fonte=ESTUDO + " (estimativa)", fonte_curta="estimativa, 2025", ano="2025",
                     metodo="Não é uma medição. Conta os anos desde o último fogo e estima quanto mato voltou a crescer.",
                     nota="Só há número onde o último fogo foi de 1990 a 2024. "
                          "O máximo do cálculo é {max_t_ha} toneladas por hectare. 1 hectare é um quadrado com 100 metros de lado."),
    "declive": dict(titulo="Inclinação da encosta", fonte=TERRENO, fonte_curta="estudo, terreno", ano=None,
                    metodo="Mede quantos metros o terreno sobe em cada 100 metros.", nota="O terreno muda muito pouco com os anos."),
    "exposicao": dict(titulo="Para onde está virada a encosta", fonte=TERRENO, fonte_curta="estudo, terreno", ano=None,
                      metodo="Vê para que lado o terreno desce: por exemplo, norte, nascente, sul ou poente.",
                      nota="Virada ao sol quer dizer virada entre sudeste e poente. Essas encostas apanham mais sol. "
                           "Nos sítios planos não há lado."),
    "mdt": dict(titulo="Altitude", fonte=TERRENO, fonte_curta="estudo, terreno", ano=None,
                metodo="Dá a altura do chão acima do nível do mar.",
                nota="Na ficha, a altitude vai arredondada a 5 metros. O mapa 3D usa outro terreno. "
                     "Pode haver alguns metros de diferença."),
    "rio": dict(titulo="Rio Douro", fonte=TERRENO, fonte_curta="estudo, terreno", ano=None,
                metodo="É a parte plana mais baixa do terreno, a cerca de {rio_m} metros.",
                nota="Junto às margens, o rio pode não ser reconhecido."),
    "concelho": dict(titulo="Limite do concelho", fonte="Carta Administrativa Oficial de Portugal", fonte_curta="limite oficial", ano=None,
                     metodo="Um quadrado conta como dentro se o seu centro estiver dentro do limite.",
                     nota="O limite é aproximado. Junto à linha, um ponto pode ficar do lado errado."),
}

# Bloco "concelho" do manifest: textos fixos para quem mantém os dados (não são mostrados na app).
CONCELHO_LIMITE = {
    "fonte": CONCELHO_GEOJSON.replace(os.sep, "/"),
    "origem": "CAOP (DGT), via github.com/nmota/caop_GeoJSON (coordenadas com 4 casas decimais)",
    "regra": "uma célula conta como dentro se o centro estiver dentro do limite (par-ímpar); "
             "limite projetado para EPSG:3763 com arcpy, sem transformação de datum",
}
CONCELHO_NOTAS = {
    "altitude_m": "min = cova do MDT junto à foz do Tua (vizinhos de 39 a 81 m), não é o rio: não publicar; "
                  "rio = mediana (inferior) do MDT nas células de rio_douro_25m dentro do concelho",
    "ha": "ha = células × lado² / 10 000 (plano PT-TM06), sem arredondar; % com 4 casas decimais",
    "ha_por_ultimo_ano": "área cujo ÚLTIMO fogo foi nesse ano: é um mínimo da área ardida nesse ano, exceto no último ano (exato)",
}
# Área do concelho: a soma das células (base de todas as percentagens) tem de bater com a área do polígono
# (plano PT-TM06) a menos desta fração (hoje 29 758,75 ha contra 29 760,65 ha: 0,006 %).
AREA_TOLERANCIA = 0.0005


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
    (o raster e fras_ras_/aux_/blk_/bnd_), via GDB_SystemCatalog (linha N -> aNNNNNNNN.*).

    A tabela de atributos (VAT_) não conta: é derivada dos píxeis e o Pro cria-a ou refá-la sem mudar
    os dados (TabulateArea, BuildRasterAttributeTable…); com ela, uma operação dessas mudava o manifest."""
    ficheiros = os.listdir(gdb)
    ids = {}
    with arcpy.da.SearchCursor(os.path.join(gdb, "GDB_SystemCatalog"), ["ID", "Name"]) as cur:
        for i, n in cur:
            ids.setdefault(n.lower(), int(i))
    datas = {}
    for nome in nomes:
        tabelas = [nome] + [p + nome for p in ("fras_ras_", "fras_aux_", "fras_blk_", "fras_bnd_")]
        prefixos = ["a%08x." % ids[t.lower()] for t in tabelas if t.lower() in ids]
        assert prefixos, f"{nome}: não encontrei as tabelas na gdb"
        t = max(os.path.getmtime(os.path.join(gdb, f)) for f in ficheiros if any(f.lower().startswith(p) for p in prefixos) and not f.endswith(".lock"))
        datas[nome] = datetime.datetime.fromtimestamp(int(t), datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return datas


def verificar_dados(dados, nodata):
    """Confirma nos rasters o que os textos de SOBRE afirmam. Devolve os números que entram nos textos
    e o último ano dos dados (o fim do período, lido no raster e não nas contagens do concelho)."""
    bio, bio_nd = dados[R_BIOMASSA], nodata[R_BIOMASSA]
    tpf = dados[R_TEMPO_POS_FOGO]
    rec = dados[R_RECORRENCIA]
    ua, ua_nd = dados[R_ULTIMO_ANO], nodata[R_ULTIMO_ANO]
    assert np.array_equal(rec > 0, ~ua_nd), "recorrência > 0 tem de ter último ano"
    ano_fim = int(ua[~ua_nd].max())
    assert ano_fim == 2025, f"o último ano é {ano_fim}: atualiza os textos de SOBRE (dizem 2025)"
    ok = ~bio_nd
    for t in np.unique(tpf[ok]):   # o mato depende só dos anos desde o último fogo
        assert np.unique(bio[ok & (tpf == t)]).size == 1, f"biomassa: mais de um valor com {t} anos sem arder"
    assert np.array_equal(bio_nd, (rec == 0) | (~ua_nd & (ua == ano_fim))), "mato sem dados tem de ser: nunca ardeu ou ardeu no último ano"
    dec, dec_nd = dados[R_DECLIVE], nodata[R_DECLIVE]
    assert np.array_equal(nodata[R_EXPOSICAO], (dec == 0) & ~dec_nd), "exposição sem dados tem de ser declive 0 (plano)"
    cj, es, es_nd = dados[R_ICNF_CONJ], dados[R_ICNF_ESTR], nodata[R_ICNF_ESTR]
    assert not nodata[R_ICNF_CONJ].any() and np.array_equal(cj == 0, es_nd), "ICNF 2025 = 0 tem de ser ICNF 2020-2030 sem dados"
    assert (cj[~es_nd] <= es[~es_nd]).all(), "ICNF 2025 tem de ser <= ICNF 2020-2030"
    baixou = ~es_nd & (cj < es)
    for anos, lo, hi in (((2022,), 0.95, 1.0), ((2024,), 0.95, 1.0), (tuple(range(1990, 2022)), 0.0, 0.01)):
        m = ~es_nd & ~ua_nd & np.isin(ua, anos)
        f = float(baixou[m].mean())
        assert lo <= f <= hi, f"ICNF: fração que baixou com último fogo em {anos[0]}-{anos[-1]} = {f:.4f}"
        print(f"  ICNF 2025 mais baixo onde o último fogo foi em {anos[0]}-{anos[-1]}: {f:.4f}", flush=True)
    return {"max_t_ha": f"{float(bio[ok].max()):g}"}, ano_fim


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


def aneis_tm06(geojson):
    """Anéis do limite (GeoJSON lon/lat) projetados vértice a vértice para 3763 com arcpy (sem transformação):
    lista de arrays (n, 2) em metros."""
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
    return aneis


def area_poligono_ha(geojson):
    """Área planar PT-TM06 do limite (fórmula do laço: |soma das áreas com sinal dos anéis|), em hectares."""
    s = 0.0
    for a in aneis_tm06(geojson):
        x, y = a[:, 0], a[:, 1]
        s += 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    return abs(s) / 1e4


def mascara_concelho(geojson, g):
    """1 = centro da célula dentro do limite do concelho (GeoJSON lon/lat projetado para 3763 com arcpy).
    Ponto-no-polígono par-ímpar, linha a linha: cruzamentos da horizontal do centro com as arestas."""
    aneis = aneis_tm06(geojson)
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
    out = np.floor(v.astype(np.float64))      # truncar: "N %" quer dizer de N a N+1 (14,99 -> 14)
    assert out[~nd].max() < SEM_DADOS
    assert np.array_equal(classes_por_limiares(out, nd, DECLIVE_LIMIARES), classes_por_limiares(v, nd, DECLIVE_LIMIARES)), \
        "o declive truncado mudou de classe"
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

    # --- verificação dos textos, máscara do concelho e rio (antes de qualquer camada) -------
    geo = os.path.join(args.repo, CONCELHO_GEOJSON)
    conc = mascara_concelho(geo, grids["g25"])          # a mesma de sempre: concelho_25m.png não muda
    rio = (nodata[R_EXPOSICAO] & (dados[R_DECLIVE] == 0) & ~nodata[R_DECLIVE] & ~nodata[R_MDT]
           & (dados[R_MDT] <= RIO_MAX_M))
    dentro = conc == 1
    mdt_rio = dados[R_MDT][rio]
    assert rio.any() and 70 <= mdt_rio.min() and mdt_rio.max() <= RIO_MAX_M, "rio: altitudes fora de 70-90 m"
    rio_m = int(np.percentile(dados[R_MDT][rio & dentro], 50, method="lower"))
    assert 70 <= rio_m <= 90, f"rio: mediana {rio_m} m"
    icnf0 = float((dados[R_ICNF_CONJ][rio & dentro] == 0).mean())
    assert icnf0 >= 0.99, f"rio: só {icnf0:.3f} sem número no ICNF 2025"
    textos_dados, ano_fim = verificar_dados(dados, nodata)
    textos = textos_dados | {"rio_m": str(rio_m)}
    print(f"  rio: {int(rio.sum())} células na grelha, {int((rio & dentro).sum())} no concelho, a {rio_m} m", flush=True)

    a11y = os.path.join(PASTA, "a11y")
    val = os.path.join(PASTA, "valores")
    layers = {}
    contaveis = {}      # chave da camada -> array (classes ou valores) para as contagens do concelho

    def camada(chave, grid, fonte, files, encoding, classes=(), sobre=None):
        assert sobre in SOBRE, f"{chave}: falta a entrada de SOBRE"
        about = {k: (v.format(**textos) if isinstance(v, str) else v) for k, v in SOBRE[sobre].items()}
        about["resolucao_m"] = grids[grid]["cell"]
        for ano in re.findall(r"\d{4}", about["ano"] or ""):
            assert ano in fonte, f"{chave}: o ano {ano} do texto não está no nome do raster {fonte}"
        for campo in ("metodo", "nota"):
            for frase in re.split(r"(?<=[.!?])\s+", (about[campo] or "").strip()):
                assert len(frase.split()) <= 15, f"{chave}.{campo}: frase com mais de 15 palavras: {frase}"
        layers[chave] = {
            "grid": grid,
            "source": fonte,
            "files": {k: v for k, v in files.items() if v},
            "encoding": encoding,
            "classes": [{"value": k, "rule": r} for k, r in classes],
            "sha256": {w: esc.sha[w] for w in files.values() if w},
            "about": about,
        }

    def cls_png(nome, cls):
        return esc.gravar(os.path.join(a11y, nome + "_classes.png"), png_bytes(cls), web_de(os.path.join(a11y, nome + "_classes.png")))

    def rgba_png(rel, cls, tabela):
        return esc.gravar(rel, png_bytes(pintar(cls, tabela)), web_de(rel))

    enc_classes = {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados"}}

    # --- a) + b) camadas de classes e imagens --------------------------------
    sobre_risco = {"risco_2025": "risco", "perigosidade_2025": "perigosidade", "icnf_conjuntural": "icnf_conjuntural", "icnf_estrutural": "icnf_estrutural"}
    for chave, raster, grid in (("risco_2025", R_RISCO, "g10_risco"), ("perigosidade_2025", R_PERIGO, "g10_perigosidade"),
                                ("icnf_conjuntural", R_ICNF_CONJ, "g25"), ("icnf_estrutural", R_ICNF_ESTR, "g25")):
        cls = classes_risco(dados[raster], nodata[raster])
        contaveis[chave] = cls
        regras = [(k, f"{raster} = {k} ({PALAVRAS_RISCO[k - 1]})") for k in range(1, 6)]
        enc = dict(enc_classes)
        if chave == "icnf_conjuntural":
            enc["special"] = {"0": "sem dados (valor 0 no raster, fora da área classificada pelo ICNF)"}
        camada(chave, grid, raster, {"classes": cls_png(chave, cls), "display": rgba_png(os.path.join(a11y, chave + ".png"), cls, cores["risco"])}, enc, regras,
               sobre=sobre_risco[chave])

    cls = classes_recorrencia(dados[R_RECORRENCIA], nodata[R_RECORRENCIA])
    contaveis["recorrencia_a11y"] = cls
    regras = [(k, f"{R_RECORRENCIA} = {k}") for k in range(1, RECORRENCIA_MAX)] + [(RECORRENCIA_MAX, f"{R_RECORRENCIA} >= {RECORRENCIA_MAX}")]
    camada("recorrencia_a11y", "g25", R_RECORRENCIA,
           {"classes": cls_png("recorrencia", cls), "display": rgba_png(os.path.join(a11y, "recorrencia.png"), cls, cores["recorrencia"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "nunca ardeu desde 1990 (o raster não tem NoData; inclui o exterior do concelho)"}}, regras,
           sobre="recorrencia")

    cls = classes_por_limiares(dados[R_DECLIVE], nodata[R_DECLIVE], DECLIVE_LIMIARES)
    contaveis["declive_a11y"] = cls
    lim = DECLIVE_LIMIARES
    regras = [(1, f"declive < {lim[0]:g} % ({PALAVRAS_DECLIVE[0]}; transparente)"), (2, f"{lim[0]:g} % <= declive < {lim[1]:g} % ({PALAVRAS_DECLIVE[1]})"),
              (3, f"{lim[1]:g} % <= declive < {lim[2]:g} % ({PALAVRAS_DECLIVE[2]})"), (4, f"declive >= {lim[2]:g} % ({PALAVRAS_DECLIVE[3]})")]
    camada("declive_a11y", "g25", R_DECLIVE,
           {"classes": cls_png("declive", cls), "display": rgba_png(os.path.join(a11y, "declive.png"), cls, cores["declive"])}, dict(enc_classes), regras,
           sobre="declive")

    cls = classes_sol(dados[R_EXPOSICAO], nodata[R_EXPOSICAO])
    contaveis["exposicao_sol"] = cls
    regras = [(1, f"{EXPOSICAO_SOL[0]:g}° <= exposição <= {EXPOSICAO_SOL[1]:g}° (virada ao sol: sueste a oeste)"),
              (2, "restantes exposições (virada à sombra)"), (3, "exposição < 0 (plano; não ocorre neste raster)")]
    camada("exposicao_sol", "g25", R_EXPOSICAO,
           {"classes": cls_png("exposicao_sol", cls), "display": rgba_png(os.path.join(a11y, "exposicao_sol.png"), cls, cores["sol"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados (NoData no raster: exposição indefinida, sobretudo zonas planas)"}}, regras,
           sobre="exposicao")

    cls = classes_por_limiares(dados[R_BIOMASSA], nodata[R_BIOMASSA], BIOMASSA_LIMIARES)
    contaveis["biomassa_2025"] = cls
    lim = BIOMASSA_LIMIARES
    regras = [(1, f"biomassa < {lim[0]:g} t/ha")] + [(k + 2, f"{lim[k]:g} t/ha <= biomassa < {lim[k + 1]:g} t/ha") for k in range(3)] + [(5, f"biomassa >= {lim[3]:g} t/ha")]
    camada("biomassa_2025", "g25", R_BIOMASSA,
           {"classes": cls_png("biomassa", cls), "display": rgba_png(os.path.join(a11y, "biomassa.png"), cls, cores["biomassa"])},
           {"format": "png-l8", "nodata": 0, "special": {"0": "sem dados (NoData no raster: nunca ardeu desde 1990 ou ardeu em 2025)"}}, regras,
           sobre="biomassa")

    # --- c) grelhas de valores exatos ----------------------------------------
    def val_png(nome, arr):
        rel = os.path.join(val, nome + ".png")
        return esc.gravar(rel, png_bytes(arr), web_de(rel))

    rec, rec_nd = dados[R_RECORRENCIA], nodata[R_RECORRENCIA]
    arr = np.where(rec_nd, SEM_DADOS, rec).astype(np.uint8)
    contaveis["recorrencia_valor"] = arr
    camada("recorrencia_valor", "g25", R_RECORRENCIA, {"values": val_png("recorrencia", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "vezes", "special": {"255": "sem dados"},
            "note": "número de vezes que ardeu de 1990 a 2025 (0 = nunca; o raster não tem NoData e cobre também o exterior do concelho)"},
           sobre="recorrencia")

    arr = valores_ultimo_ano(dados[R_ULTIMO_ANO], nodata[R_ULTIMO_ANO], rec)
    contaveis["ultimo_ano"] = arr
    camada("ultimo_ano", "g25", R_ULTIMO_ANO, {"values": val_png("ultimo_ano", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": ULTIMO_ANO_BASE, "unit": "ano",
            "special": {"0": "nunca ardeu desde 1990", "255": "sem dados"}, "note": "ano = valor + 1989 (1990..2025)"},
           sobre="ultimo_ano")

    arr = valores_tempo(dados[R_TEMPO_POS_FOGO], nodata[R_TEMPO_POS_FOGO], rec)
    camada("tempo_pos_fogo", "g25", R_TEMPO_POS_FOGO, {"values": val_png("tempo_pos_fogo", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "anos",
            "special": {str(TEMPO_NUNCA): "nunca ardeu desde 1990 (NoData no raster, as mesmas células que recorrência 0)", "255": "sem dados"},
            "note": "anos desde o último fogo em 2025 (0 = ardeu em 2025; = 2025 - último ano)"},
           sobre="tempo_pos_fogo")

    arr = valores_declive(dados[R_DECLIVE], nodata[R_DECLIVE])
    camada("declive_pct", "g25", R_DECLIVE, {"values": val_png("declive_pct", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": 1, "offset": 0, "unit": "%", "special": {"255": "sem dados"},
            "note": "declive truncado ao inteiro (14,99 -> 14): N quer dizer de N a N+1; a classe de declive_a11y é a dos limiares (15, 30, 50) aplicados a N"},
           sobre="declive")

    arr = valores_exposicao(dados[R_EXPOSICAO], nodata[R_EXPOSICAO])
    camada("exposicao_graus", "g25", R_EXPOSICAO, {"values": val_png("exposicao", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "scale": EXPOSICAO_PASSO, "offset": 0, "unit": "graus",
            "special": {str(EXPOSICAO_PLANO): "plano (exposição < 0; não ocorre)", "255": "sem dados"},
            "note": "graus = valor x 2 (0 = norte, sentido horário; arredondado, erro <= 1°; 360° volta a 0)"},
           sobre="exposicao")

    arr, lut = valores_biomassa(dados[R_BIOMASSA], nodata[R_BIOMASSA])
    camada("biomassa_t_ha", "g25", R_BIOMASSA, {"values": val_png("biomassa", arr)},
           {"format": "png-l8", "nodata": SEM_DADOS, "lut": lut, "unit": "t/ha", "special": {"255": "sem dados (nunca ardeu desde 1990 ou ardeu em 2025)"},
            "note": "t/ha = lut[valor] (valores exatos do raster, float32 na representação mais curta)"},
           sobre="biomassa")

    mdt = np.where(nodata[R_MDT], MDT_SEM_DADOS, dados[R_MDT]).astype("<i2")
    rel = os.path.join(val, "mdt.bin")
    camada("mdt", "g25", R_MDT, {"values": esc.gravar(rel, mdt.tobytes(), web_de(rel))},
           {"format": "int16le", "nodata": MDT_SEM_DADOS, "scale": 1, "offset": 0, "unit": "m",
            "note": "Int16 little-endian, width x height valores, linha a linha de norte para sul, de oeste para este"},
           sobre="mdt")

    camada("concelho_25m", "g25", CONCELHO_GEOJSON.replace(os.sep, "/"), {"values": val_png("concelho_25m", conc)},
           {"format": "png-l8", "special": {"0": "fora do concelho", "1": "centro da célula dentro do concelho"},
            "note": "limite do concelho (GeoJSON lon/lat) projetado para EPSG:3763 com arcpy, sem transformação de datum"},
           sobre="concelho")

    camada("rio_douro_25m", "g25", R_MDT, {"values": val_png("rio_douro_25m", rio.astype(np.uint8))},
           {"format": "png-l8", "special": {"0": "não é rio", "1": "superfície do rio Douro no MDT"},
            "note": f"células planas (declive 0, exposição sem dados) a {RIO_MAX_M} m ou menos: a albufeira do Douro no MDT (78-81 m); junto às margens pode falhar"},
           sobre="rio")

    # --- e) números do concelho (contagens exatas sobre os arrays nativos) ------------------
    mascaras = {"g25": dentro,
                "g10_risco": mascara_concelho(geo, grids["g10_risco"]) == 1,
                "g10_perigosidade": mascara_concelho(geo, grids["g10_perigosidade"]) == 1}

    def ha(n, gid="g25"):
        return float(n) * grids[gid]["cell"] ** 2 / 10000     # exato na g25 (múltiplos de 0,0625)

    def pct(n, total):
        return round(100.0 * n / total, 4)

    contagens = {}
    for chave, arr in contaveis.items():
        gid = layers[chave]["grid"]
        m = mascaras[gid]
        v = arr[m]
        assert v.max() < SEM_DADOS, f"{chave}: 'sem dados' dentro do concelho"
        lista = [int(n) for n in np.bincount(v.astype(np.int64))]          # denso: índice = valor do PNG
        assert sum(lista) == int(m.sum())
        contagens[chave] = {"grid": gid, "total": int(m.sum()), "contagem": lista}

    rv = contagens["recorrencia_valor"]["contagem"]
    ua = contagens["ultimo_ano"]["contagem"]
    tot = int(dentro.sum())
    assert rv[0] == contagens["recorrencia_a11y"]["contagem"][0] == ua[0], "nunca ardeu: recorrência e último ano não batem"
    assert contagens["recorrencia_a11y"]["contagem"][RECORRENCIA_MAX] == sum(rv[RECORRENCIA_MAX:]), "recorrência: classe 5 != soma de 5 ou mais"
    i_fim = ano_fim - ULTIMO_ANO_BASE           # índice do último ano dos dados (pode não ter fogo no concelho)
    assert len(ua) - 1 <= i_fim, "último ano: o concelho tem um ano depois do fim dos dados"
    ardeu_fim = ua[i_fim] if i_fim < len(ua) else 0
    assert contagens["biomassa_2025"]["contagem"][0] == rv[0] + ardeu_fim, "mato sem dados != nunca ardeu + ardeu no último ano"
    assert contagens["exposicao_sol"]["contagem"][0] == int(((dados[R_DECLIVE] == 0) & ~nodata[R_DECLIVE] & dentro).sum()), \
        "exposição sem dados no concelho != células planas"
    area_ha = ha(tot)
    area_pol = area_poligono_ha(geo)
    assert abs(area_ha - area_pol) / area_pol < AREA_TOLERANCIA, f"área: {area_ha} ha (células) contra {area_pol:.2f} ha (polígono)"
    print(f"  concelho: {tot} células = {area_ha} ha (polígono: {area_pol:.2f} ha)", flush=True)

    mdt_dentro = dados[R_MDT][dentro & ~nodata[R_MDT]]
    i_min = np.flatnonzero((dentro & ~nodata[R_MDT]).ravel())[int(np.argmin(mdt_dentro))]
    assert not rio.ravel()[i_min], "a altitude mínima do concelho é rio: rever a nota altitude_m"
    ardeu = tot - rv[0]
    maxv = max(i for i, n in enumerate(rv) if n)
    fim = len(ua) - 1                           # último ano com fogo dentro do concelho
    assert fim >= 1, "o concelho não tem nenhum fogo: rever ultimo_fogo_ano"
    cj = contagens["icnf_conjuntural"]
    r10 = contagens["risco_2025"]
    concelho = {
        "area_ha": area_ha,
        "celulas": {gid: int(m.sum()) for gid, m in mascaras.items()},
        "contagens": contagens,
        "limite": CONCELHO_LIMITE,
        "notas": CONCELHO_NOTAS,
        "resumo": {
            "altitude_m": {"max": int(mdt_dentro.max()), "min": int(mdt_dentro.min()), "rio": rio_m},
            "ardeu_ha": ha(ardeu),
            "ardeu_pct": pct(ardeu, tot),
            "ardeu_5_ou_mais_ha": ha(sum(rv[5:])),
            "ha_por_ultimo_ano": {str(ULTIMO_ANO_BASE + i): ha(n) for i, n in enumerate(ua) if i >= 1 and n > 0},
            "icnf_sem_numero_ha": ha(cj["contagem"][0]),
            "icnf_sem_numero_pct": pct(cj["contagem"][0], tot),
            "mato_sem_estimativa_pct": pct(contagens["biomassa_2025"]["contagem"][0], tot),
            "max_vezes": maxv,
            "max_vezes_ha": ha(rv[maxv]),
            "periodo": [ULTIMO_ANO_BASE + 1, ano_fim],
            "rio_ha": ha(int((rio & dentro).sum())),
            "risco_alto_pct": pct(sum(r10["contagem"][4:6]), r10["total"]),
            "ultimo_fogo_ano": ULTIMO_ANO_BASE + fim,
        },
    }

    # --- d) manifest e README -------------------------------------------------
    casa = os.path.expanduser("~")
    gdb_txt = args.gdb
    if gdb_txt.lower().startswith(casa.lower()):
        gdb_txt = "~" + gdb_txt[len(casa):]
    manifest = {
        "version": 2,
        "generated": max(f["modified"] for f in fontes.values()),
        "script": "scripts/pro_to_web.py",
        "palette": args.paleta,
        "source": {"gdb": gdb_txt.replace("\\", "/"), "rasters": fontes},
        "crs": {"wkid": WKID, "name": "ETRS89 / Portugal TM06"},
        "grids": grids,
        "layers": layers,
        "concelho": concelho,
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
