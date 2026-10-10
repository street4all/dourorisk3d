// Explorar, ponto: lê todos os dados de um ponto de uma só vez e monta a ficha.
// Regra principal: o número vem da grelha de valores (exato); a palavra e a cor vêm da grelha de classes,
// que é a do mapa e da legenda. O texto visível fica escondido do leitor de ecrã e ao lado vai uma só
// frase completa (unidades por extenso, números sem espaço, a acabar na fonte).
import { cellOf, gridFromManifest } from "../geo/grid";
import { A0, A1, CONCELHO } from "../data/concelho";
import { NBSP, altitude5, fmtInt, srInt } from "../data/numeros";
import { NO_DATA } from "./sampler";
import { VISIT_LAYERS } from "./layers";
import { MDT, T_HA_MAX, VALUES, decode, rawAt } from "./values";
import { DECL_WORDS, FORA_DO_SOL, MATO_WORDS, RISK_WORDS, SOL_TARDE, esc, fonteCurtaHtml, rumo, vezes } from "./words";
import { aboutOf, fonteSr } from "./how";

/** undefined = não foi possível ler (grelha não carregou); null = sem dados nesse sítio. */
export type V<T> = T | null | undefined;
export interface PointValues {
  lon: number; lat: number;
  cell: { col: number; row: number } | null;       // célula da g25; null = fora da grelha de 25 m
  dentro: V<boolean>; rio: V<boolean>;             // concelho_25m == 1; rio_douro_25m == 1 (bytes brutos)
  risco: V<number>; perigo: V<number>; icnf: V<number>; icnf2030: V<number>;  // classes 1–5 (0 -> null)
  vezes: V<number>; ultimoAno: V<number>;          // 0–9; ano (null = nunca ou sem dados)
  declive: V<{ pct: number; classe: number }>;     // pct do valor truncado; classe de declive_a11y
  virada: V<{ graus: number; classe: number }>;    // null = plano; classe de exposicao_sol
  mato: V<{ tHa: number; classe: number }>;        // null = sem estimativa; classe de biomassa_2025
  altitude: V<{ m: number; fonte: "terreno" | "mapa3d" }>;
}

const G25 = gridFromManifest("g25");

/**
 * Classe no ponto, na grelha do mapa: 0 -> null (sem dados). NO_DATA quer dizer "fora da grelha" ou "não
 * carregou": fora de uma grelha que carregou é null (ex.: a de 10 m do risco acaba uns metros antes do
 * limite norte do concelho), e só a grelha que falhou dá undefined («não foi possível ler»).
 */
async function classeAt(k: string, lon: number, lat: number): Promise<V<number>> {
  const g = VISIT_LAYERS[k]?.grid;
  if (!g) return undefined;
  const v = await g.sample(lon, lat, 0);
  if (v !== NO_DATA) return v > 0 ? v : null;
  return cellOf(g.geo, lon, lat) === null && (await g.bytes()) ? null : undefined;
}
/** Valor exato de um byte: undefined se não leu; null se é "sem dados". */
const valor = (key: string, raw: number | undefined): V<number> => (raw === undefined ? undefined : decode(key, raw));

/** Número com a sua classe: undefined se uma das duas grelhas não leu; null se não há número. */
function par<T>(v: V<number>, c: V<number>, make: (v: number, c: number) => T): V<T> {
  if (v === undefined || c === undefined) return undefined;
  return v === null ? null : make(v, c ?? 0);
}

export async function readPoint(lon: number, lat: number, elev?: (lon: number, lat: number) => Promise<number | null>): Promise<PointValues> {
  const cls = (k: string) => classeAt(k, lon, lat);
  const [conc, rio, rec, ua, dec, exp, bio, risco, perigo, icnf, icnf2030, decC, solC, matoC, mdt] = await Promise.all([
    rawAt(VALUES.concelho, lon, lat),
    rawAt(VALUES.rio, lon, lat),
    rawAt(VALUES.recorrencia, lon, lat),
    rawAt(VALUES.ultimoAno, lon, lat),
    rawAt(VALUES.declive, lon, lat),
    rawAt(VALUES.exposicao, lon, lat),
    rawAt(VALUES.biomassa, lon, lat),
    cls("risco_2025"),
    cls("perigosidade_2025"),
    cls("icnf_conjuntural"),
    cls("icnf_estrutural"),
    cls("declive_a11y"),
    cls("exposicao_sol"),
    cls("biomassa_2025"),
    MDT.sample(lon, lat),
  ]);
  const cell = cellOf(G25, lon, lat);
  // fora da grelha de 25 m é sempre fora do concelho (a grelha cobre o concelho e arredores)
  const mask = (raw: number | undefined): V<boolean> => (!cell ? false : raw === undefined ? undefined : raw === 1);
  let altitude: PointValues["altitude"];
  if (typeof mdt === "number") altitude = { m: mdt, fonte: "terreno" };
  else if (mdt === null) altitude = null;
  else if (!cell) altitude = undefined; // fora da grelha de 25 m a ficha só diz FORA: não se pede a altitude 3D
  else {
    const z = elev ? await elev(lon, lat) : null;
    altitude = z == null ? undefined : { m: z, fonte: "mapa3d" };
  }
  return {
    lon, lat, cell,
    dentro: mask(conc),
    rio: mask(rio),
    risco, perigo, icnf, icnf2030,
    vezes: valor("recorrencia_valor", rec),
    ultimoAno: valor("ultimo_ano", ua),
    declive: par(valor("declive_pct", dec), decC, (pct, c) => ({ pct, classe: c })),
    virada: par(valor("exposicao_graus", exp), solC, (graus, c) => ({ graus, classe: c })),
    mato: par(valor("biomassa_t_ha", bio), matoC, (tHa, c) => ({ tHa, classe: c })),
    altitude,
  };
}

// ------------------------------------------------------------------ a ficha

interface Linha {
  label: string;
  /** fonte curta, por baixo do nome */
  src: string;
  /** amostra de cor; null = sem célula de cor (altitude) */
  swatch: string | null;
  main: string;
  tec?: string;
  sub?: string;
  sr: string;
}

/** Cor do item da legenda do mapa para a classe c (undefined = sem cor). */
function cor(key: string, c: number | null | undefined): string | undefined {
  if (!c) return undefined;
  return VISIT_LAYERS[key]?.legend.find((it) => it.classes.includes(c))?.color;
}

const sw = (color: string | undefined): string =>
  color ? `<span class="sw" style="background:${color}" aria-hidden="true"></span>` : `<span class="sw none" aria-hidden="true"></span>`;

function linhaHtml(l: Linha): string {
  // o nome e a fonte curta são só para quem vê: a frase sr-only da linha já diz tudo (não se lê o nome duas vezes)
  const th = `<span aria-hidden="true">${esc(l.label)}</span><span class="pv-src" aria-hidden="true">${fonteCurtaHtml(l.src)}</span>`;
  const vis =
    `<strong>${esc(l.main)}</strong>` +
    (l.tec ? `<span class="pv-tec">(${esc(l.tec)})</span>` : "") +
    (l.sub ? `<span class="pv-sub">${esc(l.sub)}</span>` : "");
  return `<tr><th scope="row">${th}</th><td>${l.swatch ?? ""}</td><td class="pv"><span aria-hidden="true">${vis}</span><span class="sr-only">${esc(l.sr.trim())}</span></td></tr>`;
}

/**
 * Fonte para o leitor de ecrã, só quando não é o estudo DouroRisk (ex.: o mapa oficial do ICNF). As linhas do
 * estudo não repetem «Fonte:» (a ficha ficava longa demais); a frase do fim da tabela diz de onde vêm.
 */
function fonteFrase(key: string): string {
  return aboutOf(key).fonte.includes("DouroRisk") ? "" : `Fonte: ${fonteSr(key)}.`;
}

/** A grelha não carregou: a linha diz que não foi possível ler, sem inventar. */
const naoLeu = (l: Pick<Linha, "label" | "src" | "swatch">, nome: string): Linha => ({
  ...l,
  main: "não foi possível ler",
  sr: `${nome}: não foi possível ler este dado.`,
});

/** Risco e perigos (escalas de 1 a 5). */
function escala(
  key: string,
  base: Pick<Linha, "label">,
  nome: string,
  c: V<number>,
  semValor: { main: string; sub: string; sr: string },
  tec?: string,
): Linha {
  const F = fonteFrase(key);
  const l = { ...base, src: aboutOf(key).fonte_curta, swatch: sw(cor(key, c)) };
  if (c === undefined) return naoLeu(l, nome);
  if (c === null) return { ...l, main: semValor.main, sub: semValor.sub, sr: `${semValor.sr} ${F}`, tec };
  const P = RISK_WORDS[c - 1];
  return { ...l, main: `${c} · ${P}`, sr: `${nome}: ${c}, ${P}. A escala vai de 1 a 5. ${F}`, tec };
}

const estudoSem = (nome: string) => ({ main: "sem dados", sub: "o estudo não tem valor aqui", sr: `${nome}: sem dados. O estudo não tem valor para este sítio.` });
const oficialSem = {
  main: "sem número",
  sub: "por exemplo, zonas com casas",
  sr: "Perigo oficial: sem número. O mapa oficial não dá número a este sítio. Deixa de fora, por exemplo, zonas com casas.",
};

/** «1990 a 2025» sem partir no fim da linha (só no texto visível; o leitor de ecrã lê a frase inteira). */
const PERIODO_VIS = `${A0}${NBSP}a${NBSP}${A1}`;

/** «Já ardeu?» é uma pergunta: a resposta «não» ou «3 vezes» lê bem logo a seguir, também no leitor de ecrã. */
function jaArdeu(p: PointValues): Linha {
  const key = "recorrencia_valor", F = fonteFrase(key);
  const n = p.vezes, ano = p.ultimoAno;
  const l = { label: "Já ardeu?", src: aboutOf(key).fonte_curta, swatch: sw(n ? cor("recorrencia_a11y", Math.min(n, 5)) : undefined) };
  if (n === undefined) return naoLeu(l, "Quantas vezes ardeu");
  if (n === null) return { ...l, main: "sem dados", sr: `Quantas vezes ardeu: sem dados. ${F}` };
  if (n === 0) return { ...l, main: "não", sub: `de ${PERIODO_VIS}`, sr: `Não ardeu de ${A0} a ${A1}. Antes de ${A0} não há dados. ${F}` };
  if (ano == null) return { ...l, main: vezes(n), sr: `Ardeu ${vezes(n)} de ${A0} a ${A1}. ${F}` };
  if (n === 1) return { ...l, main: vezes(1), sub: `em ${ano}`, sr: `Ardeu 1 vez de ${A0} a ${A1}, em ${ano}. ${F}` };
  return { ...l, main: vezes(n), sub: `a última em ${ano}`, sr: `Ardeu ${vezes(n)} de ${A0} a ${A1}. A última vez foi em ${ano}. ${F}` };
}

function encosta(p: PointValues): Linha {
  const key = "declive_pct", F = fonteFrase(key);
  const d = p.declive;
  const l = { label: "Encosta", src: aboutOf(key).fonte_curta, swatch: sw(cor("declive_a11y", d?.classe)) };
  if (d === undefined) return naoLeu(l, "Encosta");
  if (d === null) return { ...l, main: "sem dados", sr: `Encosta: sem dados. ${F}` };
  const v = d.pct, w = DECL_WORDS[d.classe];
  if (v === 0) {
    // truncado: 0 quer dizer de 0 a 1 %. Plano só onde a encosta não tem lado (declive 0 exato), como na linha seguinte
    if (p.virada === null) return { ...l, main: `0${NBSP}% · plana`, sr: `Aqui o terreno é plano. ${F}` };
    return { ...l, main: `menos de 1${NBSP}% · ${w}`, sub: `sobe menos de 1${NBSP}m em 100${NBSP}m`, sr: `Encosta ${w}: sobe menos de 1 metro em cada 100 metros. ${F}` };
  }
  const sobe = `Encosta ${w}: sobe ${srInt(v)} metros em cada 100 metros.`;
  if (v >= 100) return { ...l, main: `${fmtInt(v)}${NBSP}% · ${w}`, sub: "sobe mais do que avança", sr: `${sobe} Sobe mais do que avança. ${F}` };
  return { ...l, main: `${fmtInt(v)}${NBSP}% · ${w}`, sub: `sobe ${fmtInt(v)}${NBSP}m em 100${NBSP}m`, sr: `${sobe} ${F}` };
}

function virada(p: PointValues, tecnico: boolean): Linha {
  const key = "exposicao_graus", F = fonteFrase(key);
  const v = p.virada;
  const l = { label: "Virada a", src: aboutOf(key).fonte_curta, swatch: sw(v?.classe === 1 ? cor("exposicao_sol", 1) : undefined) };
  if (v === undefined) return naoLeu(l, "Para onde está virada a encosta");
  if (v === null) return { ...l, main: "nenhum lado", sub: "terreno plano", sr: `Aqui o terreno é plano: não está virado para nenhum lado. ${F}` };
  const r = rumo(v.graus), tec = tecnico ? `${v.graus}°` : undefined;
  if (v.classe === 1 && SOL_TARDE.has(r)) {
    return { ...l, main: r, sub: "sol à tarde", tec, sr: `Encosta virada a ${r}. Apanha sol à tarde, a hora mais quente. O mato seca mais. ${F}` };
  }
  if (v.classe === 1) return { ...l, main: r, sub: "ao sol", tec, sr: `Encosta virada a ${r}. Apanha muito sol. O mato seca mais. ${F}` };
  // classe "menos sol" na metade de sudeste ou de poente que fica fora de «de sudeste a poente» (ver FORA_DO_SOL)
  const viz = FORA_DO_SOL[r];
  if (viz) {
    return { ...l, main: r, sub: `menos sol, mais para ${viz}`, tec, sr: `Encosta virada a ${r}, mais para ${viz}. Apanha menos sol. ${F}` };
  }
  return { ...l, main: r, sub: "menos sol", tec, sr: `Encosta virada a ${r}. Apanha menos sol. ${F}` };
}

function mato(p: PointValues, tecnico: boolean): Linha {
  const key = "biomassa_t_ha", F = fonteFrase(key);
  const m = p.mato, max = T_HA_MAX;
  const l = { label: "Mato", src: aboutOf(key).fonte_curta, swatch: sw(cor("biomassa_2025", m?.classe)) };
  if (m === undefined) return naoLeu(l, "Mato");
  if (m === null) {
    const sem = { ...l, main: "sem estimativa" };
    if (p.vezes === 0) {
      return { ...sem, sub: `não ardeu de ${PERIODO_VIS}`, sr: `Não há estimativa de mato aqui. O cálculo usa o último fogo, e aqui não ardeu de ${A0} a ${A1}. ${F}` };
    }
    if (p.ultimoAno === A1) return { ...sem, sub: `ardeu em ${A1}`, sr: `Não há estimativa de mato aqui. Ardeu em ${A1}, o último ano destes dados. ${F}` };
    return { ...l, main: "sem dados", sr: `Mato: sem dados. ${F}` };
  }
  const t = m.tHa, w = MATO_WORDS[m.classe] ?? "";
  const tec = tecnico ? `${t.toFixed(2).replace(".", ",")}${NBSP}t/ha` : undefined;
  const est = "É uma estimativa, feita com os anos sem arder.";
  if (t >= max) {
    return { ...l, main: w, tec, sub: `cerca de ${max}${NBSP}t/ha, o máximo`, sr: `Mato: ${w}. Cerca de ${srInt(max)} toneladas por hectare, o máximo. ${est} ${F}` };
  }
  if (t < 1) {
    return { ...l, main: w, tec, sub: `menos de 1${NBSP}t/ha (máximo ${max})`, sr: `Mato: ${w}. Menos de 1 tonelada por hectare. O máximo é ${srInt(max)}. ${est} ${F}` };
  }
  const n = Math.round(t);
  return {
    ...l, main: w, tec,
    sub: `cerca de ${fmtInt(n)}${NBSP}t/ha (máximo ${max})`,
    sr: `Mato: ${w}. Cerca de ${srInt(n)} ${n === 1 ? "tonelada" : "toneladas"} por hectare. O máximo é ${srInt(max)}. ${est} ${F}`,
  };
}

function altitude(p: PointValues, tecnico: boolean): Linha {
  const key = "mdt", F = fonteFrase(key);
  const a0 = p.altitude;
  const l = { label: "Altitude", src: aboutOf(key).fonte_curta, swatch: null };
  if (a0 === undefined) return naoLeu(l, "Altitude");
  if (a0 === null) return { ...l, main: "sem dados", sr: `Altitude: sem dados. ${F}` };
  const a = altitude5(a0.m), d = a - CONCELHO.resumo.altitude_m.rio;
  const main = `cerca de ${fmtInt(a)}${NBSP}m`;
  if (a0.fonte === "mapa3d") {
    return {
      ...l, src: "mapa 3D", main, sub: "medida no mapa 3D",
      tec: tecnico ? `mapa 3D ${a0.m}${NBSP}m` : undefined,
      sr: `Altitude: cerca de ${srInt(a)} metros acima do nível do mar, medida no mapa 3D.`,
    };
  }
  const tec = tecnico ? `MDT ${a0.m}${NBSP}m` : undefined;
  const nivel = `Altitude: cerca de ${srInt(a)} metros acima do nível do mar.`;
  if (d >= 10) {
    return { ...l, main, tec, sub: `${fmtInt(d)}${NBSP}m acima do rio Douro`, sr: `${nivel} São cerca de ${srInt(d)} metros acima do rio Douro. ${F}` };
  }
  return { ...l, main, tec, sub: "à altura do rio Douro", sr: `${nivel} Fica à altura do rio Douro. ${F}` };
}

function tabela(p: PointValues, o: { visibleMap: string | null; tecnico: boolean }): string {
  const linhas: Linha[] = [escala("risco_2025", { label: "Risco" }, "Risco de fogo", p.risco, estudoSem("Risco de fogo"))];
  if (o.visibleMap === "perigosidade_2025") {
    linhas.push(escala("perigosidade_2025", { label: "Perigo" }, "Perigo de fogo", p.perigo, estudoSem("Perigo de fogo")));
  }
  const tec2030 = o.tecnico ? `${aboutOf("icnf_estrutural").ano}: ${p.icnf2030 ?? "–"}` : undefined;
  linhas.push(escala("icnf_conjuntural", { label: "Perigo oficial" }, "Perigo oficial", p.icnf, oficialSem, tec2030));
  if (o.visibleMap === "icnf_estrutural") {
    linhas.push(escala("icnf_estrutural", { label: "Perigo oficial" }, "Perigo oficial", p.icnf2030, oficialSem));
  }
  linhas.push(jaArdeu(p), encosta(p), virada(p, o.tecnico), mato(p, o.tecnico), altitude(p, o.tecnico));
  return (
    `<table class="probe-table point"><caption class="sr-only">Dados deste ponto</caption><tbody>${linhas.map(linhaHtml).join("")}</tbody></table>` +
    `<p class="sr-only">Os outros dados vêm do estudo DouroRisk.</p>`
  );
}

function rodape(p: PointValues, tecnico: boolean): string {
  const f4 = (v: number) => Math.abs(v).toFixed(4).replace(".", ",");
  const cel = tecnico && p.cell ? ` · célula g25 ${p.cell.col}, ${p.cell.row}` : "";
  return `<p class="probe-foot"><span aria-hidden="true">${f4(p.lat)}° N, ${f4(p.lon)}° O</span><span class="sr-only">Coordenadas: ${f4(p.lat)} graus norte, ${f4(p.lon)} graus oeste.</span>${cel}</p>`;
}

const FORA = `<p class="probe-out">Este ponto fica fora do concelho de Alijó. Aqui só mostramos dados do concelho.</p>`;
const RIO = `<p class="probe-out">Este ponto fica no rio Douro. A água não arde. Toca em terra para ver os dados.</p>`;

/** Ficha de um ponto: a cabeça, e depois a mensagem (não leu, fora, rio) ou a tabela e o rodapé. */
export function fichaHtml(p: PointValues, o: { freguesia: string | null; visibleMap: string | null; tecnico: boolean }): string {
  const head = `<p class="probe-head"><strong>Ponto</strong>${o.freguesia ? ` · ${esc(o.freguesia)}` : ""}</p>`;
  if (p.dentro === undefined) return `${head}<p class="probe-out">Não foi possível ler os dados. Tenta outra vez.</p>`;
  if (p.cell === null) return head + FORA;
  // o meio do Douro fica fora do limite do concelho: a frase do rio é a verdadeira e a mais útil
  if (p.rio === true) {
    if (!o.tecnico) return head + RIO;
    return `${head}${RIO}${tabela(p, o)}<p class="probe-foot">Os mapas dão valores também sobre a água; fora do modo técnico não os mostramos.</p>${rodape(p, true)}`;
  }
  if (p.dentro === false) return head + FORA;
  return `${head}${tabela(p, o)}${rodape(p, o.tecnico)}`;
}
