// Números exatos do concelho, contados no ArcGIS Pro por scripts/pro_to_web.py (bloco "concelho" do manifest).
import { concelho } from "./dourorisk-grids.json"; // import nomeado: só esta chave entra no bundle
import type { LayerAbout } from "../geo/grid";

/** Um ano de 1990 a 2025 (polígonos anuais do ICNF). mapa=false: sem cartografia (ha e ha_ja_ardido null). */
export interface TempoAno {
  ano: number; mapa: boolean;
  /** hectares do concelho que arderam neste ano */
  ha: number | null;
  /** desses, os que já tinham ardido num ano anterior (desde 1990) */
  ha_ja_ardido: number | null;
  /** área que ardeu pelo menos uma vez de 1990 até este ano */
  ha_ate: number;
}

/** Tabela do mato do estudo: t/ha e classe (1 a 5) por anos desde o último fogo (índice = anos). */
export interface TempoMato {
  t_ha: readonly (number | null)[]; classe: readonly number[];
  /** anos sem número no estudo (classe = limite de baixo) */
  suposicao: readonly number[];
  teto: number; teto_desde: number;
  /** primeiro número de anos com classe 4 («muito mato») */
  t_muito_mato: number;
  about: LayerAbout;
}

/** Hectares de cada classe de mato (0 = sem conta) num ano, se nada voltar a arder nem for limpo. */
export interface TempoProjecao { ano: number; ha_classes: readonly number[]; ha_suposicao: number }

export interface TempoVerao { ano: number; ha: number; fracao: number; acertou: boolean }

export interface TempoStats {
  /** chaves das camadas ardeu_<a>_<b> (um bit por ano) */
  planos: readonly string[];
  anos_sem_mapa: readonly number[];
  anos: readonly TempoAno[];
  ha_soma: number;
  ano_max: number;
  mato: TempoMato;
  projecao: readonly TempoProjecao[];
  salto: { ano: number; ha: number; ultimo_fogo: number };
  veroes: { de: number; ate: number; minimo_ha: number; fracao_vigiada: number; anos: readonly TempoVerao[]; acertos: number; total: number };
}

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
  /** máquina do tempo: o que ardeu em cada ano, o mato que voltaria e os verões do passo 4 */
  tempo: TempoStats;
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
