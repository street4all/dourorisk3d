// Camadas do Modo Visita: imagens com a escala segura para daltonismo,
// legendas por palavras e grelhas de classes para ler o valor num ponto.
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { ClassGrid, type Extent4326 } from "./sampler";

const EXT_10M_RISCO: Extent4326 = { xmin: -7.605246, ymin: 41.180072, xmax: -7.360933, ymax: 41.402264 };
const EXT_10M_PERIG: Extent4326 = { xmin: -7.605251, ymin: 41.180003, xmax: -7.360936, ymax: 41.402375 };
const EXT_25M: Extent4326 = { xmin: -7.61171, ymin: 41.177757, xmax: -7.355757, ymax: 41.405918 };
const A11Y = "/data/dourorisk/a11y";

export interface LegendItem {
  /** classes da grelha que caem neste item */
  classes: number[];
  color: string;
  label: string;
  /** número a mostrar na amostra (escalas de 1 a 5) */
  number?: number;
  /** quantas chamas desenhar (escalas de perigo) */
  flames?: number;
}

export interface VisitLayer {
  key: string;
  title: string;
  /** frase curta para a legenda e para a leitura num ponto */
  question: string;
  legend: LegendItem[];
  grid: ClassGrid;
  /** texto quando o ponto não tem classe */
  empty: string;
  /** "Aqui …" para cada classe */
  describe: (cls: number) => string;
}

const RISK_COLORS = ["#036403", "#88B302", "#FFFE06", "#FE9900", "#DD2203"];
const RISK_WORDS = ["muito baixo", "baixo", "médio", "alto", "muito alto"];

function riskLegend(): LegendItem[] {
  return RISK_WORDS.map((w, i) => ({ classes: [i + 1], color: RISK_COLORS[i], label: w, number: i + 1, flames: i + 1 }));
}

function riskLayer(key: string, title: string, noun: string, image: string, classes: string, extent: Extent4326): VisitLayer {
  DOURORISK_MODELS[key] = { id: key, title, image, extent };
  return {
    key,
    title,
    question: `${noun[0].toUpperCase()}${noun.slice(1)} de fogo, de 1 a 5`,
    legend: riskLegend(),
    grid: new ClassGrid(classes, extent),
    empty: "Aqui não há dados.",
    describe: (c) => `Aqui o ${noun} de fogo é ${c}: ${RISK_WORDS[c - 1]}.`,
  };
}

export const VISIT_LAYERS: Record<string, VisitLayer> = {};

/** Substitui as imagens DouroRisk pelas versões acessíveis e junta as camadas novas. Chamar antes de inicializar a cena. */
export function applyAccessibleLayers(): void {
  const add = (l: VisitLayer) => (VISIT_LAYERS[l.key] = l);
  add(riskLayer("risco_2025", "Risco de fogo (tese, 2025)", "risco", `${A11Y}/risco_2025.png`, `${A11Y}/risco_2025_classes.png`, EXT_10M_RISCO));
  add(riskLayer("perigosidade_2025", "Perigo de fogo (tese, 2025)", "perigo", `${A11Y}/perigosidade_2025.png`, `${A11Y}/perigosidade_2025_classes.png`, EXT_10M_PERIG));
  add(riskLayer("icnf_conjuntural", "Perigo oficial ICNF (2025)", "perigo", `${A11Y}/icnf_conjuntural.png`, `${A11Y}/icnf_conjuntural_classes.png`, EXT_25M));
  add(riskLayer("icnf_estrutural", "Perigo oficial ICNF (2020–2030)", "perigo", `${A11Y}/icnf_estrutural.png`, `${A11Y}/icnf_estrutural_classes.png`, EXT_25M));

  DOURORISK_MODELS.recorrencia_a11y = { id: "recorrencia_a11y", title: "Quantas vezes ardeu (1990–2025)", image: `${A11Y}/recorrencia.png`, extent: EXT_25M };
  add({
    key: "recorrencia_a11y",
    title: "Quantas vezes ardeu (1990–2025)",
    question: "Quantas vezes ardeu, de 1990 a 2025",
    legend: [
      { classes: [1, 2], color: "#EFA650", label: "1 ou 2 vezes" },
      { classes: [3, 4], color: "#D0672A", label: "3 ou 4 vezes" },
      { classes: [5], color: "#47180D", label: "5 ou mais vezes" },
    ],
    grid: new ClassGrid(`${A11Y}/recorrencia_classes.png`, EXT_25M),
    empty: "Aqui não ardeu desde 1990.",
    describe: (c) => (c >= 5 ? "Aqui ardeu 5 ou mais vezes desde 1990." : `Aqui ardeu ${c} ${c === 1 ? "vez" : "vezes"} desde 1990.`),
  });

  DOURORISK_MODELS.declive_a11y = { id: "declive_a11y", title: "Encostas inclinadas", image: `${A11Y}/declive.png`, extent: EXT_25M };
  const DECL_WORDS = ["", "quase plana", "um pouco inclinada", "muito inclinada", "quase a pique"];
  add({
    key: "declive_a11y",
    title: "Encostas inclinadas",
    question: "Quanto sobe a encosta",
    legend: [
      { classes: [2], color: "#88B302", label: "um pouco inclinada" },
      { classes: [3], color: "#FE9900", label: "muito inclinada" },
      { classes: [4], color: "#DD2203", label: "quase a pique" },
    ],
    grid: new ClassGrid(`${A11Y}/declive_classes.png`, EXT_25M),
    empty: "Aqui não há dados.",
    describe: (c) => `Aqui a encosta é ${DECL_WORDS[c] || "quase plana"}.`,
  });

  DOURORISK_MODELS.exposicao_sol = { id: "exposicao_sol", title: "Encostas viradas ao sol", image: `${A11Y}/exposicao_sol.png`, extent: EXT_25M };
  add({
    key: "exposicao_sol",
    title: "Encostas viradas ao sol",
    question: "Encostas que apanham sol à tarde",
    legend: [{ classes: [1], color: "#EFA650", label: "virada ao sol (sul e poente)" }],
    grid: new ClassGrid(`${A11Y}/exposicao_sol_classes.png`, EXT_25M),
    empty: "Aqui não há dados.",
    describe: (c) =>
      c === 1
        ? "Aqui a encosta está virada ao sol: o mato fica mais seco."
        : c === 3
          ? "Aqui o terreno é plano."
          : "Aqui a encosta está virada para a sombra.",
  });

  const BIO_WORDS = ["muito pouco mato", "pouco mato", "algum mato", "muito mato", "mato muito denso"];
  add({
    key: "biomassa_2025",
    title: "Quanto mato há (2025)",
    question: "Quanto mato há para arder",
    legend: [
      { classes: [1], color: "#EDF8E9", label: BIO_WORDS[0] },
      { classes: [2], color: "#BAE4B3", label: BIO_WORDS[1] },
      { classes: [3], color: "#74C476", label: BIO_WORDS[2] },
      { classes: [4], color: "#31A354", label: BIO_WORDS[3] },
      { classes: [5], color: "#006D2C", label: BIO_WORDS[4] },
    ],
    grid: new ClassGrid(`${A11Y}/biomassa_classes.png`, EXT_25M),
    empty: "Aqui não há dados de mato.",
    describe: (c) => `Aqui há ${BIO_WORDS[c - 1] || "pouco mato"}.`,
  });
}

/** Desenha uma legenda acessível: amostra de cor + número + palavra (+ chamas). */
export function renderLegend(el: HTMLElement | null, key: string): void {
  if (!el) return;
  const layer = VISIT_LAYERS[key];
  if (!layer) {
    el.innerHTML = "";
    return;
  }
  const flame = `<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c-5 0-7-4-6-8 .5-3 3-4 3-8 3 2 4 4 3.5 7 1.5-1 2-2.5 2-4 3 2.5 4.5 6 3.5 9-.5 2.5-3 4-6 4z"/></svg>`;
  const rows = layer.legend
    .map((it) => {
      const num = it.number ? `<span class="sw-num">${it.number}</span>` : "";
      const fl = it.flames ? `<span class="flames" aria-hidden="true">${flame.repeat(it.flames)}</span>` : "";
      const dark = ["#036403", "#DD2203", "#006837", "#47180D", "#983519", "#006D2C", "#31A354"].includes(it.color);
      return `<li><span class="sw${dark ? " dark" : ""}" style="background:${it.color}">${num}</span><span class="lg-label">${it.label}</span>${fl}</li>`;
    })
    .join("");
  el.innerHTML = `<p class="lg-title">${layer.question}</p><ul>${rows}</ul>`;
}
