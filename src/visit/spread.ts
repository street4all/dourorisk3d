// "E se uma faísca caísse aqui?": modelo simplificado de propagação para aprender (não é uma previsão).
// Células de 50 m; o fogo anda mais depressa onde o perigo oficial é alto, nas encostas inclinadas,
// nas encostas viradas ao sol e a favor do vento de agora. Caminho mais rápido (Dijkstra) a partir da faísca.
import { cellAt, loadStack } from "./stack";
import { HA_POR_CAMPO } from "../data/numeros";

const STEP = 2; // 2 × 25 m = células de 50 m
const MAX_CELLS = 24000; // segurança: 24 000 × 0,25 ha = 6 000 ha
/** Duração do fogo no modelo (mesma para todas as faíscas): a área muda com o vento, o mato e o terreno. */
const TIME_LIMIT = 36;
const PERIGO_SPEED = [0, 0.25, 0.45, 0.7, 1.0, 1.3];
const DECLIVE_SPEED = [1, 0.9, 1, 1.25, 1.5];
export const HA_PER_CELL = 0.25;
/** Campo de futebol de 105 × 68 m, em hectares: o mesmo do Explorar e da apresentação (src/data/numeros.ts). */
export const HA_PER_FIELD = HA_POR_CAMPO;

export interface SpreadResult {
  width: number;
  height: number;
  /** tempo de chegada por célula (Infinity = não chega) */
  time: Float32Array;
  /** tempo em que o fogo pára no modelo */
  end: number;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i;
        let mk = lk;
        if (a < n && k[a] < mk) { m = a; mk = k[a]; }
        if (b < n && k[b] < mk) { m = b; mk = k[b]; }
        if (m === i) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/** Simula a partir de (lon, lat). `windFrom` em graus (de onde vem o vento, como no IPMA). null fora do concelho. */
export async function simulateSpread(lon: number, lat: number, windKmh: number, windFrom: number): Promise<SpreadResult | null> {
  const g = await loadStack();
  const start = cellAt(g, lon, lat);
  if (start < 0 || !g.inside[start]) return null;
  const W = Math.floor(g.width / STEP), H = Math.floor(g.height / STEP);
  // velocidade de cada célula de 50 m (0 = não arde: fora do concelho)
  const speed = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * STEP * g.width + x * STEP;
      if (!g.inside[i]) continue;
      const base = PERIGO_SPEED[g.perigo[i]] || 0.2;
      const bump = g.mato[i] >= 4 ? 1.2 : 1;
      const sun = g.sol[i] === 1 ? 1.12 : 1;
      speed[y * W + x] = base * (DECLIVE_SPEED[g.declive[i]] ?? 1) * bump * sun;
    }
  }
  // o fogo vai para onde o vento sopra: o contrário de onde vem
  const to = ((windFrom + 180) * Math.PI) / 180;
  const wx = Math.sin(to), wy = -Math.cos(to); // grelha: x para este, y para sul
  const k = Math.min(1.6, Math.max(0, windKmh) / 20);

  const time = new Float32Array(W * H).fill(Infinity);
  const sx = Math.floor((start % g.width) / STEP), sy = Math.floor(Math.floor(start / g.width) / STEP);
  const s = Math.min(H - 1, sy) * W + Math.min(W - 1, sx);
  if (!speed[s]) return null;
  time[s] = 0;
  const heap = new MinHeap();
  heap.push(0, s);
  const done = new Uint8Array(W * H);
  let count = 0;
  let end = 0;
  while (heap.size && count < MAX_CELLS) {
    const [t, i] = heap.pop();
    if (t > TIME_LIMIT) break;
    if (done[i]) continue;
    done[i] = 1;
    count++;
    end = t;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        const sp = speed[j];
        if (!sp || done[j]) continue;
        const len = Math.hypot(dx, dy);
        const align = (dx * wx + dy * wy) / len;
        const v = ((sp + speed[i]) / 2) * Math.max(0.25, 1 + k * align);
        const nt = t + len / v;
        if (nt < time[j]) {
          time[j] = nt;
          heap.push(nt, j);
        }
      }
    }
  }
  // o que ficou na fila depois de parar não conta como ardido
  for (let i = 0; i < time.length; i++) if (!done[i]) time[i] = Infinity;
  return { width: W, height: H, time, end: count >= MAX_CELLS ? end || 1 : TIME_LIMIT };
}

/** Imagem do fogo no instante `now`: frente amarela, chamas laranja, cinza escura atrás. */
export function renderSpread(r: SpreadResult, now: number): { image: ImageData; cells: number } {
  const img = new ImageData(r.width, r.height);
  const px = img.data;
  const front = r.end * 0.06, flames = r.end * 0.16;
  let cells = 0;
  for (let i = 0; i < r.time.length; i++) {
    const t = r.time[i];
    if (t > now) continue;
    cells++;
    const age = now - t;
    const o = i * 4;
    if (age < front) {
      px[o] = 255; px[o + 1] = 196; px[o + 2] = 40; px[o + 3] = 245;
    } else if (age < flames) {
      px[o] = 238; px[o + 1] = 90; px[o + 2] = 26; px[o + 3] = 230;
    } else {
      px[o] = 52; px[o + 1] = 22; px[o + 2] = 10; px[o + 3] = 215;
    }
  }
  return { image: img, cells };
}
