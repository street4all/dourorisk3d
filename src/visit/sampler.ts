// Lê o valor de uma grelha de classes (PNG em tons de cinzento, valor = classe)
// num ponto do mapa. As imagens DouroRisk são os rasters originais célula a célula,
// esticados para a extensão WGS84 — por isso a conversão é linear, igual à do MediaLayer.

export interface Extent4326 {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** Valor devolvido quando o ponto está fora da grelha ou a grelha não carregou. */
export const NO_DATA = -1;

export class ClassGrid {
  private data: Uint8ClampedArray | null = null;
  private width = 0;
  private height = 0;
  private loading: Promise<void> | null = null;

  constructor(private url: string, private extent: Extent4326) {}

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
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
  async raw(): Promise<{ cls: Uint8Array; width: number; height: number; extent: Extent4326 }> {
    await this.load();
    const cls = new Uint8Array(this.width * this.height);
    for (let i = 0; i < cls.length; i++) cls[i] = this.data![i * 4];
    return { cls, width: this.width, height: this.height, extent: this.extent };
  }

  /**
   * Quantas células de cada classe há dentro de um círculo (raio em metros).
   * `counts[c]` = células da classe c; `total` = células do círculo dentro da grelha.
   */
  async histogram(lon: number, lat: number, radiusM: number): Promise<{ counts: number[]; total: number } | null> {
    try {
      await this.load();
    } catch {
      return null;
    }
    if (!this.data) return null;
    const { xmin, ymin, xmax, ymax } = this.extent;
    const dLat = radiusM / 111320;
    const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
    const colOf = (x: number) => ((x - xmin) / (xmax - xmin)) * this.width;
    const rowOf = (y: number) => ((ymax - y) / (ymax - ymin)) * this.height;
    const c0 = Math.max(0, Math.floor(colOf(lon - dLon))), c1 = Math.min(this.width - 1, Math.ceil(colOf(lon + dLon)));
    const r0 = Math.max(0, Math.floor(rowOf(lat + dLat))), r1 = Math.min(this.height - 1, Math.ceil(rowOf(lat - dLat)));
    const counts = new Array<number>(256).fill(0);
    let total = 0;
    const cw = (xmax - xmin) / this.width, ch = (ymax - ymin) / this.height;
    for (let r = r0; r <= r1; r++) {
      const y = (ymax - (r + 0.5) * ch - lat) / dLat;
      for (let c = c0; c <= c1; c++) {
        const x = (xmin + (c + 0.5) * cw - lon) / dLon;
        if (x * x + y * y > 1) continue;
        counts[this.data[(r * this.width + c) * 4]]++;
        total++;
      }
    }
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
      const { xmin, ymin, xmax, ymax } = this.extent;
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.beginPath();
      for (const rings of polygons) {
        for (const ring of rings) {
          ring.forEach(([lon, lat], i) => {
            const x = ((lon - xmin) / (xmax - xmin)) * this.width;
            const y = ((ymax - lat) / (ymax - ymin)) * this.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
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

  /** Área de uma célula em hectares, à latitude dada. */
  cellHa(lat: number): number {
    const { xmin, ymin, xmax, ymax } = this.extent;
    const w = ((xmax - xmin) / this.width) * 111320 * Math.cos((lat * Math.PI) / 180);
    const h = ((ymax - ymin) / this.height) * 111320;
    return (w * h) / 10000;
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
    const { xmin, ymin, xmax, ymax } = this.extent;
    if (lon < xmin || lon > xmax || lat < ymin || lat > ymax) return NO_DATA;
    const col = Math.floor(((lon - xmin) / (xmax - xmin)) * this.width);
    const row = Math.floor(((ymax - lat) / (ymax - ymin)) * this.height);
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
