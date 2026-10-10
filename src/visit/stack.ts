// As grelhas de 25 m do concelho, todas na mesma grelha PT-TM06 (g25), lidas uma vez e partilhadas
// pelas pistas que se somam e pela faísca. O limite do concelho vem da grelha de risco (10 m).
import { VISIT_LAYERS } from "./layers";
import { indexOf, type GridGeo } from "../geo/grid";

export interface GridStack {
  width: number;
  height: number;
  /** a grelha de 25 m (PT-TM06) de todas as camadas da pilha */
  grid: GridGeo;
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
      const g = d.grid;
      // a pilha soma célula a célula: as quatro camadas têm de estar na mesma grelha
      for (const o of [s, m, p]) if (o.grid !== g) throw new Error(`Grelhas diferentes na pilha: ${g.id} e ${o.grid.id}`);
      const { width, height } = g;
      // dentro do concelho = a célula de 10 m do risco que contém o centro da célula de 25 m tem risco > 0;
      // a correspondência é aritmética em PT-TM06 (as duas grelhas são paralelas, só mudam a origem e o lado)
      const rg = r.grid;
      const rcol = new Int32Array(width);
      for (let col = 0; col < width; col++) {
        const x = g.x0 + (col + 0.5) * g.cell;
        rcol[col] = Math.floor((x - rg.x0) / rg.cell);
      }
      const inside = new Uint8Array(width * height);
      for (let row = 0; row < height; row++) {
        const y = g.y0 - (row + 0.5) * g.cell;
        const rr = Math.floor((rg.y0 - y) / rg.cell);
        if (rr < 0 || rr >= rg.height) continue;
        const base = rr * rg.width;
        for (let col = 0; col < width; col++) {
          const rc = rcol[col];
          if (rc >= 0 && rc < rg.width && r.cls[base + rc] > 0) inside[row * width + col] = 1;
        }
      }
      return { width, height, grid: g, inside, declive: d.cls, sol: s.cls, mato: m.cls, perigo: p.cls };
    })().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Índice da célula de 25 m que contém o ponto, ou -1 fora da grelha. */
export function cellAt(g: GridStack, lon: number, lat: number): number {
  return indexOf(g.grid, lon, lat);
}
