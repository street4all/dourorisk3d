// Explorar: ler os dados de um ponto, de uma área em círculo, do concelho todo ou de uma ou várias freguesias,
// a qualquer momento da visita. No modo "Ponto ou círculo" o mesmo ponteiro serve para as duas coisas:
// tocar = ponto; carregar sem largar e arrastar = círculo. Arrastar sem carregar primeiro continua a mexer o mapa.
// No modo "Freguesias", tocar no mapa junta ou tira a freguesia desse sítio. Alternativas por teclado em todos.
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Circle from "@arcgis/core/geometry/Circle.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import type Geometry from "@arcgis/core/geometry/Geometry.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import type { Alijo3DManager } from "../alijo3d/alijoScene";
import { NBSP, area, campos, distancia, fmtInt, pctTxt, srInt } from "../data/numeros";
import { A0, A1, CONCELHO, concelhoHist } from "../data/concelho";
import { VISIT_LAYERS } from "./layers";
import { RISK_WORDS, esc, fonteCurtaHtml } from "./words";
import { maskOf } from "./sampler";
import { cellsInCircle, type GridGeo } from "../geo/grid";
import { VALUES, decode, preloadValues } from "./values";
import { fichaHtml, readPoint } from "./point";
import { INTRO_ESTUDO, aboutOf, fonteSr, renderHow, type HowGroup } from "./how";
import { TECNICO } from "./tecnico";

type Scope = "local" | "concelho" | "freguesias";
type Rings = number[][][];
type Histogram = { counts: number[]; total: number } | null;

interface Parish {
  id: string;
  name: string;
  short: string;
  rings: Rings;
}

const MIN_R = 25;
const MAX_R = 3000;
const PROBE_RGB: [number, number, number] = [0, 190, 255];

/** «Como sabemos?» do Explorar: todos os mapas da ficha, mais o rio, o limite e os edifícios. */
const EXPLORAR_HOW: (HowGroup | "edificios")[] = [
  { keys: ["risco_2025"] }, { keys: ["perigosidade_2025"] }, { keys: ["icnf_conjuntural"] }, { keys: ["icnf_estrutural"] },
  { keys: ["recorrencia_valor", "recorrencia_a11y", "ultimo_ano"], titulo: "Quantas vezes ardeu e último fogo" },
  { keys: ["declive_pct", "declive_a11y"] }, { keys: ["exposicao_graus", "exposicao_sol"] }, { keys: ["biomassa_t_ha", "biomassa_2025"] },
  { keys: ["mdt"] }, { keys: ["rio_douro_25m"] }, { keys: ["concelho_25m"] }, "edificios",
];

/** O que se sabe da área além das contagens de cada linha. */
interface AreaCtx {
  /** a área tem quadrados de rio (o mapa oficial não dá número ao rio) */
  rio: boolean;
}

interface Row {
  key: string;
  /** o que o número da área mede */
  label: string;
  /** classes que contam no número grande da linha (% da área) */
  hit: number[];
  /** a classe 0 quer dizer «sem valor»: a palavra visível (sem dados, sem número, sem estimativa) */
  sem?: string;
  /** frase completa para uma área (leitor de ecrã e dica ao passar o rato); frases de 15 palavras ou menos */
  area: (counts: number[], total: number, ctx: AreaCtx) => string;
}

/** Factos de uma área, por baixo das linhas: o último fogo e o máximo de vezes. */
interface Facts {
  /** "Neste círculo", "Nesta freguesia", "Nestas freguesias", "No concelho" */
  onde: string;
  /** ano do último fogo (null = não ardeu de A0 a A1) */
  ultimo: number | null;
  /** máximo de vezes que um sítio ardeu */
  max: number;
  concelho?: boolean;
}

const sum = (counts: number[], classes: number[]) => classes.reduce((s, c) => s + counts[c], 0);
/** a parte é de 1 % ou mais (só então se diz quanto ficou sem dados) */
const atLeast1 = (n: number, total: number) => total > 0 && n / total >= 0.01;
const CLASSES_1_5 = [1, 2, 3, 4, 5];
/** Maiúscula no início da frase («menos de 1» -> «Menos de 1»). */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Escalas de 1 a 5: a classe mais comum, a parte alta e quanto ficou sem valor (a partir de 1 %). */
function escalaArea(counts: number[], total: number, o: { mais: string; todo: string; parte: (p: string) => string }): string {
  const inside = sum(counts, CLASSES_1_5);
  if (!inside) return o.todo;
  let best = 1;
  for (let c = 2; c <= 5; c++) if (counts[c] > counts[best]) best = c;
  const frases = [`${o.mais} ${best}, ${RISK_WORDS[best - 1]}.`, `Alto ou muito alto: ${pctTxt(sum(counts, [4, 5]), total)} por cento da área.`];
  const missing = total - inside;
  if (atLeast1(missing, total)) frases.push(o.parte(pctTxt(missing, total)));
  return frases.join(" ");
}

/** «São, por exemplo, zonas com casas e o rio.»: o rio só quando a área o tem. */
const semNumeroExemplo = (ctx: AreaCtx) => `São, por exemplo, zonas com casas${ctx.rio ? " e o rio" : ""}.`;
const semMatoPorque = () => `Ali não ardeu de ${A0} a ${A1}, ou ardeu em ${A1}.`;

const ROWS: Row[] = [
  {
    key: "risco_2025", label: "Risco alto", hit: [4, 5], sem: "sem dados",
    area: (c, t) =>
      escalaArea(c, t, { mais: "O risco mais comum é", todo: "O estudo não tem valor de risco para esta área.", parte: (p) => `Sem dados: ${p} por cento.` }),
  },
  {
    key: "icnf_conjuntural", label: "Perigo oficial alto", hit: [4, 5], sem: "sem número",
    area: (c, t, ctx) =>
      escalaArea(c, t, {
        mais: `No mapa oficial de ${aboutOf("icnf_conjuntural").ano}, o perigo mais comum é`,
        todo: `O mapa oficial não dá número a esta área. ${semNumeroExemplo(ctx)}`,
        parte: (p) => `Sem número no mapa oficial: ${p} por cento. ${semNumeroExemplo(ctx)}`,
      }),
  },
  {
    key: "recorrencia_a11y", label: "Já ardeu", hit: CLASSES_1_5,
    // as frases começam pelo número: o leitor de ecrã já leu o nome da linha e não o repete
    area: (c, t) => {
      const burned = sum(c, CLASSES_1_5);
      return burned ? `${cap(pctTxt(burned, t))} por cento da área já ardeu, de ${A0} a ${A1}.` : `Não ardeu de ${A0} a ${A1}.`;
    },
  },
  {
    key: "declive_a11y", label: "Muito inclinada", hit: [3, 4],
    area: (c, t) => `${cap(pctTxt(sum(c, [3, 4]), t))} por cento da área é muito inclinada ou muito íngreme.`,
  },
  {
    key: "exposicao_sol", label: "Virada ao sol", hit: [1],
    area: (c, t) => `${cap(pctTxt(c[1], t))} por cento da área está virada ao sol. Nas encostas ao sol, o mato seca mais.`,
  },
  {
    key: "biomassa_2025", label: "Muito mato", hit: [4, 5], sem: "sem estimativa",
    area: (c, t) => {
      if (!sum(c, CLASSES_1_5)) return `Não há estimativa de mato nesta área. ${semMatoPorque()}`;
      const muito = `${cap(pctTxt(sum(c, [4, 5]), t))} por cento da área tem muito mato ou mato muito denso.`;
      return atLeast1(c[0], t) ? `${muito} Sem estimativa de mato: ${pctTxt(c[0], t)} por cento. ${semMatoPorque()}` : muito;
    },
  },
];

/** Factos de uma área a partir dos histogramas de "quantas vezes ardeu" e "último ano" (valores exatos). */
function factsFrom(onde: string, rec: Histogram, ua: Histogram): Facts | null {
  if (!rec || !ua) return null;
  let max = 0, ultimo: number | null = null;
  for (let i = 0; i < 255; i++) {
    if (rec.counts[i] > 0) max = i;
    if (ua.counts[i] > 0) ultimo = decode("ultimo_ano", i) ?? ultimo;
  }
  return { onde, ultimo, max };
}

function factsHtml(f: Facts | null): string {
  if (!f) return "";
  const items = [
    f.ultimo != null ? `<li>${f.onde}, a última vez que ardeu foi em ${f.ultimo}.</li>` : `<li>${f.onde} não ardeu de ${A0} a ${A1}.</li>`,
  ];
  if (f.max >= 2) items.push(`<li>Houve sítios que arderam ${f.max} vezes.</li>`);
  else if (f.max === 1) items.push(`<li>Cada sítio ardeu no máximo 1 vez.</li>`);
  if (f.concelho) {
    // o mínimo do terreno (45 m) é uma cova na foz do Tua, não o rio: nunca se mostra
    const alt = CONCELHO.resumo.altitude_m;
    items.push(`<li>Do rio Douro (cerca de ${fmtInt(alt.rio)} metros) ao ponto mais alto (${fmtInt(alt.max)} metros).</li>`);
  }
  return `<ul class="probe-facts">${items.join("")}</ul>`;
}

/** Área e campos de futebol (visível e leitor de ecrã), e os edifícios se os houver. */
function sizeHtml(ha: number, buildings: number | null): string {
  const a = area(ha), c = campos(ha);
  const e = buildings == null
    ? { vis: "", sr: "" }
    : { vis: ` · ${fmtInt(buildings)} ${buildings === 1 ? "edifício" : "edifícios"}`, sr: ` ${srInt(buildings)} ${buildings === 1 ? "edifício" : "edifícios"}.` };
  return `<span aria-hidden="true">${a.vis}, ${c.vis}${e.vis}</span><span class="sr-only"> ${a.sr}, ${c.sr}.${e.sr}</span>`;
}

function targetSvg(): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><circle cx='32' cy='32' r='22' fill='none' stroke='#121417' stroke-width='9'/><circle cx='32' cy='32' r='22' fill='none' stroke='#00beff' stroke-width='5'/><circle cx='32' cy='32' r='6' fill='#00beff' stroke='#121417' stroke-width='3'/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Ponto dentro de um polígono com buracos (regra par-ímpar sobre todos os anéis). */
function inRings(lon: number, lat: number, rings: Rings): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const $ = (id: string) => document.getElementById(id);
const NAO_LEU = `<p class="probe-out">Não foi possível ler os dados. Tenta outra vez.</p>`;

export class Probe {
  active = false;
  private layer = new GraphicsLayer({ title: "Explorar", listMode: "hide" });
  private scope: Scope = "local";
  /** raio escolhido nos botões (0 = ponto) */
  private chipRadius = 0;
  private sel: { lon: number; lat: number; r: number } | null = null;
  private holding: { lon: number; lat: number; r: number } | null = null;
  private seq = 0;
  private uiRight = 16;
  private holdEndedAt = 0;
  private concelho: Rings | null = null;
  private parishes: Parish[] = [];
  private picked = new Set<string>();
  private boundaries: Promise<void> | null = null;
  private housesByParish: Promise<Map<string, number> | null> | null = null;

  constructor(
    private manager: Alijo3DManager,
    /** a visita fecha a janela aberta em ecrãs estreitos, para o cartão caber */
    private onToggle: (on: boolean) => void,
    /** mapa DouroRisk à vista (a ficha junta a linha desse mapa quando não está nas linhas fixas) */
    private visibleMap: () => string | null = () => null,
  ) {}

  init(): void {
    const view = this.manager.view;
    if (!view) return;
    view.map!.add(this.layer);
    // «Como sabemos?»: texto fixo, escrito uma vez, fora do aria-live
    renderHow($("probe-how-body"), EXPLORAR_HOW, {
      tecnico: TECNICO,
      intro: ["Cada linha da ficha vem de um mapa.", ...INTRO_ESTUDO],
      rodape: `Cada valor vale para um quadrado inteiro do mapa, não só para o ponto. Os fogos contados vão até ${A1}.`,
    });
    $("btn-probe")?.addEventListener("click", () => this.setActive(!this.active));
    $("probe-close")?.addEventListener("click", () => this.setActive(false));
    $("probe-center")?.addEventListener("click", () => {
      const pt = view.toMap({ x: view.width / 2, y: view.height / 2 });
      if (!pt) {
        this.setHint("O centro do ecrã não está sobre o terreno. Move o mapa e tenta outra vez.");
        return;
      }
      void this.select(pt.longitude ?? 0, pt.latitude ?? 0, this.chipRadius);
    });
    document.querySelectorAll<HTMLButtonElement>("[data-probe-r]").forEach((b) =>
      b.addEventListener("click", () => {
        this.chipRadius = Number(b.dataset.probeR);
        this.syncChips(this.chipRadius);
        // muda logo o raio da seleção que está no mapa
        if (this.sel) void this.select(this.sel.lon, this.sel.lat, this.chipRadius);
      }),
    );
    document.querySelectorAll<HTMLButtonElement>("[data-probe-scope]").forEach((b) =>
      b.addEventListener("click", () => void this.setScope(b.dataset.probeScope as Scope)),
    );
    $("probe-all")?.addEventListener("click", () => {
      this.parishes.forEach((p) => this.picked.add(p.id));
      void this.readParishes();
    });
    $("probe-none")?.addEventListener("click", () => {
      this.picked.clear();
      void this.readParishes();
    });

    // carregar sem largar: começa um círculo nesse ponto
    view.on("hold", (e) => {
      if (!this.active || this.scope !== "local" || !e.mapPoint) return;
      e.stopPropagation();
      const r = Math.max(this.chipRadius, 100);
      this.holding = { lon: e.mapPoint.longitude ?? 0, lat: e.mapPoint.latitude ?? 0, r };
      this.drawSelection(this.holding.lon, this.holding.lat, r);
      this.setHint(`Arrasta para mudar o tamanho do círculo. Raio: ${distancia(r).vis}.`);
      navigator.vibrate?.(25);
    });
    // depois de carregar sem largar, arrastar muda o raio (e não mexe o mapa)
    view.on("drag", (e) => {
      const h = this.holding;
      if (!h) return;
      e.stopPropagation();
      const pt = view.toMap({ x: e.x, y: e.y });
      if (pt) {
        h.r = Math.min(MAX_R, Math.max(MIN_R, distanceM(h.lon, h.lat, pt.longitude ?? h.lon, pt.latitude ?? h.lat)));
        this.drawSelection(h.lon, h.lat, h.r);
        this.setHint(`Raio: ${distancia(h.r).vis}. Larga para ler a área.`);
      }
      if (e.action === "end") this.finishHold();
    });
    view.on("pointer-up", () => {
      if (this.holding) this.finishHold();
    });
  }

  /** Toque no mapa com o Explorar ligado. */
  handleClick(lon: number, lat: number): void {
    // o toque que termina um "carregar sem largar" não conta como ponto
    if (performance.now() - this.holdEndedAt < 500) return;
    if (this.scope === "freguesias") {
      void this.toggleParishAt(lon, lat);
      return;
    }
    // no concelho todo, tocar num sítio volta a ler pontos
    if (this.scope === "concelho") void this.setScope("local", false);
    void this.select(lon, lat, this.chipRadius);
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.holding = null;
    const btn = $("btn-probe");
    btn?.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("probing", on);
    const card = $("probe-card");
    if (card) card.hidden = !on;
    const view = this.manager.view;
    if (view) {
      // em ecrãs largos o cartão fica à direita: os botões do mapa passam para o lado dele
      const wide = matchMedia("(min-width: 900px)").matches;
      if (on && wide) {
        this.uiRight = view.ui.padding.right ?? 16;
        this.fitPadding();
      } else if (!on) {
        view.ui.padding = { ...view.ui.padding, right: this.uiRight };
      }
    }
    if (on) {
      this.onToggle(true);
      preloadValues();
      void this.setScope(this.scope, false);
      $("probe-title")?.focus({ preventScroll: true });
    } else {
      this.seq++;
      this.sel = null;
      this.layer.removeAll();
      const body = $("probe-body");
      if (body) body.innerHTML = "";
      this.onToggle(false);
      btn?.focus({ preventScroll: true });
    }
  }

  /**
   * Em ecrãs largos, os botões do mapa ficam à esquerda do cartão. O cartão cresce com a letra (A+, A++):
   * a folga é a largura dele mais a margem. Chamar também quando a letra muda com o Explorar aberto.
   */
  fitPadding(): void {
    const view = this.manager.view;
    const card = $("probe-card");
    if (!view || !this.active || !card || !matchMedia("(min-width: 900px)").matches) return;
    view.ui.padding = { ...view.ui.padding, right: this.uiRight + (card.offsetWidth || 340) + 20 };
  }

  /** Quiosque: a pessoa seguinte encontra o Explorar como no início (ponto, sem raio nem freguesias escolhidas). */
  reset(): void {
    const how = $("probe-how") as HTMLDetailsElement | null;
    if (how) how.open = false;
    const card = $("probe-card");
    if (card) card.scrollTop = 0;
    this.setActive(false);
    this.sel = null;
    this.picked.clear();
    this.chipRadius = 0;
    this.syncChips(0);
    // a escala volta a "ponto ou círculo"; os botões e as listas acertam-se ao abrir (setScope)
    this.scope = "local";
  }

  // ------------------------------------------------------------------ escala: ponto/círculo, concelho, freguesias
  private async setScope(scope: Scope, read = true): Promise<void> {
    this.scope = scope;
    this.holding = null;
    document.querySelectorAll<HTMLButtonElement>("[data-probe-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.probeScope === scope)));
    const local = $("probe-local");
    const parishes = $("probe-parishes");
    if (local) local.hidden = scope !== "local";
    if (parishes) parishes.hidden = scope !== "freguesias";
    if (scope === "local") {
      // volta à última leitura de ponto ou círculo (ou a nada)
      this.seq++;
      this.layer.removeAll();
      if (this.sel && read) void this.select(this.sel.lon, this.sel.lat, this.sel.r);
      else {
        if (this.sel) this.drawSelection(this.sel.lon, this.sel.lat, this.sel.r);
        const body = $("probe-body");
        if (body && !this.sel) body.innerHTML = "";
      }
      this.setHint("Toca num ponto do mapa. Para uma área, carrega sem largar e arrasta.");
      return;
    }
    try {
      await this.loadBoundaries();
    } catch {
      this.setHint("Não foi possível ler os limites. Tenta outra vez.");
      return;
    }
    if (this.scope !== scope) return;
    if (scope === "concelho") await this.readConcelho();
    else {
      this.renderParishList();
      await this.readParishes();
    }
  }

  private loadBoundaries(): Promise<void> {
    if (!this.boundaries) {
      this.boundaries = (async () => {
        const [c, f] = await Promise.all([
          fetch("/data/alijo-concelho.geojson").then((r) => r.json()),
          fetch("/data/alijo-freguesias.geojson").then((r) => r.json()),
        ]);
        const ringsOf = (g: any): Rings => (g.type === "MultiPolygon" ? g.coordinates.flat() : g.coordinates);
        this.concelho = ringsOf(c.features[0].geometry);
        this.parishes = f.features
          .map((ft: any) => {
            const name = String(ft.properties.nome_freguesia);
            return { id: String(ft.properties.id_freguesia), name, short: name.replace(/^União das freguesias de /, ""), rings: ringsOf(ft.geometry) };
          })
          .sort((a: Parish, b: Parish) => a.short.localeCompare(b.short, "pt"));
      })().catch((err) => {
        this.boundaries = null;
        throw err;
      });
    }
    return this.boundaries;
  }

  private renderParishList(): void {
    const list = $("probe-parish-list");
    if (list && list.childElementCount !== this.parishes.length) {
      list.innerHTML = this.parishes
        .map(
          (p) =>
            `<label class="parish-item" title="${esc(p.name)}"><input type="checkbox" data-parish="${p.id}" /><span>${esc(p.short)}</span></label>`,
        )
        .join("");
      list.querySelectorAll<HTMLInputElement>("[data-parish]").forEach((cb) =>
        cb.addEventListener("change", () => {
          const id = cb.dataset.parish!;
          if (cb.checked) this.picked.add(id);
          else this.picked.delete(id);
          void this.readParishes();
        }),
      );
    }
    this.syncParishList();
  }

  private syncParishList(): void {
    document.querySelectorAll<HTMLInputElement>("[data-parish]").forEach((cb) => (cb.checked = this.picked.has(cb.dataset.parish!)));
    const n = this.picked.size;
    const summary = $("probe-parish-summary");
    if (summary) summary.textContent = n ? `Escolher freguesias (${n} escolhida${n === 1 ? "" : "s"})` : "Escolher freguesias";
    // sem nenhuma escolhida, a lista abre-se sozinha
    const det = $("probe-parishes-details") as HTMLDetailsElement | null;
    if (det && !n) det.open = true;
  }

  private async toggleParishAt(lon: number, lat: number): Promise<void> {
    await this.loadBoundaries();
    const p = this.parishes.find((x) => inRings(lon, lat, x.rings));
    if (!p) {
      this.setHint("Aqui não há freguesia do concelho de Alijó. Toca dentro do concelho.");
      return;
    }
    if (this.picked.has(p.id)) this.picked.delete(p.id);
    else this.picked.add(p.id);
    await this.readParishes();
  }

  private async readConcelho(): Promise<void> {
    const rings = this.concelho;
    if (!rings) return;
    const seq = ++this.seq;
    this.drawPolygons([rings], 0.08);
    this.setHint("A ler o concelho todo…");
    const html = await this.regionHtml("Concelho de Alijó", "concelho", [rings]);
    if (seq !== this.seq) return;
    this.showBody(html, "Para ler um ponto, toca no mapa.");
  }

  private async readParishes(): Promise<void> {
    this.syncParishList();
    const chosen = this.parishes.filter((p) => this.picked.has(p.id));
    const seq = ++this.seq;
    const body = $("probe-body");
    this.drawPolygons(chosen.map((p) => p.rings), 0.18);
    if (!chosen.length) {
      if (body) body.innerHTML = "";
      this.setHint("Toca numa freguesia no mapa, ou escolhe na lista. Podes juntar várias.");
      return;
    }
    this.setHint(`A ler ${chosen.length === 1 ? "a freguesia" : `${chosen.length} freguesias`}…`);
    const key = `f:${chosen.map((p) => p.id).join(",")}`;
    // todas as freguesias são o concelho: os números exatos do concelho (os limites das freguesias deixam
    // de fora 906 quadrados do concelho e sobrepõem-se noutros; contados aqui davam 297,0 km² e não 297,6)
    const html =
      chosen.length === this.parishes.length
        ? await this.regionHtml("Todas as freguesias", "concelho", [], null, null, "Nestas freguesias")
        : await this.regionHtml(
            chosen.length === 1 ? chosen[0].name : `${chosen.length} freguesias`,
            key,
            chosen.map((p) => p.rings),
            chosen.length > 1 ? chosen.map((p) => p.short) : null,
            chosen.map((p) => p.name),
          );
    if (seq !== this.seq) return;
    this.showBody(html, "Toca noutra freguesia para a juntar ou tirar.");
  }

  // ------------------------------------------------------------------ ponto e círculo
  private finishHold(): void {
    const h = this.holding;
    this.holding = null;
    if (!h) return;
    this.holdEndedAt = performance.now();
    void this.select(h.lon, h.lat, h.r);
  }

  private syncChips(r: number): void {
    document.querySelectorAll<HTMLButtonElement>("[data-probe-r]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.probeR) === r)));
  }

  private setHint(t: string): void {
    const el = $("probe-hint");
    // o mesmo texto não se volta a escrever (nem a anunciar)
    if (el && el.textContent !== t) el.textContent = t;
  }

  private drawSelection(lon: number, lat: number, r: number): void {
    this.layer.removeAll();
    const center = new Point({ longitude: lon, latitude: lat });
    if (r > 0) {
      this.layer.add(
        new Graphic({
          geometry: new Circle({ center, radius: r, radiusUnit: "meters", geodesic: true, numberOfPoints: 96 }),
          symbol: new SimpleFillSymbol({ color: [...PROBE_RGB, 0.16], outline: { color: [...PROBE_RGB, 1], width: 3 } }),
        }),
      );
    }
    this.layer.add(
      new Graphic({
        geometry: center,
        symbol: new PointSymbol3D({ symbolLayers: [new IconSymbol3DLayer({ resource: { href: targetSvg() }, size: 30, anchor: "center" })] }),
      }),
    );
  }

  private drawPolygons(polys: Rings[], fill: number): void {
    this.layer.removeAll();
    for (const rings of polys) {
      this.layer.add(
        new Graphic({
          geometry: new Polygon({ rings, spatialReference: { wkid: 4326 } }),
          symbol: new SimpleFillSymbol({ color: [...PROBE_RGB, fill], outline: { color: [...PROBE_RGB, 1], width: 3 } }),
        }),
      );
    }
  }

  private async select(lon: number, lat: number, r: number): Promise<void> {
    if (!this.active) return;
    const seq = ++this.seq;
    this.sel = { lon, lat, r };
    this.drawSelection(lon, lat, r);
    const body = $("probe-body");
    if (!body) return;
    this.setHint(r > 0 ? "A ler a área…" : "A ler o ponto…");
    const html = r > 0 ? await this.circleHtml(lon, lat, r) : await this.pointHtml(lon, lat);
    if (seq !== this.seq) return;
    this.showBody(html, r > 0 ? "Carrega sem largar e arrasta para outro círculo, ou toca num ponto." : "Toca noutro ponto, ou carrega sem largar e arrasta para uma área.");
  }

  /**
   * Mostra uma leitura nova. A dica muda antes do corpo: as duas regiões são aria-live e há leitores de
   * ecrã que só dizem o último anúncio, que tem de ser a ficha. Depois, se a ficha ficou fora da vista
   * (cartão deslocado até ao «Como sabemos?», ou à lista das freguesias), o cartão volta ao início dela,
   * sem animação e sem mexer no foco.
   */
  private showBody(html: string, hint: string): void {
    const body = $("probe-body");
    if (!body) return;
    this.setHint(hint);
    body.innerHTML = html;
    const card = $("probe-card");
    if (!card || card.hidden) return;
    const c = card.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (b.top >= c.top && b.top <= c.bottom - 48) return; // a ficha nova já se vê
    const delta = b.top - c.top - 8;
    // leitura pedida por um controlo do cartão (Centro, raio, freguesias): só sobe se esse controlo continuar à vista
    const f = document.activeElement;
    if (f instanceof HTMLElement && f !== card && card.contains(f)) {
      const r = f.getBoundingClientRect();
      if (r.top - delta < c.top || r.bottom - delta > c.bottom) return;
    }
    card.scrollTop += delta;
  }

  private async altitude(lon: number, lat: number): Promise<number | null> {
    try {
      const res = await this.manager.view!.map!.ground.queryElevation(new Point({ longitude: lon, latitude: lat }));
      const z = (res.geometry as Point).z;
      return Number.isFinite(z) ? Math.round(z!) : null;
    } catch {
      return null;
    }
  }

  private async pointHtml(lon: number, lat: number): Promise<string> {
    // os limites (para o nome da freguesia) e os dados do ponto leem-se ao mesmo tempo
    const [, p] = await Promise.all([this.loadBoundaries().catch(() => undefined), readPoint(lon, lat, (a, b) => this.altitude(a, b))]);
    const parish = this.parishes.find((x) => inRings(lon, lat, x.rings));
    return fichaHtml(p, { freguesia: parish?.short ?? null, visibleMap: this.visibleMap(), tecnico: TECNICO });
  }

  /**
   * Uma linha por tema: o que se mede, a barra com as classes da legenda e o número grande (% da área), com
   * a parte sem valor por baixo (a partir de 1 %); depois os factos.
   */
  private async rowsHtml(hist: (key: string) => Promise<Histogram>, facts: Facts | null, ctx: AreaCtx): Promise<string> {
    const items: string[] = [];
    for (const row of ROWS) {
      const layer = VISIT_LAYERS[row.key];
      if (!layer) continue;
      const h = await hist(row.key);
      if (!h || !h.total) continue;
      const segs = layer.legend
        .map((it) => ({ it, n: sum(h.counts, it.classes) }))
        .filter((s) => s.n > 0)
        .map((s) => `<i style="width:${((s.n / h.total) * 100).toFixed(1)}%;background:${s.it.color}"></i>`)
        .join("");
      const sentence = row.area(h.counts, h.total, ctx);
      const semN = row.sem ? h.total - sum(h.counts, CLASSES_1_5) : 0;
      // tudo sem valor: a palavra em vez de "0 %"; uma parte sem valor: dita também a quem vê (o title não chega ao toque)
      const big = row.sem && semN === h.total ? row.sem : `${pctTxt(sum(h.counts, row.hit), h.total)}${NBSP}%`;
      const sub = row.sem && semN < h.total && atLeast1(semN, h.total)
        ? `<span class="pv-sub" aria-hidden="true">${row.sem}: ${pctTxt(semN, h.total)}${NBSP}%</span>`
        : "";
      items.push(
        `<tr title="${esc(sentence)}"><th scope="row">${row.label}<span class="pv-src" aria-hidden="true">${fonteCurtaHtml(aboutOf(row.key).fonte_curta)}</span></th>` +
          `<td><span class="probe-bar" aria-hidden="true">${segs}</span></td>` +
          `<td class="pv"><strong aria-hidden="true">${big}</strong>${sub}<span class="sr-only">${esc(sentence)} Fonte: ${esc(fonteSr(row.key))}.</span></td></tr>`,
      );
    }
    // o rodapé é só para quem vê: cada frase do leitor de ecrã já diz «por cento da área»
    // (a dica do title não chega ao toque nem ao teclado, por isso não se promete)
    return `<table class="probe-table area"><caption class="sr-only">Percentagem da área</caption><tbody>${items.join("")}</tbody></table>${factsHtml(facts)}<p class="probe-foot" aria-hidden="true">Cada número é uma parte da área, em percentagem.</p>`;
  }

  /**
   * Máscara 0/1 do concelho na grelha `geo`: a exata (concelho_25m, centro da célula dentro, do ArcGIS Pro)
   * na grelha de 25 m; nas de 10 m, o limite desenhado nessa grelha (maskOf, guardada e partilhada).
   */
  private async concelhoMask(geo: GridGeo, m25: Uint8Array): Promise<Uint8Array | null> {
    if (geo.id === VALUES.concelho.geo.id) return m25;
    await this.loadBoundaries().catch(() => undefined);
    return this.concelho ? maskOf(geo, "concelho", [this.concelho]) : null;
  }

  private async circleHtml(lon: number, lat: number, r: number): Promise<string> {
    const ha = (Math.PI * r * r) / 10000;
    const d = distancia(r);
    const title = `<strong><span aria-hidden="true">Círculo de ${d.vis}</span><span class="sr-only">Círculo de ${d.sr}.</span></strong>`;
    // quanto do círculo fica dentro do concelho (centros das células de 25 m dentro do limite)
    const [conc, m25] = await Promise.all([VALUES.concelho.histogram(lon, lat, r), VALUES.concelho.bytes()]);
    if (!conc || !m25) return `<p class="probe-head">${title}<br />${sizeHtml(ha, null)}</p>${NAO_LEU}`;
    const insideCells = conc.counts[1];
    // o círculo inteiro, também a parte que sai da grelha de 25 m (o concelho chega a ~1 km do bordo)
    const circleCells = Math.max(conc.total, cellsInCircle(VALUES.concelho.geo, lon, lat, r));
    if (!insideCells) {
      return `<p class="probe-head">${title}<br />${sizeHtml(ha, null)}</p><p class="probe-out">Este círculo fica fora do concelho de Alijó. Aqui só mostramos dados do concelho.</p>`;
    }
    const circle = new Circle({ center: new Point({ longitude: lon, latitude: lat }), radius: r, radiusUnit: "meters", geodesic: true, numberOfPoints: 64 });
    const head = `<p class="probe-head">${title}<br />${sizeHtml(ha, await this.countHouses(circle))}</p>`;
    const p = pctTxt(insideCells, circleCells);
    // as linhas e os factos contam só os quadrados dentro do concelho: diz-se logo, antes dos números
    const part =
      insideCells / circleCells < 0.98
        ? `<p class="probe-part"><span aria-hidden="true">${p}${NBSP}% do círculo fica dentro do concelho.</span><span class="sr-only">${p} por cento do círculo fica dentro do concelho.</span> Os números contam só essa parte.</p>`
        : "";
    const hist = async (k: string): Promise<Histogram> => {
      const g = VISIT_LAYERS[k].grid;
      const m = await this.concelhoMask(g.geo, m25);
      return m ? g.histogram(lon, lat, r, m) : null;
    };
    const [rec, ua, rio] = await Promise.all([
      VALUES.recorrencia.histogram(lon, lat, r, m25),
      VALUES.ultimoAno.histogram(lon, lat, r, m25),
      VALUES.rio.histogram(lon, lat, r, m25),
    ]);
    const rows = await this.rowsHtml(hist, factsFrom("Neste círculo", rec, ua), { rio: (rio?.counts[1] ?? 0) > 0 });
    return `${head}${part}${rows}`;
  }

  /**
   * Concelho (contagens exatas do manifest; também «Todas as freguesias», com `onde`) ou freguesias
   * (contadas aqui, dentro dos polígonos e do concelho).
   */
  private async regionHtml(
    title: string,
    key: string,
    polys: Rings[],
    names: string[] | null = null,
    parishNames: string[] | null = null,
    onde = "No concelho",
  ): Promise<string> {
    const houses = await this.countHousesIn(parishNames);
    const list = names ? `<br /><span class="probe-names">${names.map(esc).join(", ")}</span>` : "";
    const head = (ha: number | null) => `<p class="probe-head"><strong>${esc(title)}</strong>${ha == null ? "" : `<br />${sizeHtml(ha, houses)}`}${list}</p>`;
    if (key === "concelho") {
      // contado no ArcGIS Pro, célula a célula (scripts/pro_to_web.py): exato
      const r = CONCELHO.resumo;
      const facts: Facts = { onde, ultimo: r.ardeu_ha > 0 ? r.ultimo_fogo_ano : null, max: r.max_vezes, concelho: true };
      return `${head(CONCELHO.area_ha)}${await this.rowsHtml((k) => Promise.resolve(concelhoHist(k)), facts, { rio: r.rio_ha > 0 })}`;
    }
    // só os quadrados das freguesias que ficam dentro do concelho (os limites das freguesias são mais grosseiros)
    const m25 = await VALUES.concelho.bytes();
    const base = m25 ? await VALUES.concelho.histogramPolygons(key, polys, m25) : null;
    if (!m25 || !base) return `${head(null)}${NAO_LEU}`;
    // células da grelha PT-TM06 de 25 m: a área é a mesma em todo o concelho
    const ha = base.total * VALUES.concelho.cellHa();
    const ondeF = (parishNames?.length ?? 0) > 1 ? "Nestas freguesias" : "Nesta freguesia";
    const hist = async (k: string): Promise<Histogram> => {
      const g = VISIT_LAYERS[k].grid;
      const m = await this.concelhoMask(g.geo, m25);
      return m ? g.histogramPolygons(key, polys, m) : null;
    };
    const [rec, ua, rio] = await Promise.all([
      VALUES.recorrencia.histogramPolygons(key, polys, m25),
      VALUES.ultimoAno.histogramPolygons(key, polys, m25),
      VALUES.rio.histogramPolygons(key, polys, m25),
    ]);
    const rows = await this.rowsHtml(hist, factsFrom(ondeF, rec, ua), { rio: (rio?.counts[1] ?? 0) > 0 });
    return `${head(ha)}${rows}`;
  }

  /**
   * Casas por freguesia (cada edifício traz o nome da freguesia): contadas uma vez e guardadas.
   * Contar dentro de um polígono complicado demora dezenas de segundos; por nome é imediato.
   */
  private async countHousesIn(parishNames: string[] | null): Promise<number | null> {
    const layer = this.manager.sanfinsBuildingsLayer;
    if (!layer) return null;
    if (!this.housesByParish) {
      this.housesByParish = (async () => {
        await layer.load();
        const res = await layer.queryFeatures({ where: "1=1", outFields: ["freguesia"], returnGeometry: false });
        const counts = new Map<string, number>();
        for (const f of res.features) {
          const k = String(f.attributes.freguesia);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return counts;
      })().catch(() => {
        this.housesByParish = null;
        return null;
      });
    }
    const counts = await this.housesByParish;
    if (!counts) return null;
    if (!parishNames) return [...counts.values()].reduce((a, b) => a + b, 0);
    return parishNames.reduce((n, name) => n + (counts.get(name) ?? 0), 0);
  }

  private async countHouses(geometry: Geometry): Promise<number | null> {
    const layer = this.manager.sanfinsBuildingsLayer;
    if (!layer) return null;
    try {
      await layer.load();
      return await layer.queryFeatureCount({ geometry, spatialRelationship: "intersects" });
    } catch {
      return null;
    }
  }
}
