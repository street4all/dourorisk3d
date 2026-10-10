// Lê o valor de uma grelha de classes (PNG em tons de cinzento, valor = classe)
// num ponto do mapa. Cada PNG tem uma célula por píxel da grelha nativa em PT-TM06 (EPSG:3763):
// lon/lat → PT-TM06 → célula, exato (ver src/geo/grid.ts).
import { cellHa, cellOf, forEachCellInCircle, pixelOf, type GridGeo } from "../geo/grid";

/** Valor devolvido quando o ponto está fora da grelha ou a grelha não carregou. */
export const NO_DATA = -1;

export class ClassGrid {
  private data: Uint8ClampedArray | null = null;
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
          this.data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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

  /** A grelha inteira (um byte por célula, linha a linha de norte para sul), para desenhar ou simular. */
  async raw(): Promise<{ cls: Uint8Array; width: number; height: number; grid: GridGeo }> {
    await this.load();
    const cls = new Uint8Array(this.width * this.height);
    for (let i = 0; i < cls.length; i++) cls[i] = this.data![i * 4];
    return { cls, width: this.width, height: this.height, grid: this.geo };
  }

  /**
   * Quantas células de cada classe há dentro de um círculo (raio em metros, medidos em PT-TM06).
   * Conta as células cujo centro está no círculo.
   * `counts[c]` = células da classe c; `total` = células do círculo dentro da grelha.
   */
  async histogram(lon: number, lat: number, radiusM: number): Promise<{ counts: number[]; total: number } | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    const data = this.data;
    if (!data) return null;
    const counts = new Array<number>(256).fill(0);
    const total = forEachCellInCircle(this.geo, lon, lat, radiusM, (i) => {
      counts[data[i * 4]]++;
    });
    return { counts, total };
  }

  /** máscaras de polígonos já desenhadas nesta grelha (concelho, freguesias), pela chave da seleção */
  private masks = new Map<string, Uint8Array>();

  /**
   * Quantas células de cada classe há dentro de um ou mais polígonos (anéis GeoJSON em lon/lat).
   * `key` identifica a seleção, para reaproveitar a máscara já desenhada.
   */
  async histogramPolygons(key: string, polygons: number[][][][]): Promise<{ counts: number[]; total: number } | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    if (!this.data) return null;
    let mask = this.masks.get(key);
    if (!mask) {
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.beginPath();
      for (const rings of polygons) {
        for (const ring of rings) {
          // cada vértice vai para PT-TM06 e daí para o píxel da grelha (projeção por vértice, não por célula)
          ring.forEach(([lon, lat], i) => {
            const p = pixelOf(this.geo, lon, lat);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
        }
      }
      ctx.fillStyle = "#000";
      ctx.fill("evenodd");
      const px = ctx.getImageData(0, 0, this.width, this.height).data;
      mask = new Uint8Array(this.width * this.height);
      for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
      this.masks.set(key, mask);
      // só as últimas seleções ficam guardadas (as grelhas de 10 m têm 5 milhões de células)
      if (this.masks.size > 6) this.masks.delete(this.masks.keys().next().value!);
    }
    const counts = new Array<number>(256).fill(0);
    let total = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      counts[this.data[i * 4]]++;
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
        best = Math.max(best, this.data[(r * this.width + c) * 4]);
      }
    }
    return best;
  }
}
