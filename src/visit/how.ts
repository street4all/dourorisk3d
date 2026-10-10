// «Como sabemos?»: de onde vem cada mapa, em Leitura Fácil (layers.<chave>.about do manifest, escrito e
// verificado por scripts/pro_to_web.py). Com ?tecnico junta o raster, a grelha, a codificação e o sha256.
import { GRID_MANIFEST, type LayerAbout, type LayerEncoding } from "../geo/grid";
import { esc, periodo } from "./words";

export interface HowGroup { keys: string[]; titulo?: string }

/** O que quer dizer «estudo», com «tese» explicada (Leitura Fácil). Nos Mapas só entra se algum mapa vem do estudo. */
export const INTRO_ESTUDO = ["\"Estudo\" quer dizer o estudo DouroRisk.", "É uma tese: um trabalho da universidade sobre o risco de fogo em Alijó."];

export const EDIFICIOS = { titulo: "Edifícios", fonte: "Microsoft, edifícios vistos por satélite (licença ODbL)",
  metodo: "Um programa de computador encontrou os edifícios nas imagens de satélite.",
  nota: "Pode faltar algum edifício. Também conta anexos e armazéns." };

/** A proveniência de uma camada do manifest. */
export function aboutOf(key: string): LayerAbout {
  const a = GRID_MANIFEST.layers[key]?.about;
  if (!a) throw new Error(`Camada "${key}" sem "about" em dourorisk-grids.json: corre scripts/pro_to_web.py`);
  return a;
}

/** Fonte para o leitor de ecrã: "estudo DouroRisk, 2025", "mapa oficial do ICNF, de 2020 a 2030", "terreno do estudo DouroRisk". */
export function fonteSr(key: string): string {
  const a = aboutOf(key);
  return a.fonte + (a.ano ? `, ${periodo(a.ano)}` : "");
}

const FORMATOS: Record<string, string> = { "png-l8": "PNG 8 bits", int16le: "Int16 LE" };

/** A codificação de uma camada em palavras (modo técnico). */
function encTxt(e: LayerEncoding | undefined, nClasses: number): string {
  if (!e) return "";
  const out = [FORMATOS[e.format] ?? e.format];
  if (e.lut) out.push(`tabela de ${e.lut.length} valores`);
  const scale = e.scale ?? 1, offset = e.offset ?? 0;
  if (scale !== 1 || offset !== 0) out.push(`valor × ${scale} + ${offset}`);
  for (const [k, t] of Object.entries(e.special ?? {})) out.push(`${k} = ${t}`);
  if (e.nodata != null && !(String(e.nodata) in (e.special ?? {}))) out.push(`${e.nodata} = sem dados`);
  if (e.unit) out.push(`unidade ${e.unit}`);
  if (nClasses) out.push(`${nClasses} classes`);
  return out.join("; ");
}

/** Linha técnica de uma camada: raster, grelha, codificação e sha256 (12 primeiros algarismos). */
function tecLine(key: string): string {
  const l = GRID_MANIFEST.layers[key];
  const g = GRID_MANIFEST.grids[l.grid];
  const sha = Object.entries(l.sha256 ?? {})
    // caminho a partir de /data/dourorisk/ (há recorrencia.png e biomassa.png em a11y/ e em valores/)
    .map(([f, h]) => `${esc(f.replace(/^\/data\/dourorisk\//, ""))} <code>${esc(h.slice(0, 12))}</code>`)
    .join("; ");
  return (
    `<p class="how-tec">Raster: <code>${esc(l.source ?? "")}</code>. Grelha <code>${esc(l.grid)}</code>: ` +
    `${g.width} × ${g.height} células de ${g.cell} m, EPSG:3763. Codificação: ${esc(encTxt(l.encoding, l.classes?.length ?? 0))}. ` +
    `sha256: ${sha}.</p>`
  );
}

/**
 * Título de uma entrada: cabeçalho de nível 3 (o cartão tem o h2), para o leitor de ecrã saltar de entrada
 * em entrada (tecla H). Um h3 não pode ir dentro de um dt; um span com role="heading" pode.
 */
const titulo = (t: string) => `<span role="heading" aria-level="3">${esc(t)}</span>`;

/** Frases diferentes, pela ordem em que aparecem. */
const distintas = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * Escreve o «Como sabemos?» em `el`: uma entrada (dt/dd) por grupo de camadas ou pelos edifícios.
 * Texto fixo, fora do aria-live: só se escreve quando os mapas mudam.
 */
export function renderHow(el: HTMLElement | null, grupos: (HowGroup | "edificios")[], o: { tecnico: boolean; intro: string[]; rodape: string }): void {
  if (!el) return;
  const entradas = grupos.map((g) => {
    if (g === "edificios") {
      const e = EDIFICIOS;
      return `<dt>${titulo(e.titulo)}</dt><dd><p>Fonte: ${esc(e.fonte)}.</p><p>${esc(e.metodo)}</p><p>${esc(e.nota)}</p></dd>`;
    }
    const abouts = g.keys.map(aboutOf);
    const a = abouts[0];
    const linhas = [`<p>Fonte: ${esc(a.fonte)}.</p>`];
    if (a.ano != null) linhas.push(`<p>${esc(a.ano.includes("–") ? `Período: ${periodo(a.ano)}.` : `Ano: ${a.ano}.`)}</p>`);
    linhas.push(`<p>Quadrados de ${a.resolucao_m} por ${a.resolucao_m} metros.</p>`);
    linhas.push(`<p>${esc(distintas(abouts.map((x) => x.metodo)).join(" "))}</p>`);
    const notas = distintas(abouts.map((x) => x.nota));
    if (notas.length) linhas.push(`<p>${esc(notas.join(" "))}</p>`);
    if (o.tecnico) linhas.push(...g.keys.map(tecLine));
    return `<dt>${titulo(g.titulo ?? a.titulo)}</dt><dd>${linhas.join("")}</dd>`;
  });
  el.innerHTML = `${o.intro.map((t) => `<p>${esc(t)}</p>`).join("")}<dl>${entradas.join("")}</dl><p class="how-foot">${esc(o.rodape)}</p>`;
}
