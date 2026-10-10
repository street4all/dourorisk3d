// Grelhas de valores exatos (public/data/dourorisk/valores, geradas por scripts/pro_to_web.py): o número de
// cada célula de 25 m (vezes que ardeu, ano, declive, exposição, mato, altitude), lido pela codificação do
// manifest. Os PNG usam o mesmo leitor das classes (ClassGrid); a altitude vem de um Int16 (mdt.bin).
import { GRID_MANIFEST, gridOfLayer, indexOf, type GridGeo } from "../geo/grid";
import { ClassGrid, NO_DATA } from "./sampler";

const file = (k: string) => GRID_MANIFEST.layers[k].files.values!;
const enc = (k: string) => GRID_MANIFEST.layers[k].encoding!;

/** PNG L de 8 bits com o mesmo leitor das classes (valor bruto por célula). */
export const VALUES = {
  concelho: new ClassGrid(file("concelho_25m"), gridOfLayer("concelho_25m")),
  rio: new ClassGrid(file("rio_douro_25m"), gridOfLayer("rio_douro_25m")),
  recorrencia: new ClassGrid(file("recorrencia_valor"), gridOfLayer("recorrencia_valor")),
  ultimoAno: new ClassGrid(file("ultimo_ano"), gridOfLayer("ultimo_ano")),
  declive: new ClassGrid(file("declive_pct"), gridOfLayer("declive_pct")),
  exposicao: new ClassGrid(file("exposicao_graus"), gridOfLayer("exposicao_graus")),
  biomassa: new ClassGrid(file("biomassa_t_ha"), gridOfLayer("biomassa_t_ha")),
};

/** Valor real de um byte, pela codificação do manifest. null = sem dados (special ou nodata). Não usar em máscaras 0/1. */
export function decode(key: string, raw: number): number | null {
  const e = enc(key);
  if (raw === e.nodata || (e.special && String(raw) in e.special)) return null;
  if (e.lut) return e.lut[raw] ?? null;
  return raw * (e.scale ?? 1) + (e.offset ?? 0);
}

/** O máximo do cálculo do mato, em t/ha (o último valor da tabela: 40). */
export const T_HA_MAX = Math.max(...enc("biomassa_t_ha").lut!);

/** byte no ponto: undefined = fora da grelha ou não carregou */
export async function rawAt(g: ClassGrid, lon: number, lat: number): Promise<number | undefined> {
  const v = await g.sample(lon, lat, 0);
  return v === NO_DATA ? undefined : v;
}

/** Grelha de inteiros de 16 bits (little-endian), uma célula por valor, linha a linha de norte para sul. */
export class Int16Grid {
  private view: DataView | null = null;
  private loading: Promise<void> | null = null;

  constructor(private url: string, readonly geo: GridGeo, private nodata: number) {}

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const res = await fetch(this.url);
        if (!res.ok) throw new Error(`Não foi possível ler ${this.url} (${res.status})`);
        const buf = await res.arrayBuffer();
        const { width, height, id } = this.geo;
        // um ficheiro com outro tamanho já não corresponde à grelha: melhor não ler do que ler mal
        if (buf.byteLength !== width * height * 2) {
          throw new Error(`${this.url}: ${buf.byteLength} bytes, a grelha ${id} pede ${width * height * 2}`);
        }
        this.view = new DataView(buf);
      })().catch((err) => {
        this.loading = null; // permite tentar outra vez (ex.: rede instável)
        throw err;
      });
    }
    return this.loading;
  }

  /** Valor no ponto: null = sem dados (nodata); undefined = fora da grelha ou a grelha não carregou. */
  async sample(lon: number, lat: number): Promise<number | null | undefined> {
    try {
      await this.load();
    } catch {
      return undefined;
    }
    const i = indexOf(this.geo, lon, lat);
    if (i < 0 || !this.view) return undefined;
    const v = this.view.getInt16(i * 2, true);
    return v === this.nodata ? null : v;
  }
}

/** Altitude do terreno do estudo (MDT de 25 m), em metros. */
export const MDT = new Int16Grid(file("mdt"), gridOfLayer("mdt"), enc("mdt").nodata!);

/** Lê já as grelhas de valores (ao abrir o Explorar), sem esperar nem falhar. */
export function preloadValues(): void {
  void Promise.allSettled([...Object.values(VALUES).map((g) => g.load()), MDT.load()]);
}
