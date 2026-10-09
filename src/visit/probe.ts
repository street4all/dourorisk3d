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
import { VISIT_LAYERS, type LegendItem } from "./layers";

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

/** Classe mais comum entre as zonas com dados; diz também quanto ficou sem dados (aldeias, rio). */
function mostCommon(counts: number[], total: number, words: string[]): string | null {
  const inside = sum(counts, [1, 2, 3, 4, 5]);
  if (!inside) return "Sem dados nesta área.";
  let best = 1;
  for (let c = 2; c <= 5; c++) if (counts[c] > counts[best]) best = c;
  const high = pct(sum(counts, [4, 5]), total);
  const none = pct(total - inside, total);
  return `Mais comum: ${best} · ${words[best - 1]}. Alto ou muito alto: ${high} % da área.${none >= 5 ? ` Sem dados: ${none} % (aldeias, rio).` : ""}`;
}

const RISK_WORDS = ["muito baixo", "baixo", "médio", "alto", "muito alto"];
const ROWS: Row[] = [
  { key: "risco_2025", title: "Risco de incêndio", area: (c, t) => mostCommon(c, t, RISK_WORDS) },
  { key: "icnf_estrutural", title: "Perigo no mapa oficial (ICNF)", area: (c, t) => mostCommon(c, t, RISK_WORDS) },
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

function fmtHa(ha: number): string {
  const fields = Math.round(ha / HA_PER_FIELD);
  const area = ha >= 1000 ? `${(ha / 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} km²` : `${Math.round(ha).toLocaleString("pt-PT")} ha`;
  return `${area}, o mesmo que ${fields.toLocaleString("pt-PT")} ${fields === 1 ? "campo" : "campos"} de futebol`;
}

function legendItemFor(legend: LegendItem[], cls: number): LegendItem | undefined {
  return legend.find((it) => it.classes.includes(cls));
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

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const $ = (id: string) => document.getElementById(id);

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
        view.ui.padding = { ...view.ui.padding, right: this.uiRight + 360 };
      } else if (!on) {
        view.ui.padding = { ...view.ui.padding, right: this.uiRight };
      }
    }
    if (on) {
      this.onToggle(true);
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
    if (!list || list.childElementCount === this.parishes.length) {
      this.syncParishList();
      return;
    }
    list.innerHTML = this.parishes
      .map((p) => `<button type="button" class="chip parish" data-parish="${p.id}" aria-pressed="false" title="${esc(p.name)}">${esc(p.short)}</button>`)
      .join("");
    list.querySelectorAll<HTMLButtonElement>("[data-parish]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.parish!;
        if (this.picked.has(id)) this.picked.delete(id);
        else this.picked.add(id);
        void this.readParishes();
      }),
    );
    this.syncParishList();
  }

  private syncParishList(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-parish]").forEach((b) => b.setAttribute("aria-pressed", String(this.picked.has(b.dataset.parish!))));
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
    const body = $("probe-body");
    if (body) body.innerHTML = html;
    this.setHint("Para ler um ponto, toca no mapa.");
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
    const title = chosen.length === 1 ? chosen[0].name : chosen.length === this.parishes.length ? "Todas as freguesias" : `${chosen.length} freguesias`;
    const key = `f:${chosen.map((p) => p.id).join(",")}`;
    const html = await this.regionHtml(title, key, chosen.map((p) => p.rings), chosen.length > 1 && chosen.length < this.parishes.length ? chosen.map((p) => p.short) : null);
    if (seq !== this.seq) return;
    if (body) body.innerHTML = html;
    this.setHint("Toca noutra freguesia para a juntar ou tirar.");
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
    await this.loadBoundaries().catch(() => undefined);
    const parish = this.parishes.find((p) => inRings(lon, lat, p.rings));
    const head = `<p class="probe-head"><strong>Ponto</strong>${alt != null ? ` · ${alt} m de altitude` : ""}<br /><span>${parish ? `${esc(parish.name)} · ` : ""}${this.coords(lon, lat)}</span></p>`;
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

  /** Uma linha por tema: barra empilhada com as cores da legenda e a mesma informação por palavras. */
  private rowsHtml(hist: (key: string) => Promise<Histogram>): Promise<string> {
    return (async () => {
      const items: string[] = [];
      for (const row of ROWS) {
        const layer = VISIT_LAYERS[row.key];
        if (!layer) continue;
        const h = await hist(row.key);
        if (!h || !h.total) continue;
        const segs = layer.legend
          .map((it) => ({ it, n: sum(h.counts, it.classes) }))
          .filter((s) => s.n > 0)
          .map((s) => `<i style="width:${((s.n / h.total) * 100).toFixed(1)}%;background:${s.it.color}" title="${s.it.label}: ${pct(s.n, h.total)} %"></i>`)
          .join("");
        const txt = row.area(h.counts, h.total) ?? "";
        items.push(`<li class="area"><strong>${row.title}</strong><span class="probe-bar" aria-hidden="true">${segs}</span><span>${txt}</span></li>`);
      }
      return `<ul class="probe-list">${items.join("")}</ul>`;
    })();
  }

  private housesHtml(n: number | null, where: string): string {
    return n == null ? "" : `<p class="probe-houses"><strong>${n.toLocaleString("pt-PT")}</strong> ${n === 1 ? "casa ou edifício" : "casas e edifícios"} ${where}.</p>`;
  }

  private async circleHtml(lon: number, lat: number, r: number): Promise<string> {
    const ha = (Math.PI * r * r) / 10000;
    const head = `<p class="probe-head"><strong>Círculo de ${fmtM(r)} de raio</strong><br /><span>${fmtHa(ha)}</span></p>`;
    const risk = await VISIT_LAYERS.risco_2025.grid.histogram(lon, lat, r);
    const insideCells = risk ? sum(risk.counts, [1, 2, 3, 4, 5]) : 0;
    if (!risk || !insideCells) return `${head}<p class="probe-out">Fora do concelho de Alijó: aqui não há dados.</p>`;
    const share = pct(insideCells, risk.total);
    const note = share < 98 ? `<p class="hint">${share} % do círculo está dentro do concelho.</p>` : "";
    const circle = new Circle({ center: new Point({ longitude: lon, latitude: lat }), radius: r, radiusUnit: "meters", geodesic: true, numberOfPoints: 64 });
    const houses = this.housesHtml(await this.countHouses(circle), "dentro do círculo");
    const rows = await this.rowsHtml((key) => VISIT_LAYERS[key].grid.histogram(lon, lat, r));
    return `${head}${note}${houses}${rows}`;
  }

  /** Concelho ou freguesias: as mesmas linhas, contadas dentro dos polígonos. */
  private async regionHtml(title: string, key: string, polys: Rings[], names: string[] | null = null): Promise<string> {
    const grid = VISIT_LAYERS.risco_2025.grid;
    const risk = await grid.histogramPolygons(key, polys);
    const lat = polys[0][0].reduce((s, p) => s + p[1], 0) / polys[0][0].length;
    const ha = risk ? risk.total * grid.cellHa(lat) : 0;
    const list = names ? `<br /><span>${names.map(esc).join(", ")}</span>` : "";
    const head = `<p class="probe-head"><strong>${esc(title)}</strong><br /><span>${fmtHa(ha)}</span>${list}</p>`;
    const geom = new Polygon({ rings: polys.flat(), spatialReference: { wkid: 4326 } });
    const houses = this.housesHtml(await this.countHouses(geom), "na área escolhida");
    const rows = await this.rowsHtml((k) => VISIT_LAYERS[k].grid.histogramPolygons(key, polys));
    return `${head}${houses}${rows}`;
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
