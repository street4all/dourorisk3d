// Grelhas DouroRisk no seu sistema nativo, PT-TM06/ETRS89 (EPSG:3763).
//
// Cada PNG das grelhas tem uma célula por píxel, linha a linha de norte para sul. Uma grelha é
// descrita por (x0, y0) = canto superior esquerdo EXTERIOR da primeira célula (xmin, ymax, em metros
// PT-TM06) e o lado da célula. Em WGS84 a grelha não é um retângulo (está rodada ~0,43° pela
// convergência dos meridianos e não é linear em lon/lat): por isso as contas fazem-se sempre em
// PT-TM06 (lon/lat → toTM06 → célula, exato) e o desenho no mapa usa os cantos reais
// (CornersGeoreference), em blocos (gridTiles), em vez de uma extensão lon/lat retangular.
//
// A descrição das grelhas vem do manifest src/data/dourorisk-grids.json, gerado por
// scripts/pro_to_web.py a partir dos rasters do ArcGIS Pro.
import CornersGeoreference from "@arcgis/core/layers/support/CornersGeoreference.js";
import Point from "@arcgis/core/geometry/Point.js";
// só as chaves que a app usa: o resto do manifest (origem na gdb, datas, cantos de verificação)
// fica fora do bundle público
import { grids as manifestGrids, layers as manifestLayers, version as manifestVersion } from "../data/dourorisk-grids.json";
import { fromTM06, toTM06 } from "./pttm06";

/** Uma grelha regular em PT-TM06 (EPSG:3763). */
export interface GridGeo {
  /** chave no manifest (ex.: "g25", "g10_risco", "g10_perigosidade") */
  readonly id: string;
  /** colunas (= largura do PNG) */
  readonly width: number;
  /** linhas (= altura do PNG) */
  readonly height: number;
  /** xmin da grelha: bordo oeste da primeira coluna (m, PT-TM06) */
  readonly x0: number;
  /** ymax da grelha: bordo norte da primeira linha (m, PT-TM06) */
  readonly y0: number;
  /** lado da célula (m) */
  readonly cell: number;
}

/** Grelhas descritas no manifest. */
export type GridId = "g10_risco" | "g10_perigosidade" | "g25";

// ---------------------------------------------------------------------------------------------
// Manifest (formato do contrato de scripts/pro_to_web.py). Só se tipam com rigor as partes que a
// app usa; o resto fica aberto, para o manifest poder crescer sem partir a compilação.

export interface ManifestGrid {
  width: number;
  height: number;
  x0: number;
  y0: number;
  cell: number;
}

/** «Como sabemos?»: proveniência da camada em Leitura Fácil (layers.<chave>.about, escrito pelo pipeline). */
export interface LayerAbout {
  titulo: string; fonte: string; fonte_curta: string;
  /** "2025", "2020–2030", "1990–2025" ou null (terreno, limite) */
  ano: string | null; metodo: string; nota: string | null; resolucao_m: number;
}

/** Como ler os bytes de uma camada: valor = lut[byte] ou byte × scale + offset; nodata e special = sem valor. */
export interface LayerEncoding {
  format: string; nodata?: number; scale?: number; offset?: number; unit?: string;
  lut?: readonly number[]; special?: Readonly<Record<string, string>>; note?: string;
}

export interface ManifestLayer {
  /** id da grelha (GridId) */
  grid: string;
  /** nome do raster de origem na geodatabase */
  source?: string;
  /** caminhos públicos ("/data/…") dos ficheiros desta camada */
  files: { classes?: string; display?: string; values?: string };
  encoding?: LayerEncoding;
  classes?: readonly object[];
  sha256?: Readonly<Record<string, string>>;
  about?: LayerAbout;
}

export interface GridManifest {
  version: number;
  generated?: string;
  script?: string;
  source?: object;
  crs?: { wkid: number; name?: string };
  grids: Readonly<Record<string, ManifestGrid>>;
  layers: Readonly<Record<string, ManifestLayer>>;
  /** cantos calculados pelo arcpy (só para verificação) */
  cornersWgs84?: Readonly<Record<string, { tl: readonly number[]; tr: readonly number[]; br: readonly number[]; bl: readonly number[] }>>;
}

/**
 * O manifest das grelhas (src/data/dourorisk-grids.json), só com as partes que a app usa
 * (version, grids, layers). Os campos opcionais (generated, source, cornersWgs84, …) ficam de fora
 * de propósito, para não irem no bundle público: quem precisar deles lê o JSON diretamente.
 */
export const GRID_MANIFEST: GridManifest = { version: manifestVersion, grids: manifestGrids, layers: manifestLayers };

/** Cria uma grelha (validada e imutável). Para grelhas fora do manifest (ex.: ensaios). */
export function makeGrid(id: string, width: number, height: number, x0: number, y0: number, cell: number): GridGeo {
  const ok =
    Number.isInteger(width) && width > 0 &&
    Number.isInteger(height) && height > 0 &&
    Number.isFinite(x0) && Number.isFinite(y0) &&
    Number.isFinite(cell) && cell > 0;
  if (!ok) throw new Error(`Grelha "${id}" inválida: ${JSON.stringify({ width, height, x0, y0, cell })}`);
  return Object.freeze({ id, width, height, x0, y0, cell });
}

const cache = new Map<string, GridGeo>();

/** A grelha `id` do manifest (sempre o mesmo objeto para o mesmo id). Lança erro se não existir. */
export function gridFromManifest(id: GridId | (string & {})): GridGeo {
  let g = cache.get(id);
  if (!g) {
    const m = GRID_MANIFEST.grids[id];
    if (!m) throw new Error(`Grelha "${id}" não existe em dourorisk-grids.json`);
    g = makeGrid(id, m.width, m.height, m.x0, m.y0, m.cell);
    cache.set(id, g);
  }
  return g;
}

/** A grelha de uma camada do manifest (ex.: "risco_2025" → g10_risco). Lança erro se não existir. */
export function gridOfLayer(layerKey: string): GridGeo {
  const layer = GRID_MANIFEST.layers[layerKey];
  if (!layer) throw new Error(`Camada "${layerKey}" não existe em dourorisk-grids.json`);
  return gridFromManifest(layer.grid);
}

// ---------------------------------------------------------------------------------------------
// Contas em PT-TM06 (metros). Coordenadas de píxel: (0, 0) é o canto superior esquerdo exterior
// da grelha, x cresce para este e y para sul; o centro da célula (col, row) é (col + 0,5, row + 0,5).

/** Extensão da grelha em PT-TM06 (bordos exteriores das células). */
export function extentTM06(g: GridGeo): { xmin: number; ymin: number; xmax: number; ymax: number } {
  return { xmin: g.x0, ymin: g.y0 - g.height * g.cell, xmax: g.x0 + g.width * g.cell, ymax: g.y0 };
}

/** Ponto PT-TM06 → coordenadas de píxel reais (fracionárias, podem cair fora da grelha). */
export function pixelOfXY(g: GridGeo, x: number, y: number): { x: number; y: number } {
  return { x: (x - g.x0) / g.cell, y: (g.y0 - y) / g.cell };
}

/** Coordenadas de píxel → ponto PT-TM06 [x, y]. */
export function xyOfPixel(g: GridGeo, px: number, py: number): [number, number] {
  return [g.x0 + px * g.cell, g.y0 - py * g.cell];
}

/** Centro da célula (col, row) em PT-TM06 [x, y]. */
export function cellCenterXY(g: GridGeo, col: number, row: number): [number, number] {
  return xyOfPixel(g, col + 0.5, row + 0.5);
}

/** Célula que contém o ponto PT-TM06, ou null fora da grelha. */
export function cellOfXY(g: GridGeo, x: number, y: number): { col: number; row: number } | null {
  const px = (x - g.x0) / g.cell, py = (g.y0 - y) / g.cell;
  if (!(px >= 0 && px < g.width && py >= 0 && py < g.height)) return null; // também apanha NaN
  return { col: Math.floor(px), row: Math.floor(py) };
}

/** Índice (row·width + col) da célula que contém o ponto PT-TM06, ou -1 fora da grelha. */
export function indexOfXY(g: GridGeo, x: number, y: number): number {
  const px = (x - g.x0) / g.cell, py = (g.y0 - y) / g.cell;
  if (!(px >= 0 && px < g.width && py >= 0 && py < g.height)) return -1;
  return Math.floor(py) * g.width + Math.floor(px);
}

// ---------------------------------------------------------------------------------------------
// As mesmas contas a partir de lon/lat (WGS84 ≡ ETRS89), exatas: lon/lat → PT-TM06 → célula.

/** lon/lat → coordenadas de píxel reais na grelha (para desenhar polígonos num canvas da grelha). */
export function pixelOf(g: GridGeo, lon: number, lat: number): { x: number; y: number } {
  const [x, y] = toTM06(lon, lat);
  return pixelOfXY(g, x, y);
}

/** Coordenadas de píxel → [lon, lat]. O centro da célula (col, row) é lonLatOfPixel(g, col + 0.5, row + 0.5). */
export function lonLatOfPixel(g: GridGeo, px: number, py: number): [number, number] {
  const [x, y] = xyOfPixel(g, px, py);
  return fromTM06(x, y);
}

/** Célula que contém o ponto lon/lat, ou null fora da grelha. */
export function cellOf(g: GridGeo, lon: number, lat: number): { col: number; row: number } | null {
  const [x, y] = toTM06(lon, lat);
  return cellOfXY(g, x, y);
}

/** Índice (row·width + col) da célula que contém o ponto lon/lat, ou -1 fora da grelha. */
export function indexOf(g: GridGeo, lon: number, lat: number): number {
  const [x, y] = toTM06(lon, lat);
  return indexOfXY(g, x, y);
}

/** Os 4 cantos exteriores da grelha em WGS84, [lon, lat] (tl = noroeste, tr, br, bl). */
export function corners(g: GridGeo): { tl: [number, number]; tr: [number, number]; br: [number, number]; bl: [number, number] } {
  return {
    tl: lonLatOfPixel(g, 0, 0),
    tr: lonLatOfPixel(g, g.width, 0),
    br: lonLatOfPixel(g, g.width, g.height),
    bl: lonLatOfPixel(g, 0, g.height),
  };
}

/**
 * Georreferência do retângulo de píxeis [px0, px1] × [py0, py1] da grelha (coordenadas de píxel
 * reais, como em pixelOf) para um ImageElement da MediaLayer: os 4 cantos reais em WGS84 (exatos).
 *
 * Entre os cantos o SDK (MediaLayerView3D, @arcgis/core 5.1) desenha UM quadrilátero com uma
 * transformação perspetiva na referência espacial da vista (Web Mercator, 102100). A grelha PT-TM06
 * não é um quadrilátero perspetivo em Web Mercator (o Mercator não é linear em latitude), por isso no
 * interior sobra um desvio de desenho, quase todo norte–sul, que cresce com o quadrado do tamanho:
 * com a grelha inteira num só quadrilátero é até ~19 m na g25 e ~18 m nas g10 (média ~12 m, máximo
 * no centro da imagem); em blocos de 1/n da grelha cai ~n² vezes (ver gridTiles). Era até 277 m com a
 * extensão lon/lat retangular. A leitura de valores não depende disto: cellOf/indexOf são exatos.
 */
export function cornersGeoreferenceOfPixels(g: GridGeo, px0: number, py0: number, px1: number, py1: number): CornersGeoreference {
  const pt = (px: number, py: number) => {
    const [lon, lat] = lonLatOfPixel(g, px, py);
    return new Point({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
  };
  return new CornersGeoreference({ topLeft: pt(px0, py0), topRight: pt(px1, py0), bottomRight: pt(px1, py1), bottomLeft: pt(px0, py1) });
}

/**
 * Georreferência da grelha inteira num só quadrilátero (os 4 cantos exteriores). Para desenhar uma
 * imagem da grelha usa-se gridTiles (ou gridImageElements, em ./gridMedia), que a parte em blocos:
 * num só quadrilátero o desvio de desenho chega a ~19 m (ver cornersGeoreferenceOfPixels).
 */
export function cornersGeoreference(g: GridGeo): CornersGeoreference {
  return cornersGeoreferenceOfPixels(g, 0, 0, g.width, g.height);
}

/**
 * Blocos por lado com que se desenha uma imagem de grelha (n × n ImageElements, cada um com os seus
 * 4 cantos reais). Desvio máximo de desenho (modelo da transformação perspetiva do SDK em Web Mercator,
 * malha de 25×25 pontos por bloco): 1 bloco ~19 m (g25) / ~18 m (g10); 2×2 ~4,8 / 4,5 m;
 * 3×3 ~2,1 / 2,0 m; 4×4 ~1,2 / 1,1 m (média ~0,7 m); 8×8 ~0,3 m. Com 4×4 o desvio fica abaixo de
 * 1/8 de uma célula de 10 m e cada bloco fica com menos de 2048 píxeis de lado (o máximo seguro de
 * textura que o SDK recomenda; as imagens de 10 m têm 2483 linhas).
 */
export const MEDIA_TILES = 4;

/** Um bloco de uma imagem de grelha: retângulo de píxeis DA IMAGEM (colunas [x0, x1[, linhas [y0, y1[) e a sua georreferência. */
export interface GridTile {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly georeference: CornersGeoreference;
}

/**
 * Parte uma imagem que cobre a grelha inteira (com as dimensões da grelha, ou proporcional: a faísca
 * usa células de 50 m) em n × n blocos, linha a linha de norte para sul. Os bordos dos blocos caem em
 * píxeis inteiros da imagem e blocos vizinhos partilham exatamente os mesmos cantos (calculados da
 * mesma maneira), por isso não ficam folgas nem sobreposições entre eles.
 */
export function gridTiles(g: GridGeo, imageWidth = g.width, imageHeight = g.height, n = MEDIA_TILES): GridTile[] {
  const sx = g.width / imageWidth, sy = g.height / imageHeight;
  const cuts = (size: number) => {
    const k = Math.max(1, Math.min(Math.floor(n), size));
    return Array.from({ length: k + 1 }, (_, i) => Math.round((i * size) / k));
  };
  const xs = cuts(imageWidth), ys = cuts(imageHeight);
  const tiles: GridTile[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      tiles.push({ x0, y0, x1, y1, georeference: cornersGeoreferenceOfPixels(g, x0 * sx, y0 * sy, x1 * sx, y1 * sy) });
    }
  }
  return tiles;
}

/**
 * Área de uma célula em m² = cell². É a área no plano PT-TM06; no terreno (elipsoide) é cell²/k²,
 * com k o fator de escala local da projeção. Na área das grelhas (x de 43 a 66 km a este do meridiano
 * central) k vai de 1,000023 a 1,000053, ou seja a diferença é ≤ 0,011 % da área (≤ 0,07 m² numa
 * célula de 25 m): desprezável.
 */
export function cellArea(g: GridGeo): number {
  return g.cell * g.cell;
}

/** Área de uma célula em hectares. */
export function cellHa(g: GridGeo): number {
  return cellArea(g) / 10000;
}

/**
 * Chama fn(índice, col, row) para cada célula cujo centro está a ≤ radiusM metros do ponto PT-TM06
 * (x, y), linha a linha de norte para sul. Devolve o número de células visitadas (só as que existem
 * na grelha). As distâncias são no plano PT-TM06 (erro de escala ≤ 0,006 % na área das grelhas, 6 cm em 1 km).
 */
export function forEachCellInCircleXY(
  g: GridGeo,
  x: number,
  y: number,
  radiusM: number,
  fn: (index: number, col: number, row: number) => void,
): number {
  if (!(radiusM >= 0)) return 0;
  const { x0, y0, cell, width, height } = g;
  const c0 = Math.max(0, Math.floor((x - radiusM - x0) / cell));
  const c1 = Math.min(width - 1, Math.floor((x + radiusM - x0) / cell));
  const r0 = Math.max(0, Math.floor((y0 - (y + radiusM)) / cell));
  const r1 = Math.min(height - 1, Math.floor((y0 - (y - radiusM)) / cell));
  const r2 = radiusM * radiusM;
  let count = 0;
  for (let row = r0; row <= r1; row++) {
    const dy = y0 - (row + 0.5) * cell - y;
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    for (let col = c0; col <= c1; col++) {
      const dx = x0 + (col + 0.5) * cell - x;
      if (dx * dx + dy2 > r2) continue;
      fn(row * width + col, col, row);
      count++;
    }
  }
  return count;
}

/** forEachCellInCircleXY com o centro em lon/lat (raio em metros reais, medidos em PT-TM06). */
export function forEachCellInCircle(
  g: GridGeo,
  lon: number,
  lat: number,
  radiusM: number,
  fn: (index: number, col: number, row: number) => void,
): number {
  const [x, y] = toTM06(lon, lat);
  return forEachCellInCircleXY(g, x, y, radiusM, fn);
}

/**
 * Quantas células da grelha `g`, prolongada para lá dos bordos, têm o centro a ≤ radiusM metros de
 * (lon, lat): o círculo inteiro, também a parte que sai da grelha. É o denominador certo para dizer que
 * parte de um círculo fica dentro de uma máscara da grelha (forEachCellInCircle só conta as que existem).
 */
export function cellsInCircle(g: GridGeo, lon: number, lat: number, radiusM: number): number {
  if (!(radiusM >= 0)) return 0;
  const [x, y] = toTM06(lon, lat);
  const { x0, y0, cell } = g;
  const r2 = radiusM * radiusM;
  const c0 = Math.floor((x - radiusM - x0) / cell), c1 = Math.floor((x + radiusM - x0) / cell);
  const r0 = Math.floor((y0 - (y + radiusM)) / cell), r1 = Math.floor((y0 - (y - radiusM)) / cell);
  let n = 0;
  for (let row = r0; row <= r1; row++) {
    const dy = y0 - (row + 0.5) * cell - y;
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    for (let col = c0; col <= c1; col++) {
      const dx = x0 + (col + 0.5) * cell - x;
      if (dx * dx + dy2 <= r2) n++; // a mesma conta de forEachCellInCircleXY
    }
  }
  return n;
}
