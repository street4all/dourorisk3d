// Camadas do Modo Visita: imagens na paleta oficial (verde→vermelho nos mapas de risco, perigo e declive;
// a alternativa segura para daltonismo sai de scripts/pro_to_web.py --paleta segura e obriga a mudar as
// cores das legendas abaixo), legendas por palavras e grelhas de classes para ler o valor num ponto.
// Cada camada usa a grelha PT-TM06 que o manifest (src/data/dourorisk-grids.json) lhe atribui.
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { gridOfLayer } from "../geo/grid";
import { ClassGrid } from "./sampler";
import { DECL_WORDS, RISK_WORDS } from "./words";
import { aboutOf } from "./how";
import { A0, A1 } from "../data/concelho";

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

function riskLegend(): LegendItem[] {
  return RISK_WORDS.map((w, i) => ({ classes: [i + 1], color: RISK_COLORS[i], label: w, number: i + 1, flames: i + 1 }));
}

function riskLayer(key: string, title: string, noun: string, image: string, classes: string, quando = ""): VisitLayer {
  const grid = gridOfLayer(key);
  DOURORISK_MODELS[key] = { id: key, title, image, grid };
  return {
    key,
    title,
    // «quando» distingue as duas legendas do perigo oficial lado a lado na cortina
    question: `${noun[0].toUpperCase()}${noun.slice(1)} de fogo${quando ? ` (${quando})` : ""}, de 1 a 5`,
    legend: riskLegend(),
    grid: new ClassGrid(classes, grid),
    empty: "Aqui não há dados.",
    describe: (c) => `Aqui o ${noun} de fogo é ${c}: ${RISK_WORDS[c - 1]}.`,
  };
}

export const VISIT_LAYERS: Record<string, VisitLayer> = {};

/** Substitui as imagens DouroRisk pelas versões acessíveis e junta as camadas novas. Chamar antes de inicializar a cena. */
export function applyAccessibleLayers(): void {
  const add = (l: VisitLayer) => (VISIT_LAYERS[l.key] = l);
  add(riskLayer("risco_2025", `Risco de fogo (${aboutOf("risco_2025").fonte_curta})`, "risco", `${A11Y}/risco_2025.png`, `${A11Y}/risco_2025_classes.png`));
  add(riskLayer("perigosidade_2025", `Perigo de fogo (${aboutOf("perigosidade_2025").fonte_curta})`, "perigo", `${A11Y}/perigosidade_2025.png`, `${A11Y}/perigosidade_2025_classes.png`));
  // anos sem travessão («2020 a 2030»): a legenda é lida pelo leitor de ecrã
  const ano = (k: string) => (aboutOf(k).ano ?? "").replace("–", " a ");
  add(riskLayer("icnf_conjuntural", `Perigo oficial ICNF (${aboutOf("icnf_conjuntural").ano})`, "perigo oficial", `${A11Y}/icnf_conjuntural.png`, `${A11Y}/icnf_conjuntural_classes.png`, ano("icnf_conjuntural")));
  add(riskLayer("icnf_estrutural", `Perigo oficial ICNF (${aboutOf("icnf_estrutural").ano})`, "perigo oficial", `${A11Y}/icnf_estrutural.png`, `${A11Y}/icnf_estrutural_classes.png`, ano("icnf_estrutural")));

  const recGrid = gridOfLayer("recorrencia_a11y");
  const recTitle = `Quantas vezes ardeu (${A0}–${A1})`;
  DOURORISK_MODELS.recorrencia_a11y = { id: "recorrencia_a11y", title: recTitle, image: `${A11Y}/recorrencia.png`, grid: recGrid };
  add({
    key: "recorrencia_a11y",
    title: recTitle,
    question: `Quantas vezes ardeu, de ${A0} a ${A1}`,
    legend: [
      { classes: [1, 2], color: "#EFA650", label: "1 ou 2 vezes" },
      { classes: [3, 4], color: "#D0672A", label: "3 ou 4 vezes" },
      { classes: [5], color: "#47180D", label: "5 ou mais vezes" },
    ],
    grid: new ClassGrid(`${A11Y}/recorrencia_classes.png`, recGrid),
    empty: `Aqui não ardeu de ${A0} a ${A1}.`,
    describe: (c) => (c >= 5 ? `Aqui ardeu 5 ou mais vezes de ${A0} a ${A1}.` : `Aqui ardeu ${c} ${c === 1 ? "vez" : "vezes"} de ${A0} a ${A1}.`),
  });

  const decGrid = gridOfLayer("declive_a11y");
  DOURORISK_MODELS.declive_a11y = { id: "declive_a11y", title: "Encostas inclinadas", image: `${A11Y}/declive.png`, grid: decGrid };
  add({
    key: "declive_a11y",
    title: "Encostas inclinadas",
    question: "Quanto sobe a encosta",
    legend: [
      { classes: [2], color: "#88B302", label: DECL_WORDS[2] },
      { classes: [3], color: "#FE9900", label: DECL_WORDS[3] },
      { classes: [4], color: "#DD2203", label: DECL_WORDS[4] },
    ],
    grid: new ClassGrid(`${A11Y}/declive_classes.png`, decGrid),
    empty: "Aqui não há dados.",
    describe: (c) => `Aqui a encosta é ${DECL_WORDS[c] || "pouco inclinada"}.`,
  });

  const solGrid = gridOfLayer("exposicao_sol");
  DOURORISK_MODELS.exposicao_sol = { id: "exposicao_sol", title: "Encostas viradas ao sol", image: `${A11Y}/exposicao_sol.png`, grid: solGrid };
  add({
    key: "exposicao_sol",
    title: "Encostas viradas ao sol",
    question: "Encostas viradas ao sol",
    legend: [{ classes: [1], color: "#EFA650", label: "virada ao sol (de sudeste a poente)" }],
    grid: new ClassGrid(`${A11Y}/exposicao_sol_classes.png`, solGrid),
    empty: "Aqui não há dados.",
    describe: (c) =>
      c === 1
        ? "Aqui a encosta está virada ao sol: o mato fica mais seco."
        : c === 3
          ? "Aqui o terreno é plano."
          : "Aqui a encosta apanha menos sol.",
  });

  const BIO_WORDS = ["muito pouco mato", "pouco mato", "algum mato", "muito mato", "mato muito denso"];
  add({
    key: "biomassa_2025",
    title: `Quanto mato há (${aboutOf("biomassa_2025").ano})`,
    question: "Quanto mato há para arder",
    legend: [
      { classes: [1], color: "#EDF8E9", label: BIO_WORDS[0] },
      { classes: [2], color: "#BAE4B3", label: BIO_WORDS[1] },
      { classes: [3], color: "#74C476", label: BIO_WORDS[2] },
      { classes: [4], color: "#31A354", label: BIO_WORDS[3] },
      { classes: [5], color: "#006D2C", label: BIO_WORDS[4] },
    ],
    grid: new ClassGrid(`${A11Y}/biomassa_classes.png`, gridOfLayer("biomassa_2025")),
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
