// Lê o valor de uma grelha de classes (PNG em tons de cinzento, valor = classe)
// num ponto do mapa. Cada PNG tem uma célula por píxel da grelha nativa em PT-TM06 (EPSG:3763):
// lon/lat → PT-TM06 → célula, exato (ver src/geo/grid.ts).
import { cellHa, cellOf, forEachCellInCircle, pixelOf, type GridGeo } from "../geo/grid";

/** Valor devolvido quando o ponto está fora da grelha ou a grelha não carregou. */
export const NO_DATA = -1;

/** Máscaras de polígonos já desenhadas, por grelha e pela chave da seleção (concelho, freguesias). */
const masks = new Map<string, Map<string, Uint8Array>>();
/** só as últimas seleções ficam guardadas em cada grelha (as grelhas de 10 m têm 5 milhões de células) */
const MASKS_PER_GRID = 6;

/**
 * Máscara (1 = centro da célula dentro) de um ou mais polígonos (anéis GeoJSON em lon/lat) na grelha
 * `geo`, desenhada uma vez por grelha e partilhada por todas as camadas dessa grelha: as camadas de
 * 25 m desenham uma só máscara por seleção. `key` identifica a seleção. null se não houver canvas.
 */
export function maskOf(geo: GridGeo, key: string, polygons: number[][][][]): Uint8Array | null {
  let byKey = masks.get(geo.id);
  if (!byKey) masks.set(geo.id, (byKey = new Map()));
  let mask = byKey.get(key);
  if (mask) return mask;
  const canvas = document.createElement("canvas");
  canvas.width = geo.width;
  canvas.height = geo.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  // cada polígono à parte (par-ímpar só entre os seus anéis, para os buracos) e depois a união de todos:
  // duas freguesias que se sobrepõem não se anulam, e o bordo comum de duas vizinhas fica preenchido
  for (const rings of polygons) {
    ctx.beginPath();
    for (const ring of rings) {
      // cada vértice vai para PT-TM06 e daí para o píxel da grelha (projeção por vértice, não por célula)
      ring.forEach(([lon, lat], i) => {
        const p = pixelOf(geo, lon, lat);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  const px = ctx.getImageData(0, 0, geo.width, geo.height).data;
  mask = new Uint8Array(geo.width * geo.height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  byKey.set(key, mask);
  if (byKey.size > MASKS_PER_GRID) byKey.delete(byKey.keys().next().value!);
  return mask;
}

export class ClassGrid {
  /** um byte por célula (o canal R do PNG), linha a linha de norte para sul */
  private data: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private loading: Promise<void> | null = null;

  /** `geo`: a grelha do manifest em que o PNG foi gerado (mesmas dimensões). */
  constructor(private url: string, readonly geo: GridGeo) {}

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const { width: gw, height: gh, id } = this.geo;
          // uma imagem com outras dimensões já não corresponde à grelha: melhor não ler do que ler mal
          if (img.naturalWidth !== gw || img.naturalHeight !== gh) {
            return reject(new Error(`${this.url}: ${img.naturalWidth}×${img.naturalHeight}, a grelha ${id} tem ${gw}×${gh}`));
          }
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return reject(new Error("Canvas indisponível"));
          ctx.drawImage(img, 0, 0);
          const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          // guarda só o canal R (PNG em tons de cinzento): 1 byte por célula em vez de 4
          const data = new Uint8Array(canvas.width * canvas.height);
          for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
          this.data = data;
          this.width = canvas.width;
          this.height = canvas.height;
          resolve();
        };
        img.onerror = () => reject(new Error(`Não foi possível ler ${this.url}`));
        img.src = this.url;
      }).catch((err) => {
        this.loading = null; // permite tentar outra vez (ex.: rede instável)
        throw err;
      });
    }
    return this.loading;
  }

  /** A grelha inteira (uma cópia, um byte por célula, linha a linha de norte para sul), para desenhar ou simular. */
  async raw(): Promise<{ cls: Uint8Array; width: number; height: number; grid: GridGeo }> {
    await this.load();
    return { cls: this.data!.slice(), width: this.width, height: this.height, grid: this.geo };
  }

  /** Os bytes da grelha, só para ler (por exemplo, a máscara 0/1 do concelho); null se não carregou. */
  async bytes(): Promise<Uint8Array | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    return this.data;
  }

  /**
   * Quantas células de cada classe há dentro de um círculo (raio em metros, medidos em PT-TM06).
   * Conta as células cujo centro está no círculo e, com `inside`, só as que têm inside[i] != 0
   * (por exemplo, as do concelho). `counts[c]` = células da classe c; `total` = células contadas.
   */
  async histogram(lon: number, lat: number, radiusM: number, inside?: Uint8Array | null): Promise<{ counts: number[]; total: number } | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    const data = this.data;
    if (!data) return null;
    const counts = new Array<number>(256).fill(0);
    let total = 0;
    forEachCellInCircle(this.geo, lon, lat, radiusM, (i) => {
      if (inside && !inside[i]) return;
      counts[data[i]]++;
      total++;
    });
    return { counts, total };
  }

  /**
   * Quantas células de cada classe há dentro de um ou mais polígonos (anéis GeoJSON em lon/lat) e, com
   * `inside`, só as que têm inside[i] != 0. `key` identifica a seleção, para reaproveitar a máscara já
   * desenhada nesta grelha (maskOf).
   */
  async histogramPolygons(key: string, polygons: number[][][][], inside?: Uint8Array | null): Promise<{ counts: number[]; total: number } | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    const data = this.data;
    if (!data) return null;
    const mask = maskOf(this.geo, key, polygons);
    if (!mask) return null;
    const counts = new Array<number>(256).fill(0);
    let total = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || (inside && !inside[i])) continue;
      counts[data[i]]++;
      total++;
    }
    return { counts, total };
  }

  /** Área de uma célula em hectares (lado² em PT-TM06; ver cellArea em src/geo/grid.ts). */
  cellHa(): number {
    return cellHa(this.geo);
  }

  /**
   * Classe no ponto, ou NO_DATA (-1) fora da grelha ou se a grelha não carregou.
   * `radius` em células: devolve o máximo à volta (tolerância ao toque).
   */
  async sample(lon: number, lat: number, radius = 0): Promise<number> {
    try {
      await this.load();
    } catch {
      return NO_DATA;
    }
    if (!this.data) return NO_DATA;
    const cell = cellOf(this.geo, lon, lat);
    if (!cell) return NO_DATA;
    const { col, row } = cell;
    let best = 0;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= this.height || c >= this.width) continue;
        best = Math.max(best, this.data[r * this.width + c]);
      }
    }
    return best;
  }
}
