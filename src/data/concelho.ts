// Números exatos do concelho, contados no ArcGIS Pro por scripts/pro_to_web.py (bloco "concelho" do manifest).
import { concelho } from "./dourorisk-grids.json"; // import nomeado: só esta chave entra no bundle

export interface ConcelhoStats {
  area_ha: number;
  celulas: Readonly<Record<string, number>>;
  contagens: Readonly<Record<string, { grid: string; total: number; contagem: readonly number[] }>>;
  limite: { fonte: string; origem: string; regra: string };
  notas: Readonly<Record<string, string>>;
  resumo: {
    altitude_m: { max: number; min: number; rio: number };
    ardeu_5_ou_mais_ha: number; ardeu_ha: number; ardeu_pct: number;
    ha_por_ultimo_ano: Readonly<Record<string, number>>;
    icnf_sem_numero_ha: number; icnf_sem_numero_pct: number; mato_sem_estimativa_pct: number;
    max_vezes: number; max_vezes_ha: number; periodo: readonly number[]; rio_ha: number;
    risco_alto_pct: number; ultimo_fogo_ano: number;
  };
}

export const CONCELHO: ConcelhoStats = concelho;
/** Primeiro e último ano dos dados de fogo (1990 e 2025): nunca se escrevem à mão nos textos. */
export const [A0, A1] = CONCELHO.resumo.periodo as [number, number];

/** Contagens do concelho no formato de ClassGrid.histogram (256 posições). */
export function concelhoHist(key: string): { counts: number[]; total: number } | null {
  const c = CONCELHO.contagens[key];
  if (!c) return null;
  const counts = new Array<number>(256).fill(0);
  c.contagem.forEach((n, i) => (counts[i] = n));
  return { counts, total: c.total };
}
