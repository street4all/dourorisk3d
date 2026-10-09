// Explorar: ler os dados de um ponto ou de uma área em círculo, a qualquer momento da visita.
// O mesmo ponteiro serve para as duas coisas: tocar = ponto; carregar sem largar e arrastar = círculo.
// Arrastar sem carregar primeiro continua a mexer o mapa. Alternativa por teclado: ler o centro do mapa.
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Circle from "@arcgis/core/geometry/Circle.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import type { Alijo3DManager } from "../alijo3d/alijoScene";
import { VISIT_LAYERS, type LegendItem } from "./layers";

const MIN_R = 25;
const MAX_R = 3000;
const HA_PER_FIELD = 0.714; // campo de futebol 105 × 68 m
const PROBE_RGB: [number, number, number] = [0, 190, 255];

interface Row {
  key: string;
  title: string;
  /** frase para uma área, a partir das contagens (null = não dizer nada) */
  area: (counts: number[], total: number) => string | null;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const sum = (counts: number[], classes: number[]) => classes.reduce((s, c) => s + counts[c], 0);

function mostCommon(counts: number[], words: string[]): string | null {
  const inside = sum(counts, [1, 2, 3, 4, 5]);
  if (!inside) return null;
  let best = 1;
  for (let c = 2; c <= 5; c++) if (counts[c] > counts[best]) best = c;
  const high = pct(sum(counts, [4, 5]), inside);
  return `Mais comum: ${best} · ${words[best - 1]} (${pct(counts[best], inside)} %). Alto ou muito alto: ${high} %.`;
}

const RISK_WORDS = ["muito baixo", "baixo", "médio", "alto", "muito alto"];
const ROWS: Row[] = [
  { key: "risco_2025", title: "Risco de incêndio", area: (c) => mostCommon(c, RISK_WORDS) },
  { key: "icnf_estrutural", title: "Perigo no mapa oficial (ICNF)", area: (c) => mostCommon(c, RISK_WORDS) },
  {
    key: "recorrencia_a11y",
    title: "Quantas vezes ardeu (1990–2025)",
    area: (c, t) => {
      const burned = sum(c, [1, 2, 3, 4, 5]);
      if (!burned) return "Não ardeu desde 1990.";
      let max = 5;
      while (max > 1 && !c[max]) max--;
      return `Já ardeu ${pct(burned, t)} % da área, até ${max >= 5 ? "5 ou mais" : max} ${max === 1 ? "vez" : "vezes"}.`;
    },
  },
  { key: "declive_a11y", title: "Encosta", area: (c, t) => `Muito inclinada ou quase a pique: ${pct(sum(c, [3, 4]), t)} %.` },
  { key: "exposicao_sol", title: "Sol", area: (c, t) => `Virada ao sol (o mato seca mais): ${pct(c[1], t)} %.` },
  { key: "biomassa_2025", title: "Mato", area: (c, t) => `Muito mato ou mato denso: ${pct(sum(c, [4, 5]), t)} %.` },
];

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

function fmtM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} km` : `${Math.round(m / 5) * 5} m`;
}

function legendItemFor(legend: LegendItem[], cls: number): LegendItem | undefined {
  return legend.find((it) => it.classes.includes(cls));
}

const $ = (id: string) => document.getElementById(id);

export class Probe {
  active = false;
  private layer = new GraphicsLayer({ title: "Explorar", listMode: "hide" });
  /** raio escolhido nos botões (0 = ponto) */
  private chipRadius = 0;
  private sel: { lon: number; lat: number; r: number } | null = null;
  private holding: { lon: number; lat: number; r: number } | null = null;
  private seq = 0;
  private uiRight = 16;
  private holdEndedAt = 0;

  constructor(
    private manager: Alijo3DManager,
    /** a visita fecha a janela aberta em ecrãs estreitos, para o cartão caber */
    private onToggle: (on: boolean) => void,
  ) {}

  init(): void {
    const view = this.manager.view;
    if (!view) return;
    view.map!.add(this.layer);
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

    // carregar sem largar: começa um círculo nesse ponto
    view.on("hold", (e) => {
      if (!this.active || !e.mapPoint) return;
      e.stopPropagation();
      const r = Math.max(this.chipRadius, 100);
      this.holding = { lon: e.mapPoint.longitude ?? 0, lat: e.mapPoint.latitude ?? 0, r };
      this.drawSelection(this.holding.lon, this.holding.lat, r);
      this.setHint(`Arrasta para mudar o tamanho do círculo. Raio: ${fmtM(r)}.`);
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
        this.setHint(`Raio: ${fmtM(h.r)}. Larga para ler a área.`);
      }
      if (e.action === "end") this.finishHold();
    });
    view.on("pointer-up", () => {
      if (this.holding) this.finishHold();
    });
  }

  /** Toque no mapa com o Explorar ligado: lê o ponto (ou o círculo do raio escolhido). */
  handleClick(lon: number, lat: number): void {
    // o toque que termina um "carregar sem largar" não conta como ponto
    if (performance.now() - this.holdEndedAt < 500) return;
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
        view.ui.padding = { ...view.ui.padding, right: this.uiRight + 360 };
      } else if (!on) {
        view.ui.padding = { ...view.ui.padding, right: this.uiRight };
      }
    }
    if (on) {
      this.onToggle(true);
      this.setHint("Toca num ponto do mapa. Para uma área, carrega sem largar e arrasta.");
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

  private finishHold(): void {
    const h = this.holding;
    this.holding = null;
    if (!h) return;
    this.holdEndedAt = performance.now();
    this.syncChips(-1);
    void this.select(h.lon, h.lat, h.r);
  }

  private syncChips(r: number): void {
    document.querySelectorAll<HTMLButtonElement>("[data-probe-r]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.probeR) === r)));
  }

  private setHint(t: string): void {
    const el = $("probe-hint");
    if (el) el.textContent = t;
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

  private async select(lon: number, lat: number, r: number): Promise<void> {
    if (!this.active) return;
    const seq = ++this.seq;
    this.sel = { lon, lat, r };
    this.drawSelection(lon, lat, r);
    const body = $("probe-body");
    if (!body) return;
    this.setHint(r > 0 ? "A ler a área…" : "A ler o ponto…");
    const html = r > 0 ? await this.areaHtml(lon, lat, r) : await this.pointHtml(lon, lat);
    if (seq !== this.seq) return;
    body.innerHTML = html;
    this.setHint(r > 0 ? "Carrega sem largar e arrasta para outro círculo, ou toca num ponto." : "Toca noutro ponto, ou carrega sem largar e arrasta para uma área.");
  }

  private coords(lon: number, lat: number): string {
    const f = (v: number) => Math.abs(v).toLocaleString("pt-PT", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return `${f(lat)}° N, ${f(lon)}° O`;
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
    const inside = await VISIT_LAYERS.risco_2025.grid.sample(lon, lat, 0);
    const alt = await this.altitude(lon, lat);
    const head = `<p class="probe-head"><strong>Ponto</strong>${alt != null ? ` · ${alt} m de altitude` : ""}<br /><span>${this.coords(lon, lat)}</span></p>`;
    if (inside <= 0) return `${head}<p class="probe-out">Fora do concelho de Alijó: aqui não há dados.</p>`;
    const items: string[] = [];
    for (const row of ROWS) {
      const layer = VISIT_LAYERS[row.key];
      if (!layer) continue;
      const cls = await layer.grid.sample(lon, lat, 0);
      const it = cls > 0 ? legendItemFor(layer.legend, cls) : undefined;
      const sw = it
        ? `<span class="sw" style="background:${it.color}">${it.number ?? ""}</span>`
        : `<span class="sw none" aria-hidden="true">–</span>`;
      const txt = cls > 0 ? layer.describe(cls) : layer.empty;
      items.push(`<li>${sw}<span><strong>${row.title}</strong><br />${txt}</span></li>`);
    }
    return `${head}<ul class="probe-list">${items.join("")}</ul>`;
  }

  private async areaHtml(lon: number, lat: number, r: number): Promise<string> {
    const ha = (Math.PI * r * r) / 10000;
    const fields = Math.round(ha / HA_PER_FIELD);
    const head = `<p class="probe-head"><strong>Círculo de ${fmtM(r)} de raio</strong><br /><span>${Math.round(ha).toLocaleString("pt-PT")} ha, o mesmo que ${fields.toLocaleString("pt-PT")} ${fields === 1 ? "campo" : "campos"} de futebol</span></p>`;
    const risk = await VISIT_LAYERS.risco_2025.grid.histogram(lon, lat, r);
    const insideCells = risk ? sum(risk.counts, [1, 2, 3, 4, 5]) : 0;
    if (!risk || !insideCells) return `${head}<p class="probe-out">Fora do concelho de Alijó: aqui não há dados.</p>`;
    const share = pct(insideCells, risk.total);
    const parts: string[] = [];
    if (share < 98) parts.push(`<p class="hint">${share} % do círculo está dentro do concelho.</p>`);
    const houses = await this.countHouses(lon, lat, r);
    if (houses != null) parts.push(`<p class="probe-houses"><strong>${houses.toLocaleString("pt-PT")}</strong> ${houses === 1 ? "casa ou edifício" : "casas e edifícios"} dentro do círculo.</p>`);
    const items: string[] = [];
    for (const row of ROWS) {
      const layer = VISIT_LAYERS[row.key];
      if (!layer) continue;
      const h = await layer.grid.histogram(lon, lat, r);
      if (!h || !h.total) continue;
      // barra empilhada com as cores da legenda (o texto ao lado diz o mesmo por palavras)
      const segs = layer.legend
        .map((it) => ({ it, n: sum(h.counts, it.classes) }))
        .filter((s) => s.n > 0)
        .map((s) => `<i style="width:${((s.n / h.total) * 100).toFixed(1)}%;background:${s.it.color}" title="${s.it.label}: ${pct(s.n, h.total)} %"></i>`)
        .join("");
      const txt = row.area(h.counts, h.total) ?? "";
      items.push(`<li class="area"><strong>${row.title}</strong><span class="probe-bar" aria-hidden="true">${segs}</span><span>${txt}</span></li>`);
    }
    return `${head}${parts.join("")}<ul class="probe-list">${items.join("")}</ul>`;
  }

  private async countHouses(lon: number, lat: number, r: number): Promise<number | null> {
    const layer = this.manager.sanfinsBuildingsLayer;
    if (!layer) return null;
    try {
      await layer.load();
      const circle = new Circle({ center: new Point({ longitude: lon, latitude: lat }), radius: r, radiusUnit: "meters", geodesic: true, numberOfPoints: 64 });
      return await layer.queryFeatureCount({ geometry: circle, spatialRelationship: "intersects" });
    } catch {
      return null;
    }
  }
}
