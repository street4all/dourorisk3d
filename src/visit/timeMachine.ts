// Máquina do tempo do passo 4 (janela #pop-tempo): o que ardeu em cada ano, de 1990 a 2025 (mapas anuais
// do ICNF, um bit por ano nos planos ardeu_*), e quanto mato haveria de 2025 a 2045 se nada voltasse a arder
// nem fosse limpo (tabela do mato do estudo, pelos anos desde o último fogo).
// O browser só pinta: os números dos textos, das barras e da tabela vêm de CONCELHO.tempo, contados por
// scripts/pro_to_web.py. Ao carregar, os planos são verificados contra a recorrência e o último ano do estudo;
// se não baterem certo, a máquina desliga-se em vez de mostrar dados errados.
import type EsriMap from "@arcgis/core/Map.js";
import { CanvasOverlay } from "./overlay";
import { GRID_MANIFEST, cellHa, gridFromManifest, indexOf } from "../geo/grid";
import { TEMPO, VALUES, classeMato, fogoPlanos, matoAosAnos, suposicaoMato, type FogoPlano } from "./values";
import { GridSizeError } from "./sampler";
import { BIO_COLORS, BIO_WORDS, legendHtml, type LegendItem } from "./layers";
import { A0, A1, CONCELHO, type TempoProjecao } from "../data/concelho";
import { campos, emCada10, fmtInt, srInt } from "../data/numeros";
import { INTRO_ESTUDO, renderHow } from "./how";
import { TECNICO } from "./tecnico";
import { esc } from "./words";

type Modo = "fogo" | "mato";
/** "vis" = o que se lê no ecrã (4 890); "sr" = para o leitor de ecrã (4890) */
type Fmt = "vis" | "sr";

const G25 = gridFromManifest("g25");
/** hectares de uma célula de 25 m (0,0625: as contagens são exatas) */
const HA = cellHa(G25);
/** ano = byte de ultimo_ano + 1989 (0 = nunca ardeu desde 1990) */
const UA_OFF = GRID_MANIFEST.layers.ultimo_ano?.encoding?.offset ?? 1989;
/** primeiro e último ano da estimativa do mato (2025 e 2045) */
const P0 = TEMPO.projecao[0].ano;
const P1 = TEMPO.projecao[TEMPO.projecao.length - 1].ano;
const ANOS = new Map(TEMPO.anos.map((a) => [a.ano, a] as const));
const PROJ = new Map(TEMPO.projecao.map((p) => [p.ano, p] as const));
const MATO = TEMPO.mato;
const ARDEU_HA = CONCELHO.resumo.ardeu_ha;
/** «muito mato, ou mais» = classes 4 e 5 */
const muito = (p: TempoProjecao): number => p.ha_classes[4] + p.ha_classes[5];
/** primeiro ano em que toda a área que já ardeu tem muito mato, ou mais (2038) */
const ANO_TOPO = TEMPO.projecao.find((p) => muito(p) === ARDEU_HA)?.ano ?? null;
const LISTA = new Intl.ListFormat("pt-PT", { type: "conjunction" });
const lista = (xs: readonly number[]): string => LISTA.format(xs.map(String));
/** anos sem número na tabela do mato («18») */
const SUP = lista(MATO.suposicao);
const minuscula = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const int = (n: number, f: Fmt): string => (f === "vis" ? fmtInt(n) : srInt(n));

const A_PREPARAR = "A preparar os mapas dos anos…";
const LER_FALHOU = "Não foi possível ler os mapas dos anos.";
const AVARIA = "Os mapas dos anos não batem certo com o estudo. A máquina do tempo fica desligada.";
/** um passo da reprodução (ms); a imagem anterior tem de estar pronta */
const PASSO_MS = 1500;

// ------------------------------------------------------------------ cores (RGBA num Uint32 do ImageData)
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function rgba(hex: string, a: number): number {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return (LE ? (a << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
const COR_ANO = rgba("#D0672A", 235);
const COR_ANO_RISCA = rgba("#47180D", 235);
const COR_ANTES = rgba("#F7D98A", 170);
const COR_MATO = BIO_COLORS.map((c, i) => rgba(c, [160, 185, 205, 225, 245][i]));
const COR_MATO_RISCA = rgba("#F7F3EA", 230);
/**
 * Pontos nas classes 4 e 5 («muito mato, ou mais»): a mensagem principal lê-se sem cor. Escuros sobre a
 * classe 4 e claros sobre a 5 (3:1 ou mais contra a cor da classe); null = classe sem pontos.
 */
const PONTO_MATO: readonly (string | null)[] = [null, null, null, "#00441B", "#C7E9C0"];
const COR_MATO_PONTO = PONTO_MATO.map((c, i) => (c ? rgba(c, 245) : COR_MATO[i]));

/**
 * Chama cb no próximo frame. Se o browser não der frames (página escondida, painel minimizado), chama-o
 * ao fim de 100 ms: um pedido nunca fica parado à espera de um frame que não vem.
 */
function proximoFrame(cb: () => void): void {
  let feito = false;
  const run = () => {
    if (feito) return;
    feito = true;
    cb();
  };
  requestAnimationFrame(run);
  window.setTimeout(run, 100);
}

/** quantos bits a 1 em cada byte */
const POP = Uint8Array.from({ length: 256 }, (_, b) => {
  let n = 0;
  for (let x = b; x; x >>= 1) n += x & 1;
  return n;
});

// ------------------------------------------------------------------ dados
/** Falha da verificação: os planos não batem certo com o estudo (não se tenta outra vez). */
class Avaria extends Error {}

interface Bit { p: number; m: number }

interface Dados {
  /** células do concelho */
  n: number;
  /** índice na grelha de cada célula do concelho */
  idx: Int32Array;
  /** byte de cada plano, por célula do concelho */
  planos: Uint8Array[];
  /** (primeiro ano com fogo − A0) + 1, ou 0 (nunca ardeu) */
  first: Uint8Array;
  /** byte de ultimo_ano, por célula do concelho */
  ua: Uint8Array;
  /**
   * bit 0: riscas do fogo ((linha+coluna)%6<2); bit 1: riscas claras do mato (diagonal contrária);
   * bit 2: pontos do mato (2×2 células em cada 6×6, sem tocar nas riscas claras)
   */
  riscas: Uint8Array;
  /** ano → plano e máscara do bit (de encoding.bits) */
  bit: Map<number, Bit>;
  /** ano de cada bit de cada plano (0 = bit sem ano) */
  anoDoBit: number[][];
  /** grelhas inteiras (só para ler num ponto e para a verificação) */
  conc: Uint8Array;
  rec: Uint8Array;
  uaFull: Uint8Array;
  full: Uint8Array[];
}

/** Ano de cada bit, pelo encoding.bits de cada plano (nunca pela conta 1990 + 8p). */
function lerBits(planos: readonly FogoPlano[]): { bit: Map<number, Bit>; anoDoBit: number[][] } {
  const bit = new Map<number, Bit>();
  const anoDoBit = planos.map((pl, p) => {
    if (pl.grid.geo.id !== G25.id) throw new Avaria(`${pl.key}: a grelha é ${pl.grid.geo.id}, devia ser ${G25.id}`);
    if (!pl.bits) throw new Avaria(`${pl.key}: falta encoding.bits`);
    const out = new Array<number>(8).fill(0);
    for (const [b, ano] of Object.entries(pl.bits)) {
      const k = Number(b);
      if (!Number.isInteger(k) || k < 0 || k > 7 || bit.has(ano)) throw new Avaria(`${pl.key}: bit ${b} (${ano}) inválido ou repetido`);
      bit.set(ano, { p, m: 1 << k });
      out[k] = ano;
    }
    return out;
  });
  for (let y = A0; y <= A1; y++) if (!bit.has(y)) throw new Avaria(`os planos não têm o ano ${y}`);
  return { bit, anoDoBit };
}

/**
 * Verificação ao carregar, célula a célula: no concelho, quantos anos com fogo = recorrência e o ano do bit
 * mais alto = último ano (ou os dois 0); fora do concelho, nenhum bit. null = tudo certo; senão, o motivo.
 */
function verificar(full: readonly Uint8Array[], anoDoBit: number[][], rec: Uint8Array, ua: Uint8Array, conc: Uint8Array): string | null {
  const n = conc.length;
  if ([...full, rec, ua].some((a) => a.length !== n)) return "as grelhas não têm todas o mesmo tamanho";
  const comAno = anoDoBit.map((anos) => anos.reduce((m, a, b) => (a ? m | (1 << b) : m), 0));
  for (let i = 0; i < n; i++) {
    if (conc[i] !== 1) {
      for (let p = 0; p < full.length; p++) if (full[p][i]) return `célula ${i}: há fogo fora do concelho (plano ${p})`;
      continue;
    }
    let pop = 0;
    let alto = 0;
    for (let p = 0; p < full.length; p++) {
      const v = full[p][i];
      if (!v) continue;
      if (v & ~comAno[p]) return `célula ${i}: o plano ${p} tem um bit sem ano`;
      pop += POP[v];
      for (let b = 0; b < 8; b++) if (v & (1 << b) && anoDoBit[p][b] > alto) alto = anoDoBit[p][b];
    }
    if (pop !== rec[i]) return `célula ${i}: ${pop} anos com fogo, a recorrência diz ${rec[i]}`;
    const u = ua[i] ? ua[i] + UA_OFF : 0;
    if (alto !== u) return `célula ${i}: último fogo ${alto || "nunca"}, o último ano diz ${u || "nunca"}`;
  }
  return null;
}

async function carregarDados(): Promise<Dados> {
  // um manifest sem as camadas dos planos é uma avaria (não se tenta outra vez), não uma falha de rede
  let planosFogo: FogoPlano[];
  try {
    planosFogo = fogoPlanos();
  } catch (e) {
    throw new Avaria(e instanceof Error ? e.message : String(e));
  }
  const grids = [VALUES.concelho, VALUES.recorrencia, VALUES.ultimoAno, ...planosFogo.map((p) => p.grid)];
  for (const g of grids) if (g.geo.id !== G25.id) throw new Avaria(`grelha ${g.geo.id}, devia ser ${G25.id}`);
  const lidas = await Promise.allSettled(grids.map((g) => g.load()));
  // uma imagem com outras dimensões não bate certo com o estudo: tentar outra vez não ajuda
  for (const r of lidas) if (r.status === "rejected" && r.reason instanceof GridSizeError) throw new Avaria(r.reason.message);
  if (lidas.some((r) => r.status === "rejected")) throw new Error(LER_FALHOU);
  const bytes = await Promise.all(grids.map((g) => g.bytes()));
  if (bytes.some((b) => !b)) throw new Error(LER_FALHOU);
  const [conc, rec, uaFull, ...full] = bytes as Uint8Array[];
  const { bit, anoDoBit } = lerBits(planosFogo);
  const erro = verificar(full, anoDoBit, rec, uaFull, conc);
  if (erro) throw new Avaria(erro);

  let n = 0;
  for (let i = 0; i < conc.length; i++) if (conc[i] === 1) n++;
  const idx = new Int32Array(n);
  const planos = full.map(() => new Uint8Array(n));
  const first = new Uint8Array(n);
  const ua = new Uint8Array(n);
  const riscas = new Uint8Array(n);
  const W = G25.width;
  const ordem = [...bit.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 0, k = 0; i < conc.length; i++) {
    if (conc[i] !== 1) continue;
    idx[k] = i;
    let algum = 0;
    for (let p = 0; p < full.length; p++) algum |= planos[p][k] = full[p][i];
    if (algum) {
      for (const [ano, b] of ordem) {
        if (full[b.p][i] & b.m) {
          first[k] = ano - A0 + 1;
          break;
        }
      }
    }
    ua[k] = uaFull[i];
    const row = (i / W) | 0, col = i - row * W;
    riscas[k] = ((row + col) % 6 < 2 ? 1 : 0) | ((((row - col) % 6) + 6) % 6 < 2 ? 2 : 0) | (row % 6 >= 3 && row % 6 < 5 && col % 6 < 2 ? 4 : 0);
    k++;
  }
  return { n, idx, planos, first, ua, riscas, bit, anoDoBit, conc, rec, uaFull, full };
}

// ------------------------------------------------------------------ textos (Leitura Fácil, 15 palavras por frase)
/** «cerca de 233 hectares», «cerca de 1 hectare», «menos de 1 hectare» */
function hectares(ha: number, f: Fmt): string {
  if (ha < 0.5) return "menos de 1 hectare";
  if (Math.round(ha) === 1) return "cerca de 1 hectare";
  return `cerca de ${int(ha, f)} hectares`;
}

/** «de 1990 a 2016», ou «em 1990» */
const desde = (ate: number): string => (ate === A0 ? `em ${A0}` : `de ${A0} a ${ate}`);

/** anos sem mapa de A0 até `ate` (hoje 1993 e 2007): aí não se pode dizer «não ardeu» */
const semMapaAte = (ate: number): number[] => TEMPO.anos_sem_mapa.filter((y) => y >= A0 && y <= ate);

/** «não ardeu de 1990 a 1992»; com um ano sem mapa no meio, «não há fogo nos mapas de 1990 a 2008» */
const semFogo = (ate: number): string => (semMapaAte(ate).length ? `não há fogo nos mapas ${desde(ate)}` : `não ardeu ${desde(ate)}`);

/**
 * «Em 1993 e 2007, o estudo não tem mapa do que ardeu.» (uma vez, na introdução do modo Fogo). O estudo
 * (o artigo) diz que não há cartografia desses anos na série que usou; o mapa do ICNF de 2007 tem fogo
 * perto do concelho, mas nenhum dentro dele: por isso a frase fala do estudo e não do ICNF.
 */
const SEM_MAPA_FRASE = TEMPO.anos_sem_mapa.length ? `Em ${lista(TEMPO.anos_sem_mapa)}, o estudo não tem mapa do que ardeu.` : null;

/** Frases do ano y no modo Fogo (a primeira é a «linha 1»). */
function textoFogo(y: number, f: Fmt): string[] {
  const a = ANOS.get(y)!;
  if (!a.mapa) return [`O estudo não tem mapa do que ardeu em ${y}.`, "Não quer dizer que não houve fogo."];
  const ha = a.ha ?? 0;
  if (ha === 0) return [`Em ${y} o mapa do ICNF não mostra fogo no concelho.`, "Fogos muito pequenos podem não estar no mapa."];
  const out = [
    ha < 0.5
      ? `Em ${y} ardeu menos de 1 hectare no concelho.`
      : Math.round(ha) === 1
        ? `Em ${y} ardeu cerca de 1 hectare no concelho.`
        : `Em ${y} arderam cerca de ${int(ha, f)} hectares no concelho.`,
    `É como ${campos(ha)[f]}.`,
  ];
  if (y === A0) {
    out.push(`O estudo começa em ${A0}. Não conta os fogos de antes.`);
    return out;
  }
  // com um ano sem mapa no período (1993), só se pode falar dos anos com mapa
  const D = semMapaAte(y - 1).length ? `${desde(y - 1)}, nos anos com mapa` : desde(y - 1);
  const ja = a.ha_ja_ardido ?? 0;
  const pct = (ja / ha) * 100;
  out.push(
    ja >= ha
      ? `Todos estes hectares já tinham ardido ${D}.`
      : pct >= 95
        ? `Destes hectares, quase todos já tinham ardido ${D}.`
        : pct >= 10
          ? `Destes hectares, ${minuscula(emCada10(pct).frase)} já tinham ardido ${D}.`
          : pct > 0
            ? `Destes hectares, menos de 1 em cada 10 já tinha ardido ${D}.`
            : `Nenhum destes hectares tinha ardido ${D}.`,
  );
  return out;
}

/** aria-valuetext do cursor no modo Fogo */
function valorFogo(y: number): string {
  const a = ANOS.get(y)!;
  if (!a.mapa) return `${y}: o estudo não tem mapa`;
  const ha = a.ha ?? 0;
  if (ha === 0) return `${y}: o mapa não mostra fogo`;
  if (ha < 0.5) return `${y}: ardeu menos de 1 hectare`;
  if (Math.round(ha) === 1) return `${y}: ardeu cerca de 1 hectare`;
  return `${y}: arderam cerca de ${srInt(ha)} hectares`;
}

/** Frases do ano p no modo Mato (a primeira é a «linha 1»). */
function textoMato(p: number, f: Fmt): string[] {
  const pr = PROJ.get(p)!;
  const h = muito(pr);
  const out = [
    // 2025 também é uma estimativa do estudo (não é uma medição): «o estudo estima», não «havia»
    p === P0
      ? `Em ${p}, o estudo estima muito mato, ou mais, em cerca de ${int(h, f)} hectares.`
      : `Em ${p} haveria muito mato, ou mais, em cerca de ${int(h, f)} hectares.`,
    `É como ${campos(h)[f]}.`,
  ];
  // a parte da área que tem conta (a que ardeu desde 1990): onde nunca ardeu, o estudo não faz a conta
  const pct = (h / ARDEU_HA) * 100;
  if (h < ARDEU_HA) {
    const verbo = p === P0 ? "têm, na estimativa do estudo," : "teriam";
    out.push(
      pct < 10
        ? `Dos sítios que arderam desde ${A0}, menos de 1 em cada 10 ${p === P0 ? "tem, na estimativa do estudo," : "teria"} muito mato, ou mais.`
        : `Dos sítios que arderam desde ${A0}, ${minuscula(emCada10(pct).frase)} ${verbo} muito mato, ou mais.`,
    );
  }
  const antes = PROJ.get(p - 1);
  if (p > P0 && antes) {
    const d = h - muito(antes);
    if (d >= 1) {
      out.push(`De ${p - 1} para ${p}, ${Math.round(d) === 1 ? "junta-se" : "juntam-se"} ${hectares(d, f)}. São sítios onde o último fogo foi em ${p - MATO.t_muito_mato}.`);
    }
  }
  if (h === ARDEU_HA) out.push(`Todos os sítios que arderam desde ${A0} teriam muito mato, ou mais.`);
  if (pr.ha_suposicao > 0) out.push(`As riscas claras marcam ${hectares(pr.ha_suposicao, f)} com ${SUP} anos sem fogo. Aí o estudo não tem número: é uma suposição.`);
  return out;
}

const valorMato = (p: number): string =>
  `${p}: ${p === P0 ? "o estudo estima" : "haveria"} muito mato, ou mais, em cerca de ${srInt(muito(PROJ.get(p)!))} hectares. Estimativa.`;

/** Parágrafo com o texto visível e, quando os números mudam, uma cópia para o leitor de ecrã. */
function par(vis: string, sr: string): string {
  return vis === sr ? `<p>${esc(vis)}</p>` : `<p><span aria-hidden="true">${esc(vis)}</span><span class="sr-only">${esc(sr)}</span></p>`;
}

/** Número de uma célula da tabela: «4 890» à vista, «4890» para o leitor de ecrã, «menos de 1». */
function num(x: number): string {
  if (x > 0 && x < 0.5) return "menos de 1";
  const v = fmtInt(x), s = srInt(x);
  return v === s ? v : `<span aria-hidden="true">${v}</span><span class="sr-only">${s}</span>`;
}

function legendaFogo(y: number): string {
  const a = ANOS.get(y)!;
  const itens: LegendItem[] = [];
  // só aparece quando há essa cor no mapa (num ano com 0 ha não há)
  if (a.mapa && (a.ha ?? 0) > 0) itens.push({ classes: [], color: "#D0672A", label: `Ardeu em ${y}`, pattern: "striped", stripe: "rgba(71, 24, 13, 0.92)" });
  if (y > A0) itens.push({ classes: [], color: "#F7D98A", label: `Ardeu antes, ${desde(y - 1)}` });
  const ate = a.mapa ? y : y - 1;
  itens.push({ classes: [], color: "", label: `Sem cor: ${semFogo(ate)}`, pattern: "none" });
  return legendHtml(`No mapa, em ${y}:`, itens);
}

function legendaMato(p: number): string {
  const pr = PROJ.get(p)!;
  // as classes 4 e 5 («muito mato, ou mais») têm pontos, como no mapa
  const itens: LegendItem[] = BIO_WORDS.map((w, i) => ({
    classes: [i + 1],
    color: BIO_COLORS[i],
    label: PONTO_MATO[i] ? `${w}, com pontos` : w,
    number: i + 1,
    ...(PONTO_MATO[i] ? { dots: PONTO_MATO[i]! } : {}),
  }));
  if (pr.ha_suposicao > 0) {
    itens.push({ classes: [4], color: BIO_COLORS[3], label: `Riscas claras: suposição (${SUP} anos sem fogo)`, pattern: "striped-light", dots: PONTO_MATO[3] ?? undefined });
  }
  itens.push({ classes: [0], color: "", label: `Sem cor: não há fogo nos mapas desde ${A0}. O estudo não faz a conta.`, pattern: "none" });
  if (p === P0) itens.push({ classes: [0], color: "", label: `Também sem cor: ardeu em ${A1}.`, pattern: "none" });
  return legendHtml(`No mapa, em ${p} (estimativa):`, itens);
}

/** O que diz um ponto do mapa no ano escolhido (célula exata, sem raio). */
function lerFogo(d: Dados, i: number, y: number): string {
  const antes: number[] = [];
  for (let a = A0; a < y; a++) {
    const b = d.bit.get(a)!;
    if (d.full[b.p][i] & b.m) antes.push(a);
  }
  const b = d.bit.get(y)!;
  const aqui = (d.full[b.p][i] & b.m) !== 0;
  const prev = (inicio: string): string =>
    antes.length > 4 ? `${inicio} ${antes.length} vezes. A última foi em ${antes[antes.length - 1]}.` : `${inicio} em ${lista(antes)}.`;
  if (!ANOS.get(y)!.mapa) return `O estudo não tem mapa dos fogos de ${y}. ${antes.length ? prev("Antes, ardeu") : `Aqui ${semFogo(y - 1)}.`}`;
  if (aqui) {
    if (y === A0) return `Aqui ardeu em ${y}.`;
    if (antes.length) return `Aqui ardeu em ${y}. ${prev("Antes, já tinha ardido")}`;
    // com um ano sem mapa no meio, «a primeira vez» só se pode dizer dos mapas
    return `Aqui ardeu em ${y}. ${semMapaAte(y - 1).length ? "Nos mapas, foi" : "Foi"} a primeira vez desde ${A0}.`;
  }
  if (antes.length) return `Aqui não ardeu em ${y}. ${prev("Antes, já tinha ardido")}`;
  return `Aqui ${semFogo(y)}.`;
}

function lerMato(d: Dados, i: number, p: number): string {
  const u = d.uaFull[i];
  const L = u ? u + UA_OFF : 0;
  if (!L) return `Aqui não há fogo nos mapas desde ${A0}. O estudo não faz a conta do mato.`;
  const t = p - L;
  if (t <= 0) return `Aqui ardeu em ${L}. O estudo ainda não tem número.`;
  // 2025 também é uma estimativa do estudo (não é uma medição)
  const verbo = p === P0 ? "o estudo estima aqui" : "aqui haveria";
  if (suposicaoMato(t)) return `Em ${p}, ${verbo} muito mato, ou mais. O estudo não tem número para ${t} anos sem fogo. O último fogo foi em ${L}.`;
  const palavra = BIO_WORDS[classeMato(t) - 1];
  // a partir de 19 anos sem fogo, o estudo dá um valor fixo (40): não sai da conta dos outros anos
  if (t >= MATO.teto_desde) return `Em ${p}, ${verbo} ${palavra}. O estudo dá o seu valor mais alto: ${MATO.teto} toneladas por hectare. O último fogo foi em ${L}.`;
  const v = matoAosAnos(t) ?? 0;
  const tha = v < 0.5 ? "menos de 1 tonelada por hectare" : Math.round(v) === 1 ? "cerca de 1 tonelada por hectare" : `cerca de ${Math.round(v)} toneladas por hectare`;
  return `Em ${p}, ${verbo} ${palavra}: ${tha}. O último fogo foi em ${L}.`;
}

// ------------------------------------------------------------------ a máquina
export interface TimeHooks {
  /** mensagem curta na janela aberta (role=status) */
  say(msg: string): void;
}

interface Contagem {
  /** Fogo: [sem cor, ardeu no ano, ardeu antes]; Mato: células de cada classe (0 = sem conta) */
  celulas: number[];
  /** Mato: células às riscas claras (suposição) */
  suposicao: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

export class TimeMachine {
  private overlay: CanvasOverlay;
  private modo: Modo = "fogo";
  private anos: Record<Modo, number> = { fogo: A0, mato: P0 };
  private aberto = false;
  private ocupado = false;
  private d: Dados | null = null;
  private carga: Promise<Dados> | null = null;
  private avaria: string | null = null;
  /**
   * uma só imagem do tamanho da grelha, reaproveitada em cada desenho (o overlay copia-a para os blocos);
   * só se cria no primeiro desenho (quem nunca abre a máquina não gasta memória com ela)
   */
  private img: ImageData | null = null;
  private buf = new Uint32Array(0);
  /** há um desenho pedido para o próximo frame (os pedidos juntam-se num só) */
  private pendente = false;
  /** muda ao sair: os desenhos pedidos antes deixam de contar */
  private geracao = 0;
  private tPedido = 0;
  private tDesenho = 0;
  private medeSeq = 0;
  private ultimo: { modo: Modo; ano: number; ms: number; msImagem: number | null; contagem: Contagem } | null = null;
  private tocar = false;
  private tick: number | undefined;
  private barrasPendentes = false;
  private movimento = matchMedia("(prefers-reduced-motion: no-preference)");

  constructor(map: EsriMap, private hooks: TimeHooks) {
    this.overlay = new CanvasOverlay(map, "Máquina do tempo", G25, 0.85);
  }

  /** a camada da máquina está à vista (só com a janela aberta) */
  get visible(): boolean {
    return this.overlay.visible;
  }

  init(): void {
    const sub = (id: string, t: string) => {
      const el = $(id);
      if (el) el.textContent = t;
    };
    sub("time-sub-fogo", `de ${A0} a ${A1}`);
    sub("time-sub-mato", `de ${P0} a ${P1}`);
    document.querySelectorAll<HTMLButtonElement>("[data-time-mode]").forEach((b) =>
      b.addEventListener("click", () => this.setModo(b.dataset.timeMode as Modo)),
    );
    const range = $<HTMLInputElement>("time-range");
    range?.addEventListener("input", () => {
      this.stop();
      if (this.bloqueado()) {
        range.value = String(this.ano());
        return;
      }
      this.setAno(Number(range.value), false);
    });
    $("btn-time-prev")?.addEventListener("click", () => this.mover(-1));
    $("btn-time-next")?.addEventListener("click", () => this.mover(1));
    $("btn-time-play")?.addEventListener("click", () => this.alternarReproducao());
    $("btn-time-retry")?.addEventListener("click", () => {
      this.stop();
      void this.prepararDados().then(() => {
        // o botão «Tentar outra vez» some-se quando a leitura correu bem: o foco vai para o título do modo
        if (!this.d || !this.aberto) return;
        $("time-title")?.focus();
        this.hooks.say(this.linha1Sr());
      });
    });
    // abrir a tabela ou o «Como sabemos?» também é usar a janela: os anos param de passar
    document.querySelectorAll<HTMLElement>("#time-table > summary, #time-how > summary").forEach((s) => s.addEventListener("click", () => this.stop()));
    this.movimento.addEventListener("change", () => {
      // o botão «Parar» pode desaparecer com o foco: o foco passa para «Ano depois» antes de o esconder
      const play = $("btn-time-play");
      const tinhaFoco = !!play && document.activeElement === play;
      this.stop();
      this.renderMovimento();
      if (tinhaFoco && play?.hidden) $("btn-time-next")?.focus();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
    });
    const fig = $("time-bars");
    if (fig && "ResizeObserver" in window) new ResizeObserver(() => this.pedirBarras()).observe(fig);
    renderHow($("time-how-body"), [
      { keys: TEMPO.planos, titulo: "O que ardeu em cada ano" },
      { keys: ["ultimo_ano", "biomassa_t_ha"], about: MATO.about },
    ], {
      tecnico: TECNICO,
      intro: ["O ICNF é o instituto do Estado que cuida das florestas.", ...INTRO_ESTUDO],
      rodape: `Os fogos contados vão até ${A1}.`,
    });
    this.renderModo();
    // verificações só em desenvolvimento (o bloco desaparece do build de produção)
    if (import.meta.env.DEV) {
      /** Conta os 36 + 21 anos sem os pôr no mapa e compara com o manifest; também procura cor fora do concelho. */
      const verificarTudo = async (): Promise<{ anos: number; diferencas: number; foraPintado: number; detalhes: string[] }> => {
        const d = await this.dados();
        const detalhes: string[] = [];
        let anos = 0, foraPintado = 0;
        const igual = (a: number, b: number, o: string) => {
          if (Math.abs(a - b) > 1e-9) detalhes.push(`${o}: ${a} ≠ ${b}`);
        };
        const fora = () => {
          let n = 0;
          for (let i = 0; i < this.buf.length; i++) if (this.buf[i] && d.conc[i] !== 1) n++;
          return n;
        };
        for (let y = A0; y <= A1; y++, anos++) {
          const a = ANOS.get(y)!;
          const c = this.pintar("fogo", y);
          foraPintado += fora();
          igual(c.celulas[1] * HA, a.mapa ? (a.ha ?? 0) : 0, `fogo ${y} ardeu`);
          igual(c.celulas[2] * HA, y === A0 ? 0 : ANOS.get(y - 1)!.ha_ate - (a.ha_ja_ardido ?? 0), `fogo ${y} antes`);
        }
        for (let p = P0; p <= P1; p++, anos++) {
          const pr = PROJ.get(p)!;
          const c = this.pintar("mato", p);
          foraPintado += fora();
          c.celulas.forEach((n, k) => igual(n * HA, pr.ha_classes[k], `mato ${p} classe ${k}`));
          igual(c.suposicao * HA, pr.ha_suposicao, `mato ${p} suposição`);
          if (p === A1) c.celulas.forEach((n, k) => igual(n, CONCELHO.contagens.biomassa_2025?.contagem[k] ?? NaN, `mato ${p} = biomassa_2025 classe ${k}`));
        }
        if (foraPintado) detalhes.push(`${foraPintado} píxeis pintados fora do concelho`);
        // o ImageData foi usado para contar: volta a desenhar o ano escolhido
        this.pedirDesenho();
        return { anos, diferencas: detalhes.length, foraPintado, detalhes };
      };
      /** Corre a verificação ao carregar sobre uma cópia; com `estragar`, troca um bit de uma célula do concelho. */
      const verificarCarga = async (estragar: boolean): Promise<string | null> => {
        const d = await this.dados();
        const full = d.full.map((f) => f.slice());
        if (estragar) full[0][d.idx[0]] ^= 1;
        return verificar(full, d.anoDoBit, d.rec, d.uaFull, d.conc);
      };
      (window as any).__tempo = { estado: () => this.ultimo, verificarTudo, verificarCarga };
    }
  }

  /** A janela abriu: mostra o ano escolhido (lê os mapas na primeira vez). */
  async enter(): Promise<void> {
    if (!this.aberto) {
      this.aberto = true;
      this.renderModo();
    }
    await this.prepararDados();
  }

  /** A janela fechou (ou outro mapa passou a estar à vista): esconde a camada e pára os anos. */
  leave(): void {
    this.stop();
    this.aberto = false;
    this.geracao++;
    this.pendente = false;
    this.tPedido = 0;
    this.overlay.hide();
  }

  /** Pára a reprodução, sem dizer nada (outro controlo, janela escondida, aviso do quiosque). */
  stop(): void {
    this.pararReproducao(null);
  }

  /** Quiosque e novo palpite: a pessoa seguinte encontra a máquina como no início. */
  reset(): void {
    this.leave();
    this.modo = "fogo";
    this.anos = { fogo: A0, mato: P0 };
    this.ultimo = null;
    document.querySelectorAll<HTMLDetailsElement>("#time-table, #time-how").forEach((d) => (d.open = false));
    this.mostrarErro(null);
    this.renderModo();
    const txt = $("time-text");
    if (txt) txt.innerHTML = "";
    this.eco("time-msg", "");
    this.eco("time-answer", "");
    const st = $("pop-tempo")?.querySelector(".pop-status");
    if (st) st.textContent = "";
  }

  /** Lê já os mapas dos anos, sem pressa e sem falhar (depois de revelar onde ardeu). */
  preload(): void {
    if (!this.d && !this.avaria) this.dados().catch(() => undefined);
  }

  /**
   * Frase sobre o ponto (lon, lat) no ano e no modo escolhidos. Com a janela aberta, a frase fica também à vista
   * logo a seguir a «Ler o centro do mapa» (o leitor de ecrã ouve-a pela mensagem do topo).
   */
  async readAt(lon: number, lat: number): Promise<string> {
    this.stop();
    const msg = await this.lerPonto(lon, lat);
    if (this.aberto) this.eco("time-answer", msg, true);
    return msg;
  }

  private async lerPonto(lon: number, lat: number): Promise<string> {
    if (this.avaria) return AVARIA;
    // a leitura falhou: não se tenta outra vez às escondidas (é o «Tentar outra vez» que o faz)
    if (!this.d && !this.ocupado) return LER_FALHOU;
    let d: Dados;
    try {
      d = await this.dados();
    } catch {
      return this.avaria ? AVARIA : LER_FALHOU;
    }
    const i = indexOf(G25, lon, lat);
    if (i < 0 || d.conc[i] !== 1) return "Este sítio fica fora do concelho de Alijó.";
    return this.modo === "fogo" ? lerFogo(d, i, this.ano()) : lerMato(d, i, this.ano());
  }

  /**
   * Resposta à vista de quem vê o ecrã, junto do controlo que a pediu (a mensagem do topo pode estar fora da vista).
   * `mostrar`: traz a resposta para a vista dentro da janela (toque no mapa, «Ler o centro do mapa»).
   */
  private eco(id: "time-msg" | "time-answer", txt: string, mostrar = false): void {
    const el = $(id);
    if (!el) return;
    el.textContent = txt;
    if (!txt) return;
    // uma resposta à vista de cada vez: a outra era de outro pedido
    const outra = $(id === "time-msg" ? "time-answer" : "time-msg");
    if (outra) outra.textContent = "";
    if (mostrar) el.scrollIntoView({ block: "nearest" });
  }

  /** Resposta à vista junto de «Ler o centro do mapa» (por exemplo, quando o centro do ecrã não está no terreno). */
  mostrarResposta(msg: string): void {
    if (this.aberto) this.eco("time-answer", msg, true);
  }

  /** A mensagem do topo deixou de corresponder ao ecrã (o ano mudou sem anúncio): limpar uma zona aria-live não se ouve. */
  private limparMensagem(): void {
    const st = $("pop-tempo")?.querySelector(".pop-status");
    if (st) st.textContent = "";
  }

  /** Mensagem para o leitor de ecrã (topo da janela) e à vista logo a seguir aos botões dos anos. */
  private avisar(sr: string, vis = sr): void {
    this.hooks.say(sr);
    this.eco("time-msg", vis);
  }

  // ---------------------------------------------------------------- estado
  private ano(): number {
    return this.anos[this.modo];
  }

  private limites(modo: Modo = this.modo): [number, number] {
    return modo === "fogo" ? [A0, A1] : [P0, P1];
  }

  /** Sem os mapas dos anos (a ler, falhou a leitura ou a verificação), os controlos não fazem nada. */
  private bloqueado(): boolean {
    return !this.d;
  }

  /** Um controlo foi usado enquanto os mapas se preparam, depois de a leitura falhar ou com a máquina desligada. */
  private avisarBloqueio(): void {
    this.avisar(this.avaria ? AVARIA : this.ocupado ? A_PREPARAR : LER_FALHOU);
  }

  private dados(): Promise<Dados> {
    if (this.d) return Promise.resolve(this.d);
    if (!this.carga) {
      this.carga = carregarDados()
        .then((d) => (this.d = d))
        .catch((e: unknown) => {
          if (e instanceof Avaria) {
            if (!this.avaria) {
              this.avaria = e.message;
              console.error(`[máquina do tempo] ${e.message}`);
            }
          } else this.carga = null; // rede instável: pode tentar outra vez
          throw e;
        });
    }
    return this.carga;
  }

  private async prepararDados(): Promise<void> {
    if (!this.d && !this.avaria) {
      this.ocupado = true;
      this.atualizarControlos();
      if (this.aberto) this.hooks.say(A_PREPARAR);
      try {
        await this.dados();
      } catch {
        /* tratado abaixo */
      }
      this.ocupado = false;
    }
    // a legenda só aparece com o mapa desenhado; renderAno também acerta os controlos e limpa «A preparar…»
    this.renderAno();
    // a mensagem do topo (role=status) fica fora da zona com aria-busy: as falhas ouvem-se sempre
    if (this.avaria) {
      this.mostrarErro(AVARIA, false);
      this.overlay.hide();
      if (this.aberto) this.hooks.say(AVARIA);
    } else if (!this.d) {
      this.mostrarErro(LER_FALHOU, true);
      if (this.aberto) this.hooks.say(LER_FALHOU);
    } else {
      this.mostrarErro(null);
      this.pedirDesenho();
    }
  }

  private mostrarErro(msg: string | null, retry = false): void {
    const box = $("time-error");
    if (box) box.hidden = !msg;
    const t = $("time-error-text");
    if (t) t.textContent = msg ?? "";
    const b = $("btn-time-retry");
    if (b) b.hidden = !retry;
  }

  private setModo(m: Modo): void {
    this.stop();
    if (this.bloqueado()) {
      this.avisarBloqueio();
      return;
    }
    if (m !== this.modo) {
      this.modo = m;
      this.renderModo();
      this.pedirDesenho();
    }
    this.hooks.say(m === "fogo" ? `Agora vês o fogo, de ${A0} a ${A1}.` : `Agora vês o mato, de ${P0} a ${P1}. Não é uma previsão.`);
  }

  private setAno(y: number, anunciar: boolean): void {
    const [min, max] = this.limites();
    this.anos[this.modo] = Math.max(min, Math.min(max, Math.round(y)));
    this.renderAno();
    this.pedirDesenho();
    if (anunciar) this.hooks.say(this.linha1Sr());
  }

  private linha1Sr(): string {
    return this.linha1("sr");
  }

  private linha1(f: Fmt): string {
    return (this.modo === "fogo" ? textoFogo(this.ano(), f) : textoMato(this.ano(), f))[0];
  }

  private mover(dir: -1 | 1): void {
    this.stop();
    if (this.bloqueado()) {
      this.avisarBloqueio();
      return;
    }
    const [min, max] = this.limites();
    const y = this.ano() + dir;
    if (y < min || y > max) {
      this.avisar(
        this.modo === "fogo"
          ? dir < 0 ? `${A0} é o primeiro ano do estudo.` : `${A1} é o último ano do estudo.`
          : dir < 0 ? `${P0} é o primeiro ano da estimativa.` : `${P1} é o último ano da estimativa.`,
      );
      return;
    }
    this.setAno(y, true);
  }

  // ---------------------------------------------------------------- reprodução (só sem prefers-reduced-motion)
  private alternarReproducao(): void {
    if (this.tocar) {
      this.pararReproducao("botao");
      return;
    }
    if (this.bloqueado()) {
      this.avisarBloqueio();
      return;
    }
    if (!this.movimento.matches) return;
    const [min, max] = this.limites();
    this.tocar = true;
    this.renderMovimento();
    this.hooks.say("Os anos vão passar. Carrega em Parar para parar.");
    this.setAno(this.ano() >= max ? min : this.ano() + 1, false);
    this.agendar(PASSO_MS);
  }

  private agendar(ms: number): void {
    window.clearTimeout(this.tick);
    this.tick = window.setTimeout(() => this.passo(), ms);
  }

  /** Mais um ano, só quando a imagem anterior já está no mapa (nunca salta anos). */
  private passo(): void {
    if (!this.tocar) return;
    if (this.pendente || this.overlay.busy) {
      this.agendar(100);
      return;
    }
    if (this.ano() >= this.limites()[1]) {
      this.pararReproducao("fim");
      return;
    }
    this.setAno(this.ano() + 1, false);
    this.agendar(PASSO_MS);
  }

  private pararReproducao(motivo: "botao" | "fim" | null): void {
    if (!this.tocar) return;
    this.tocar = false;
    window.clearTimeout(this.tick);
    this.tick = undefined;
    this.renderMovimento();
    const ini = motivo === "botao" ? `Parou em ${this.ano()}.` : `Chegou a ${this.ano()}.`;
    if (motivo) this.avisar(`${ini} ${this.linha1("sr")}`, `${ini} ${this.linha1("vis")}`);
    // parou por outro controlo: «Os anos vão passar…» já não é verdade (esse controlo diz o que tem a dizer)
    else this.limparMensagem();
  }

  private renderMovimento(): void {
    const ok = this.movimento.matches;
    const b = $("btn-time-play");
    if (b) {
      b.hidden = !ok;
      b.textContent = this.tocar ? "Parar" : "Ver os anos a passar";
    }
    const hint = $("time-motion-hint");
    if (hint) hint.hidden = ok;
  }

  // ---------------------------------------------------------------- desenho no mapa
  /** Junta os pedidos num por frame; com uma imagem a preparar, desenha só o último quando ela estiver pronta. */
  private pedirDesenho(): void {
    if (!this.aberto || !this.d) return;
    if (!this.tPedido) this.tPedido = performance.now();
    if (!this.pendente) this.agendarFrame();
  }

  private agendarFrame(): void {
    this.pendente = true;
    const g = this.geracao;
    proximoFrame(() => {
      if (g === this.geracao) this.aoFrame();
    });
  }

  private aoFrame(): void {
    this.pendente = false;
    if (!this.aberto || !this.d) return;
    // a imagem anterior ainda não está no mapa: espera (sem fila; 3 s de segurança se a cena parar)
    if (this.overlay.busy && performance.now() - this.tDesenho < 3000) {
      this.agendarFrame();
      return;
    }
    const t0 = performance.now();
    const contagem = this.pintar(this.modo, this.ano());
    this.overlay.draw(this.img!);
    const ms = performance.now() - t0;
    this.tDesenho = performance.now();
    this.ultimo = { modo: this.modo, ano: this.ano(), ms, msImagem: null, contagem };
    const tp = this.tPedido;
    this.tPedido = 0;
    // quanto tempo até a imagem nova aparecer no mapa (desde o pedido)
    const seq = ++this.medeSeq;
    const medir = () => {
      if (seq !== this.medeSeq || !this.ultimo) return;
      if (this.overlay.busy) proximoFrame(medir);
      else this.ultimo.msImagem = performance.now() - tp;
    };
    proximoFrame(medir);
  }

  /** Pinta o ano no ImageData (só as células do concelho) e conta as células de cada estado ou classe. */
  private pintar(modo: Modo, ano: number): Contagem {
    const d = this.d!;
    if (!this.img) {
      this.img = new ImageData(G25.width, G25.height);
      this.buf = new Uint32Array(this.img.data.buffer);
    }
    const buf = this.buf;
    const { idx, riscas, n } = d;
    buf.fill(0);
    if (modo === "fogo") {
      const b = d.bit.get(ano)!;
      const pl = d.planos[b.p], m = b.m, lim = ano - A0, first = d.first;
      let ardeu = 0, antes = 0;
      for (let k = 0; k < n; k++) {
        if (pl[k] & m) {
          buf[idx[k]] = riscas[k] & 1 ? COR_ANO_RISCA : COR_ANO;
          ardeu++;
        } else {
          const f = first[k];
          if (f && f <= lim) {
            buf[idx[k]] = COR_ANTES;
            antes++;
          }
        }
      }
      return { celulas: [n - ardeu - antes, ardeu, antes], suposicao: 0 };
    }
    // mato: duas tabelas de cores (lisa e com riscas) pelo byte de ultimo_ano, refeitas para cada ano
    const nb = A1 - UA_OFF + 1;
    const lisa = new Uint32Array(nb), risca = new Uint32Array(nb), ponto = new Uint32Array(nb), cls = new Uint8Array(nb), sup = new Uint8Array(nb);
    for (let u = 1; u < nb; u++) {
      const t = ano - (u + UA_OFF);
      const c = classeMato(t);
      cls[u] = c;
      if (!c) continue;
      lisa[u] = COR_MATO[c - 1];
      ponto[u] = COR_MATO_PONTO[c - 1];
      sup[u] = suposicaoMato(t) ? 1 : 0;
      risca[u] = sup[u] ? COR_MATO_RISCA : lisa[u];
    }
    const ua = d.ua;
    const celulas = [0, 0, 0, 0, 0, 0];
    let suposicao = 0;
    for (let k = 0; k < n; k++) {
      const u = ua[k];
      const c = cls[u];
      celulas[c]++;
      if (!c) continue;
      suposicao += sup[u];
      const r = riscas[k];
      buf[idx[k]] = r & 2 ? risca[u] : r & 4 ? ponto[u] : lisa[u];
    }
    return { celulas, suposicao };
  }

  // ---------------------------------------------------------------- janela
  private atualizarControlos(): void {
    const off = this.bloqueado();
    const [min, max] = this.limites();
    const set = (el: Element | null, dis: boolean) => {
      if (!el) return;
      if (dis) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
    };
    document.querySelectorAll("[data-time-mode]").forEach((b) => set(b, off));
    ["time-range", "btn-time-play", "btn-time-read"].forEach((id) => set($(id), off));
    set($("btn-time-prev"), off || this.ano() <= min);
    set($("btn-time-next"), off || this.ano() >= max);
    // aria-busy só na zona dos controlos e do mapa: a mensagem do topo (role=status) fica fora e ouve-se
    const main = $("time-main");
    if (main) {
      if (this.ocupado) main.setAttribute("aria-busy", "true");
      else main.removeAttribute("aria-busy");
    }
  }

  /** O que muda com o modo: chips, título, introdução, aviso, cursor, tabela, fonte; e depois o ano. */
  private renderModo(): void {
    const fogo = this.modo === "fogo";
    document.querySelectorAll<HTMLButtonElement>("[data-time-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.timeMode === this.modo)));
    const set = (id: string, html: string) => {
      const el = $(id);
      if (el) el.innerHTML = html;
    };
    set("time-title", esc(fogo ? "O que ardeu em cada ano?" : "E se nada voltasse a arder e ninguém limpasse?"));
    set("time-intro", (fogo
      ? ["Muda o ano. O mapa mostra o que ardeu nesse ano.", ...(SEM_MAPA_FRASE ? [SEM_MAPA_FRASE] : [])]
      : ["Depois do fogo, o mato volta a crescer.", "O mapa mostra quanto mato haveria em cada ano.", "Mais mato quer dizer mais coisas para arder."]
    ).map((t) => `<p>${esc(t)}</p>`).join(""));
    const notice = $("time-notice");
    if (notice) {
      notice.hidden = fogo;
      notice.innerHTML = fogo
        ? ""
        : [
            "Não é uma previsão. É uma conta do estudo DouroRisk.",
            // o artigo deixou a tabela de fora: não foi possível confirmá-la em estudos revistos por outros cientistas
            "A conta usa uma tabela do mato que outros estudos ainda não confirmaram.",
            `Os mapas dos fogos só vão até ${A1}.`,
            `Os fogos depois de ${A1} não estão nas contas.`,
          ].map((t) => `<p>${esc(t)}</p>`).join("");
    }
    const range = $<HTMLInputElement>("time-range");
    if (range) {
      const [min, max] = this.limites();
      range.min = String(min);
      range.max = String(max);
    }
    set("time-source", esc(fogo ? `Fonte: mapas das áreas ardidas do ICNF, o instituto das florestas, de ${A0} a ${A1}. 1 hectare é um quadrado com 100 metros de lado.` : `Fonte: estudo DouroRisk. É uma estimativa feita com os fogos de ${A0} a ${A1}.`));
    this.renderLegendaBarras();
    this.renderTabela();
    this.renderTicks();
    this.renderMovimento();
    this.renderAno();
  }

  /** O que muda com o ano: ano grande, cursor, botões, texto, legenda, barras e linha da tabela. */
  private renderAno(): void {
    const y = this.ano();
    const fogo = this.modo === "fogo";
    const big = $("time-year");
    if (big) big.textContent = String(y);
    const range = $<HTMLInputElement>("time-range");
    if (range) {
      range.value = String(y);
      range.setAttribute("aria-valuetext", fogo ? valorFogo(y) : valorMato(y));
    }
    const vis = fogo ? textoFogo(y, "vis") : textoMato(y, "vis");
    const sr = fogo ? textoFogo(y, "sr") : textoMato(y, "sr");
    const txt = $("time-text");
    if (txt) txt.innerHTML = vis.map((v, i) => par(v, sr[i])).join("");
    const leg = $("time-legend");
    if (leg) {
      leg.innerHTML = fogo ? legendaFogo(y) : legendaMato(y);
      // sem os mapas dos anos não há cor no mapa: a legenda não descreve o que não está desenhado
      leg.hidden = !this.d;
    }
    // as respostas à vista e a mensagem do topo eram do ano anterior (a reprodução só fala ao começar e ao parar)
    this.eco("time-msg", "");
    this.eco("time-answer", "");
    if (!this.tocar) this.limparMensagem();
    document.querySelectorAll<HTMLTableRowElement>("#time-table-body tbody tr").forEach((tr) => {
      const on = Number(tr.dataset.ano) === y;
      tr.classList.toggle("sel", on);
      if (on) tr.setAttribute("aria-current", "true");
      else tr.removeAttribute("aria-current");
    });
    this.atualizarControlos();
    this.pedirBarras();
  }

  /** Série das barras: hectares por ano (null = sem mapa). */
  private serie(): { ano: number; v: number | null }[] {
    return this.modo === "fogo" ? TEMPO.anos.map((a) => ({ ano: a.ano, v: a.mapa ? a.ha : null })) : TEMPO.projecao.map((p) => ({ ano: p.ano, v: muito(p) }));
  }

  private renderLegendaBarras(): void {
    const cap = $("time-bars-cap");
    if (!cap) return;
    if (this.modo === "fogo") {
      const max = ANOS.get(TEMPO.ano_max)!.ha ?? 0;
      cap.innerHTML = [
        par("Hectares que arderam em cada ano, no concelho.", "Hectares que arderam em cada ano, no concelho."),
        par("Quanto mais alta a barra, mais ardeu.", "Quanto mais alta a barra, mais ardeu."),
        par(`O ano com mais fogo foi ${TEMPO.ano_max}: cerca de ${fmtInt(max)} hectares.`, `O ano com mais fogo foi ${TEMPO.ano_max}: cerca de ${srInt(max)} hectares.`),
        par("× quer dizer: o estudo não tem mapa desse ano.", "A cruz quer dizer: o estudo não tem mapa desse ano."),
      ].join("");
    } else {
      const s = TEMPO.salto;
      cap.innerHTML = [
        "Hectares que teriam muito mato, ou mais, em cada ano.",
        `A barra de ${s.ano} dá um salto: é onde o último fogo foi em ${s.ultimo_fogo}.`,
        ...(ANO_TOPO ? [`A partir de ${ANO_TOPO}, a barra já não sobe.`] : []),
        "Muito mato, ou mais, são as cores 4 e 5 do mapa, com pontos.",
      ].map((t) => `<p>${esc(t)}</p>`).join("");
    }
  }

  private renderTabela(): void {
    const el = $("time-table-body");
    if (!el) return;
    const th = (t: string) => `<th scope="col">${esc(t)}</th>`;
    if (this.modo === "fogo") {
      const rows = TEMPO.anos.map((a) =>
        `<tr data-ano="${a.ano}"><th scope="row">${a.ano}</th>` +
        (a.mapa
          ? `<td>${num(a.ha ?? 0)}</td>` +
            // antes do primeiro ano do estudo não há dados: «—», não «0»
            (a.ano === A0 ? `<td><span aria-hidden="true">—</span><span class="sr-only">sem dados antes de ${A0}</span></td>` : `<td>${num(a.ha_ja_ardido ?? 0)}</td>`)
          : `<td>o estudo não tem mapa</td><td><span aria-hidden="true">—</span><span class="sr-only">sem mapa</span></td>`) +
        `</tr>`,
      );
      el.innerHTML =
        `<table class="time-tab"><caption>O que ardeu em cada ano no concelho de Alijó, de ${A0} a ${A1}. Fonte: ICNF.</caption>` +
        `<thead><tr>${th("Ano")}${th("Arderam (hectares)")}${th("Destes, já tinham ardido antes (hectares)")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
    } else {
      const rows = TEMPO.projecao.map((p) => `<tr data-ano="${p.ano}"><th scope="row">${p.ano}</th><td>${num(muito(p))}</td><td>${num(p.ha_suposicao)}</td></tr>`);
      const semConta = PROJ.get(P0 + 1)?.ha_classes[0] ?? 0;
      el.innerHTML =
        `<table class="time-tab"><caption>Muito mato, ou mais, em cada ano, se nada voltasse a arder. Estimativa do estudo DouroRisk.</caption>` +
        `<thead><tr>${th("Ano")}${th("Muito mato, ou mais (hectares)")}${th("Destes, às riscas: suposição (hectares)")}</tr></thead><tbody>${rows.join("")}</tbody></table>` +
        `<p>${esc(`Onde não há fogo nos mapas desde ${A0}, o estudo não faz a conta.`)}</p>` +
        par(`São cerca de ${fmtInt(semConta)} hectares.`, `São cerca de ${srInt(semConta)} hectares.`) +
        `<p>${esc(`Em ${A1} também não faz a conta onde ardeu em ${A1}.`)}</p>`;
    }
  }

  /** Marcas dos anos por baixo do cursor: o primeiro, o último e as dezenas a 8 anos ou mais das pontas. */
  private renderTicks(): void {
    const el = $("time-ticks");
    if (!el) return;
    const [min, max] = this.limites();
    const anos = [min];
    for (let y = Math.ceil(min / 10) * 10; y <= max; y += 10) if (y - min >= 8 && max - y >= 8) anos.push(y);
    // sem nenhuma dezena longe das pontas (2025–2045), marca o meio arredondado a 5 (2035)
    const meio = Math.round((min + max) / 10) * 5;
    if (anos.length === 1 && meio - min >= 8 && max - meio >= 8) anos.push(meio);
    anos.push(max);
    el.innerHTML = anos.map((y) => `<span data-ano="${y}">${y}</span>`).join("");
    this.pedirBarras();
  }

  private pedirBarras(): void {
    if (this.barrasPendentes) return;
    this.barrasPendentes = true;
    proximoFrame(() => {
      this.barrasPendentes = false;
      this.desenharBarras();
    });
  }

  /**
   * Barras alinhadas com o cursor: o centro da barra do ano v fica em 14 + (v−min)/(max−min)·(W−28), o centro
   * do botão do cursor (28 px). O ano escolhido distingue-se pela forma (riscas, contorno, coluna, ▲, rótulo).
   */
  private desenharBarras(): void {
    const svg = $("time-bars-svg") as unknown as SVGSVGElement | null;
    const range = $<HTMLInputElement>("time-range");
    const label = $("time-bar-label");
    const plot = svg?.parentElement;
    if (!svg || !range || !label || !plot) return;
    const pw = plot.clientWidth, H = plot.clientHeight;
    const rr = range.getBoundingClientRect(), pr = plot.getBoundingClientRect();
    if (!pw || !H || !rr.width) return; // janela escondida: o ResizeObserver volta a pedir
    const W = rr.width, off = rr.left - pr.left;
    const [min, max] = this.limites();
    const serie = this.serie();
    const cx = (ano: number) => off + 14 + ((ano - min) / (max - min)) * (W - 28);
    const bw = Math.max(3, (0.7 * (W - 28)) / (serie.length - 1));
    const sel = this.ano();
    const selV = serie.find((s) => s.ano === sel)?.v ?? null;
    label.textContent = selV == null ? "sem mapa" : selV > 0 && selV < 0.5 ? "menos de 1 ha" : `${fmtInt(selV)} ha`;
    const lh = label.offsetHeight || 20;
    const top = lh + 4, yb = H - 16;
    const vmax = Math.max(1e-9, ...serie.map((s) => s.v ?? 0));
    const r = (x: number) => Math.round(x * 10) / 10;
    const out: string[] = [
      `<defs><pattern id="time-sel-riscas" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect class="sel-fundo" width="6" height="6"/><rect class="sel-risca" width="2.5" height="6"/></pattern></defs>`,
    ];
    const colW = Math.max(bw + 8, 12);
    out.push(`<rect class="col" x="${r(cx(sel) - colW / 2)}" y="0" width="${r(colW)}" height="${yb}"/>`);
    out.push(`<line class="base" x1="0" x2="${pw}" y1="${yb + 0.5}" y2="${yb + 0.5}"/>`);
    for (const s of serie) {
      const x = cx(s.ano);
      const on = s.ano === sel;
      if (s.v == null) {
        out.push(`<text class="nomap" x="${r(x)}" y="${yb - 3}" text-anchor="middle">×</text>`);
        continue;
      }
      if (s.v <= 0) continue;
      const h = Math.max(2, (s.v / vmax) * (yb - top));
      out.push(`<rect class="bar${on ? " sel" : ""}" x="${r(x - bw / 2)}" y="${r(yb - h)}" width="${r(bw)}" height="${r(h)}"/>`);
    }
    const xs = cx(sel);
    out.push(`<path class="tri" d="M${r(xs)} ${yb + 3}l6 10h-12z"/>`);
    svg.setAttribute("viewBox", `0 0 ${pw} ${H}`);
    svg.setAttribute("width", String(pw));
    svg.setAttribute("height", String(H));
    svg.innerHTML = out.join("");
    // rótulo por cima, preso dentro da figura
    const lw = label.offsetWidth;
    label.style.left = `${Math.max(0, Math.min(pw - lw, xs - lw / 2))}px`;
    // marcas dos anos, na mesma posição, presas dentro da figura; o traço (--dx) fica sempre no sítio exato do ano
    document.querySelectorAll<HTMLElement>("#time-ticks span").forEach((s) => {
      const w = s.offsetWidth, x = cx(Number(s.dataset.ano));
      const left = Math.max(w / 2, Math.min(pw - w / 2, x));
      s.style.left = `${left}px`;
      s.style.setProperty("--dx", `${r(x - left)}px`);
    });
  }
}
