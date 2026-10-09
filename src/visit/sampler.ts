// Lê o valor de uma grelha de classes (PNG em tons de cinzento, valor = classe)
// num ponto do mapa. As imagens DouroRisk são os rasters originais célula a célula,
// esticados para a extensão WGS84 — por isso a conversão é linear, igual à do MediaLayer.

export interface Extent4326 {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export class ClassGrid {
  private data: Uint8ClampedArray | null = null;
  private width = 0;
  private height = 0;
  private loading: Promise<void> | null = null;

  constructor(private url: string, private extent: Extent4326) {}

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = new Promise((resolve, reject) => {
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
      });
    }
    return this.loading;
  }

  /** Classe no ponto (0 = sem dados). `radius` em células: devolve o máximo à volta. */
  async sample(lon: number, lat: number, radius = 0): Promise<number> {
    await this.load();
    if (!this.data) return 0;
    const { xmin, ymin, xmax, ymax } = this.extent;
    if (lon < xmin || lon > xmax || lat < ymin || lat > ymax) return 0;
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
