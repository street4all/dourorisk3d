// Pistas que se somam (passo 2): cada pista marca os sítios onde ajuda o fogo;
// o mapa mostra quantas pistas ligadas se juntam em cada sítio (cor + textura + número na legenda).
import { cellAt, loadStack, type GridStack } from "./stack";

export interface Cue {
  key: string;
  /** frase curta para dizer porque é que aquele sítio conta */
  short: string;
  hit: (g: GridStack, i: number) => boolean;
}

export const CUE_DEFS: Cue[] = [
  { key: "declive_a11y", short: "encosta muito inclinada", hit: (g, i) => g.declive[i] >= 3 },
  { key: "exposicao_sol", short: "virada ao sol", hit: (g, i) => g.sol[i] === 1 },
  { key: "biomassa_2025", short: "muito mato", hit: (g, i) => g.mato[i] >= 4 },
  { key: "icnf_estrutural", short: "perigo alto no mapa oficial", hit: (g, i) => g.perigo[i] >= 4 },
];

/** Cores do claro ao escuro (seguras para daltonismo), uma por número de pistas juntas. */
export const COUNT_COLORS = ["#FFE08A", "#F59E3B", "#C2410C", "#5B1A06"];
const RGB = COUNT_COLORS.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));

export function cueDef(key: string): Cue | undefined {
  return CUE_DEFS.find((c) => c.key === key);
}

/** Imagem com o número de pistas ligadas em cada célula; 3 ou mais pistas levam riscas. */
export async function renderCueCount(keys: string[]): Promise<ImageData> {
  const g = await loadStack();
  const cues = CUE_DEFS.filter((c) => keys.includes(c.key));
  const img = new ImageData(g.width, g.height);
  const px = img.data;
  for (let row = 0; row < g.height; row++) {
    for (let col = 0; col < g.width; col++) {
      const i = row * g.width + col;
      if (!g.inside[i]) continue;
      let n = 0;
      for (const c of cues) if (c.hit(g, i)) n++;
      if (!n) continue;
      const [r, gg, b] = RGB[Math.min(n, 4) - 1];
      // textura: riscas diagonais escuras quando se juntam 3 ou mais pistas
      const stripe = n >= 3 && (row + col) % 6 < 2;
      const o = i * 4;
      px[o] = stripe ? r * 0.45 : r;
      px[o + 1] = stripe ? gg * 0.45 : gg;
      px[o + 2] = stripe ? b * 0.45 : b;
      px[o + 3] = 150 + n * 22;
    }
  }
  return img;
}

/** Que pistas ligadas valem neste ponto (null fora do concelho). */
export async function cuesAt(keys: string[], lon: number, lat: number): Promise<Cue[] | null> {
  const g = await loadStack();
  const i = cellAt(g, lon, lat);
  if (i < 0 || !g.inside[i]) return null;
  return CUE_DEFS.filter((c) => keys.includes(c.key) && c.hit(g, i));
}
