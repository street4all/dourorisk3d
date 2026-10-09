// As grelhas de 25 m do concelho, todas na mesma extensão (EXT_25M), lidas uma vez e partilhadas
// pelas pistas que se somam e pela faísca. O limite do concelho vem da grelha de risco (10 m).
import { VISIT_LAYERS, EXT_25M } from "./layers";
import type { Extent4326 } from "./sampler";

export interface GridStack {
  width: number;
  height: number;
  extent: Extent4326;
  /** 1 dentro do concelho */
  inside: Uint8Array;
  declive: Uint8Array;
  sol: Uint8Array;
  mato: Uint8Array;
  perigo: Uint8Array;
}

let pending: Promise<GridStack> | null = null;

export function loadStack(): Promise<GridStack> {
  if (!pending) {
    pending = (async () => {
      const [d, s, m, p, r] = await Promise.all([
        VISIT_LAYERS.declive_a11y.grid.raw(),
        VISIT_LAYERS.exposicao_sol.grid.raw(),
        VISIT_LAYERS.biomassa_2025.grid.raw(),
        VISIT_LAYERS.icnf_estrutural.grid.raw(),
        VISIT_LAYERS.risco_2025.grid.raw(),
      ]);
      const { width, height } = d;
      const inside = new Uint8Array(width * height);
      const e = EXT_25M;
      const re = r.extent;
      for (let row = 0; row < height; row++) {
        const lat = e.ymax - ((row + 0.5) / height) * (e.ymax - e.ymin);
        const rr = Math.floor(((re.ymax - lat) / (re.ymax - re.ymin)) * r.height);
        if (rr < 0 || rr >= r.height) continue;
        for (let col = 0; col < width; col++) {
          const lon = e.xmin + ((col + 0.5) / width) * (e.xmax - e.xmin);
          const rc = Math.floor(((lon - re.xmin) / (re.xmax - re.xmin)) * r.width);
          if (rc >= 0 && rc < r.width && r.cls[rr * r.width + rc] > 0) inside[row * width + col] = 1;
        }
      }
      return { width, height, extent: e, inside, declive: d.cls, sol: s.cls, mato: m.cls, perigo: p.cls };
    })().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Índice da célula de 25 m que contém o ponto, ou -1 fora da grelha. */
export function cellAt(g: GridStack, lon: number, lat: number): number {
  const { xmin, ymin, xmax, ymax } = g.extent;
  if (lon < xmin || lon > xmax || lat < ymin || lat > ymax) return -1;
  const col = Math.min(g.width - 1, Math.floor(((lon - xmin) / (xmax - xmin)) * g.width));
  const row = Math.min(g.height - 1, Math.floor(((ymax - lat) / (ymax - ymin)) * g.height));
  return row * g.width + col;
}
