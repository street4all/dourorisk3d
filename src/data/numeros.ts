// Números do DouroRisk: arredondamentos e formatação pt-PT, iguais na app (src/visit/*) e na apresentação
// (plugin de vite.config.ts). Sem DOM nem ArcGIS: também corre no Node, ao carregar o vite.config.ts.

/** Campo de futebol de 105 × 68 m, em hectares. */
export const HA_POR_CAMPO = 0.714;
/** Espaço que não parte (U+00A0): nos milhares (4 028) e entre o número e a unidade (16 %). */
export const NBSP = "\u00A0";

/** Inteiro arredondado, sempre com espaço nos milhares: 4028 -> "4 028", 995 -> "995". */
export const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
/** Inteiro para o leitor de ecrã: sem espaço (um espaço pode partir a leitura em dois números). */
export const srInt = (n: number): string => String(Math.round(n));
/** Uma casa decimal, com vírgula: 297.5875 -> "297,6". */
export const fmtDec1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",");
/** Altitude arredondada a 5 m (vale para um quadrado de 25 m; o terreno 3D difere até 11 m). */
export const altitude5 = (m: number): number => Math.round(m / 5) * 5;

/** Percentagem inteira que não engana nas pontas: "0", "menos de 1", "1"…"99", "mais de 99", "100" (sem o símbolo). */
export function pctTxt(n: number, total: number): string {
  if (!total || n <= 0) return "0";
  if (n >= total) return "100";
  const p = (n / total) * 100;
  if (p < 1) return "menos de 1";
  if (p > 99) return "mais de 99";
  return String(Math.round(p));
}

/** 2 algarismos significativos (abaixo de 100, às unidades). "minimo" arredonda para baixo (nunca exagera). */
export function sig2(x: number, modo: "perto" | "minimo" = "perto"): number {
  const passo = 10 ** Math.max(0, String(Math.floor(x)).length - 2);
  return (modo === "minimo" ? Math.floor(x / passo) : Math.round(x / passo)) * passo;
}

export interface Texto { vis: string; sr: string }

/** Área: a partir de 1000 ha em km² com 1 casa; abaixo, hectares inteiros; abaixo de 1, "menos de 1 ha". */
export function area(ha: number): Texto {
  if (ha >= 1000) { const k = fmtDec1(ha / 100); return { vis: `${k}${NBSP}km²`, sr: `${k} quilómetros quadrados` }; }
  if (ha < 1) return { vis: `menos de 1${NBSP}ha`, sr: "menos de 1 hectare" };
  const n = Math.round(ha);
  return { vis: `${fmtInt(n)}${NBSP}ha`, sr: `${srInt(n)} ${n === 1 ? "hectare" : "hectares"}` };
}

/** Campos de futebol, sempre "cerca de" e com 2 algarismos significativos (41 679 -> 42 000). */
export function campos(ha: number): Texto {
  const f = ha / HA_POR_CAMPO;
  if (f < 0.5) return { vis: "menos de 1 campo de futebol", sr: "menos de 1 campo de futebol" };
  const n = sig2(f), w = n === 1 ? "campo" : "campos";
  return { vis: `cerca de ${fmtInt(n)} ${w} de futebol`, sr: `cerca de ${srInt(n)} ${w} de futebol` };
}

/** Raio: abaixo de 1 km em metros (a 5 m); a partir daí em km com no máximo 1 casa. */
export function distancia(m: number): Texto {
  if (m >= 1000) {
    const k = Math.round(m / 100) / 10, t = Number.isInteger(k) ? String(k) : fmtDec1(k);
    return { vis: `${t}${NBSP}km`, sr: `${t} ${k === 1 ? "quilómetro" : "quilómetros"}` };
  }
  const r = Math.round(m / 5) * 5;
  return { vis: `${fmtInt(r)}${NBSP}m`, sr: `${srInt(r)} metros` };
}

/** "N em cada 10" que nunca exagera: a grelha de 10 quadrados pinta sempre n. */
export function emCada10(pct: number): { n: number; frase: string } {
  const n = Math.floor(pct / 10), resto = pct - n * 10;
  if (resto < 0.5) return { n, frase: `${n} em cada 10` };
  if (resto >= 5) return { n, frase: `Quase ${n + 1} em cada 10` };
  return { n, frase: `Mais de ${n} em cada 10` };
}

/** A parte do bloco "concelho" do manifest que a apresentação usa. */
export interface NumerosConcelho {
  area_ha: number;
  resumo: { altitude_m: { max: number; rio: number }; ardeu_pct: number; ha_por_ultimo_ano: Readonly<Record<string, number>>; periodo: readonly number[] };
}

/** Números do HTML estático (marcadores <!--n:chave-->…<!--/n-->), a partir do manifest inteiro. */
export function numerosApresentacao(m: { concelho?: NumerosConcelho }): Record<string, string> {
  const c = m.concelho;
  if (!c?.resumo) throw new Error("[numeros] o manifest não tem o bloco concelho: corre scripts/pro_to_web.py");
  const r = c.resumo, ha2017 = r.ha_por_ultimo_ano["2017"];
  if (ha2017 == null) throw new Error("[numeros] falta concelho.resumo.ha_por_ultimo_ano[\"2017\"]");
  const e = emCada10(r.ardeu_pct), c2017 = sig2(ha2017 / HA_POR_CAMPO, "minimo");
  return {
    area_km2: fmtDec1(c.area_ha / 100),
    rio_m: fmtInt(r.altitude_m.rio),
    alt_max_m: fmtInt(r.altitude_m.max),
    ardeu_pct: String(Math.round(r.ardeu_pct)),
    ardeu_n10: String(e.n),
    ardeu_frase: e.frase,
    grid10_ardeu: '<i class="on"></i>'.repeat(e.n) + "<i></i>".repeat(10 - e.n),
    campos_2017_min: fmtInt(c2017),
    campos_2017_min_sr: srInt(c2017),
    ano_inicio: String(r.periodo[0]),
    ano_fim: String(r.periodo[1]),
  };
}
