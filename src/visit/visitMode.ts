// Modo Visita "Onde pode arder?": mapa em ecrã inteiro, barra de 5 passos e janelas flutuantes.
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Circle from "@arcgis/core/geometry/Circle.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import LineCallout3D from "@arcgis/core/symbols/callouts/LineCallout3D.js";
import type { Alijo3DManager } from "../alijo3d/alijoScene";
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import type { LiveWeatherReport } from "../alijo3d/weatherService";
import type { ClickEvent } from "@arcgis/core/views/input/types.js";
import { VISIT_LAYERS, renderLegend } from "./layers";
import { NO_DATA } from "./sampler";
import { gridFromManifest, gridOfLayer, pixelOf } from "../geo/grid";
import { CanvasOverlay } from "./overlay";
import { COUNT_COLORS, cuesAt, renderCueCount } from "./cues";
import { loadStack } from "./stack";
import { Probe } from "./probe";
import { MapsPanel, loadImage } from "./maps";
import { HA_PER_CELL, HA_PER_FIELD, renderSpread, simulateSpread, type SpreadResult } from "./spread";
import { RISK_WORDS, rumo } from "./words";
import { TECNICO } from "./tecnico";
import { A0, A1 } from "../data/concelho";
import { fmtInt } from "../data/numeros";

type PopName = "olha" | "escolhe" | "guarda" | "compara" | "protege" | "mais" | "ajuda";
type Mark = "ok" | "no" | null;
const STEPS: PopName[] = ["olha", "escolhe", "guarda", "compara", "protege"];
const MAX_TOKENS = 3;
const STORAGE_KEY = "onde-pode-arder:palpites";
const BURNED = "recorrencia_a11y";
const RISK = "risco_2025";
/** grelha de 25 m (PT-TM06) das pistas e da faísca */
const G25 = gridFromManifest("g25");
/** grelha do mapa "onde ardeu" (a revelação corta colunas desta grelha) */
const BURNED_GRID = gridOfLayer(BURNED);
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const RISK_COLORS = ["#036403", "#88B302", "#FFFE06", "#FE9900", "#DD2203"];
const FLAME_PATH = "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z";

// Verões de 2001 a 2025 com mais de 5 ha ardidos no concelho; true = o mapa só com relevo
// (declive + exposição, 20 % do território) apanhou mais área ardida do que o acaso.
const SUMMERS: [number, boolean][] = [
  [2001, false], [2002, false], [2003, false], [2004, false], [2005, false], [2006, false], [2009, false],
  [2010, true], [2011, true], [2012, false], [2013, false], [2014, false], [2015, true], [2016, true],
  [2017, false], [2018, false], [2019, false], [2020, false], [2022, false], [2024, false], [2025, false],
];

// Biomassa (estudo DouroRisk) por anos desde o fogo; mato maduro = 40.
const REGROW: [number, number][] = [[0, 0], [2, 1.03], [5, 6.05], [10, 18.68]];

const PLEDGES: Record<string, string> = {
  limpar: "limpar o mato 50 m à volta da casa",
  pastorear: "apoiar quem põe cabras e ovelhas a pastar",
  queimadas: "não fazer queimadas com calor ou vento",
  "112": "ligar 112 se vir fumo",
  encontro: "saber onde é o ponto de encontro da aldeia",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function tokenSvg(n: number, mark: Mark = null): string {
  const badge =
    mark === "ok"
      ? `<circle cx='62' cy='18' r='15' fill='#296209' stroke='#ffffff' stroke-width='4'/><path d='M54 18l6 6 10-11' fill='none' stroke='#ffffff' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/>`
      : mark === "no"
        ? `<circle cx='62' cy='18' r='15' fill='#f7f3ea' stroke='#1c1c1c' stroke-width='4'/><path d='M56 12l12 12M68 12L56 24' stroke='#1c1c1c' stroke-width='5' stroke-linecap='round'/>`
        : "";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'>
    <circle cx='36' cy='44' r='27' fill='#ffffff' stroke='#1c1c1c' stroke-width='6'/>
    <circle cx='36' cy='44' r='20' fill='none' stroke='#681078' stroke-width='4'/>
    <text x='36' y='54' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-weight='700' font-size='28' fill='#1c1c1c'>${n}</text>${badge}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function sparkSvg(): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='#121417' stroke='#ffb000' stroke-width='1.6'/><path transform='translate(3.6 3.4) scale(0.7)' d='${FLAME_PATH}' fill='#ffb000'/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function windWords(kmh: number): string {
  if (kmh < 6) return "quase parado";
  if (kmh < 20) return "fraco";
  if (kmh < 40) return "moderado";
  if (kmh < 60) return "forte";
  return "muito forte";
}

function regrowAt(years: number): number {
  for (let i = 1; i < REGROW.length; i++) {
    const [y0, v0] = REGROW[i - 1];
    const [y1, v1] = REGROW[i];
    if (years <= y1) return v0 + ((years - y0) / (y1 - y0)) * (v1 - v0);
  }
  return REGROW[REGROW.length - 1][1];
}

export class VisitMode {
  private current: PopName | null = null;
  private openedAt = 0;
  private lastOpener: HTMLElement | null = null;
  private tokens: { lon: number; lat: number; graphic: Graphic }[] = [];
  private tokenLayer = new GraphicsLayer({ title: "Fichas do palpite", elevationInfo: { mode: "relative-to-ground" }, listMode: "hide" });
  private markLayer = new GraphicsLayer({ title: "Faísca e casa escolhida", listMode: "hide" });
  private sealed = false;
  private compared = false;
  private visited = new Set<PopName>();
  private certainty = 0;
  /** camada DouroRisk à vista (null = escondida): fonte única do estado */
  private visibleKey: string | null = null;
  private toastTimer: number | undefined;
  private fontStep = 0;
  private mapLegend: HTMLElement | null = null;
  private compareSeq = 0;
  private lastWeather: LiveWeatherReport | null = null;

  // 2 · pistas que se somam e fichas arrastáveis
  private cueKeys = new Set<string>();
  private cueOverlay: CanvasOverlay | null = null;
  private cueSeq = 0;
  private dragging: { token: { lon: number; lat: number; graphic: Graphic }; lon: number; lat: number } | null = null;
  private thermoTimer: number | undefined;
  private thermoSeq = 0;

  // 4 · revelação
  private revealOverlay: CanvasOverlay | null = null;
  private burnedFull: ImageData | null = null;
  private revealFrac = 0;
  private revealRaf = 0;
  /** classe de "quantas vezes ardeu" debaixo de cada ficha (null = ainda a ler) */
  private tokenHits: (number | null)[] = [];

  // 4 · faísca
  private sparkOverlay: CanvasOverlay | null = null;
  private sparkArmed = false;
  private sparkWind: "live" | number = "live";
  private spark: { lon: number; lat: number; result: SpreadResult; wind: number; from: number } | null = null;
  private sparkRaf = 0;

  // 5 · protege
  private house: { lon: number; lat: number; base: number } | null = null;
  private actions = new Set<string>();
  private years = 0;

  // Explorar: ponto ou círculo, a qualquer momento
  private probe: Probe;
  // Mapas de risco: escolher, ver e comparar
  private maps: MapsPanel | null = null;

  constructor(private manager: Alijo3DManager) {
    // em ecrãs estreitos o cartão do Explorar e a janela do passo não cabem os dois
    this.probe = new Probe(
      manager,
      (on) => {
        if (!on) return;
        this.maps?.setOpen(false); // os dois cartões ocupam o mesmo lugar
        if (!matchMedia("(min-width: 900px)").matches) this.close();
      },
      () => this.visibleKey,
    );
  }

  init(): void {
    const view = this.manager.view;
    if (view) {
      const map = view.map!;
      this.cueOverlay = new CanvasOverlay(map, "Pistas que se somam", G25, 0.85);
      this.revealOverlay = new CanvasOverlay(map, "Onde ardeu (revelação)", BURNED_GRID, 0.85);
      this.sparkOverlay = new CanvasOverlay(map, "Faísca (modelo simplificado)", G25, 0.9);
      map.addMany([this.markLayer, this.tokenLayer]);
      // as janelas do ArcGIS (freguesias com dados económicos) não fazem parte da visita
      view.popupEnabled = false;
      view.aria = { label: "Mapa 3D do concelho de Alijó", description: "Setas para mover o mapa. Teclas + e − para aproximar." };
      // espaço para a marca (topo) e para a barra (baixo): os widgets do mapa não ficam por baixo
      view.ui.padding = { top: 96, left: 16, right: 16, bottom: 146 };
      // sem duplicados: a cena já junta a sua bússola e o seletor de navegação;
      // os botões + e − ficam como alternativa a juntar e afastar os dedos
      // em ecrãs largos a janela abre à esquerda: os widgets passam para a direita
      const side = matchMedia("(min-width: 900px)").matches ? "top-right" : "top-left";
      view.ui.components = ["zoom"];
      if (side === "top-right") {
        // o zoom só existe depois de a vista estar pronta
        void view.when(() => view.ui.move([...view.ui.getComponents("top-left"), "zoom"], side));
      }
      view.on("click", (e) => void this.onMapClick(e).catch(() => this.say("Não foi possível ler o mapa. Toca outra vez.")));
      this.wireDrag();
      this.probe.init();
      this.maps = new MapsPanel(map, {
        current: () => this.visibleKey,
        show: (key, opacity) => this.setVisibleLayer(key, opacity),
        opened: () => {
          this.probe.setActive(false);
          if (!matchMedia("(min-width: 900px)").matches) this.close();
        },
        imageChanged: (key) => {
          if (key === BURNED) this.burnedFull = null;
          // a camada à vista num passo também passa a usar a imagem nova
          if (key === this.visibleKey && !this.maps?.open) this.manager.setDouroRiskModel(key);
        },
      });
      this.maps.init();
    }
    if (reduceMotion()) {
      this.manager.setWindVisible(false);
      const wt = $("wind-toggle") as any;
      if (wt) wt.checked = false;
    }
    // "Mais" (camadas e controlos técnicos) só aparece com ?tecnico no endereço
    if (TECNICO) {
      document.querySelectorAll<HTMLElement>(".tecnico-only").forEach((el) => (el.hidden = false));
    }
    this.mapLegend = document.createElement("div");
    this.mapLegend.className = "hud map-legend legend";
    this.mapLegend.hidden = true;
    document.body.appendChild(this.mapLegend);

    this.wireDock();
    this.wireTools();
    this.wireEscolhe();
    this.wireGuarda();
    this.wireCompara();
    this.wireSpark();
    this.wireProtege();
    this.renderTokenSlots();
    this.renderSummers();
    renderLegend($("burned-legend"), BURNED);
    renderLegend($("risk-legend"), RISK);
    this.setYears(0);
    this.renderHouse();
    this.restoreReadingPrefs();
    this.setupKiosk();
    this.updateNext();
    window.addEventListener("live-weather", (e) => this.renderWeather((e as CustomEvent<LiveWeatherReport>).detail));
    window.addEventListener("live-weather-error", () => {
      this.text($("weather-plain"), "Agora não foi possível saber o tempo.");
      this.text($("hud-30-sum"), "Sem ligação ao tempo do Pinhão.");
    });
    window.addEventListener("risk-layer", (e) => {
      const { key, visible } = (e as CustomEvent<{ key: string; visible: boolean }>).detail;
      this.visibleKey = visible ? key : null;
      this.syncLayerUI();
    });
    this.toast("Começa aqui: toca em 1 · Olha, na barra de baixo.");
    // as grelhas das pistas e da faísca demoram a ler: lê-las já, sem pressa, enquanto a visita começa
    window.setTimeout(() => void loadStack().catch(() => undefined), 5000);
  }

  // ------------------------------------------------------------------ janelas
  private wireDock(): void {
    document.querySelectorAll<HTMLElement>("[data-pop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.pop as PopName;
        // um duplo toque não fecha a janela que acabou de abrir
        if (this.current === name) {
          if (performance.now() - this.openedAt > 500) this.close();
        } else this.open(name, btn);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-goto]").forEach((btn) =>
      btn.addEventListener("click", () => this.open(btn.dataset.goto as PopName)),
    );
    document.querySelectorAll<HTMLElement>(".pop-close").forEach((btn) => btn.addEventListener("click", () => this.close()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.current) {
        this.close();
        return;
      }
      if (e.key === "Escape" && this.probe.active) {
        this.probe.setActive(false);
        return;
      }
      if (e.key === "Escape" && this.maps?.open) {
        this.maps.setOpen(false);
        return;
      }
      // atalhos 1 a 5: só com o foco na barra dos passos ou fora de qualquer controlo
      const a = document.activeElement as HTMLElement | null;
      const onDock = !!a?.closest?.(".dock");
      const free = !a || a === document.body;
      if ((onDock || free) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-5]$/.test(e.key)) {
        this.open(STEPS[Number(e.key) - 1]);
      }
    });
  }

  open(name: PopName, opener?: HTMLElement): void {
    if (this.current && this.current !== name) this.hide(this.current);
    if (!matchMedia("(min-width: 900px)").matches) {
      this.probe.setActive(false);
      this.maps?.setOpen(false);
    }
    const pop = $(`pop-${name}`);
    if (!pop) return;
    pop.hidden = false;
    this.current = name;
    this.openedAt = performance.now();
    this.visited.add(name);
    document.body.dataset.mode = name;
    this.manager.view?.closePopup();
    this.lastOpener = opener || document.querySelector<HTMLElement>(`.dock [data-pop="${name}"]`);
    document.querySelectorAll<HTMLElement>("[data-pop]").forEach((b) => {
      const on = b.dataset.pop === name;
      b.setAttribute("aria-expanded", String(on));
      b.classList.toggle("active", on);
    });
    const status = pop.querySelector(".pop-status");
    if (status) status.textContent = "";
    const q = pop.querySelector<HTMLElement>(".pop-q");
    if (q) {
      q.tabIndex = -1;
      q.focus({ preventScroll: true });
    }
    pop.querySelector(".pop-body")?.scrollTo({ top: 0 });
    this.layerForStep(name);
    if (name === "guarda") this.refreshGuarda();
    if (name === "compara") void this.refreshCompara();
    if (name === "escolhe" && this.sealed) this.say("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
    this.updateNext();
    this.syncLayerUI();
  }

  close(): void {
    if (!this.current) return;
    this.hide(this.current);
    this.current = null;
    delete document.body.dataset.mode;
    document.querySelectorAll<HTMLElement>("[data-pop]").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
      b.classList.remove("active");
    });
    this.setSparkArmed(false);
    this.hideThermo();
    this.lastOpener?.focus({ preventScroll: true });
    this.updateNext();
    this.syncLayerUI();
  }

  private hide(name: PopName): void {
    const pop = $(`pop-${name}`);
    if (pop) pop.hidden = true;
  }

  /** Mensagem curta: dentro da janela aberta (sem tapar o título) ou num aviso sobre o mapa. */
  say(msg: string): void {
    const status = this.current ? $(`pop-${this.current}`)?.querySelector<HTMLElement>(".pop-status") : null;
    if (status) {
      status.textContent = msg;
      return;
    }
    this.toast(msg);
  }

  toast(msg: string): void {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("show"), 5000 + msg.length * 60);
  }

  private text(el: HTMLElement | null, t: string): void {
    if (el) el.textContent = t;
  }

  /** Destaca na barra o passo seguinte sugerido. */
  private updateNext(): void {
    let next: PopName;
    if (!this.visited.has("olha") && !this.tokens.length && !this.sealed) next = "olha";
    else if (this.tokens.length < MAX_TOKENS && !this.sealed) next = "escolhe";
    else if (!this.sealed) next = "guarda";
    else if (!this.compared) next = "compara";
    else next = "protege";
    document.querySelectorAll<HTMLElement>(".dock-btn[data-step]").forEach((b) => {
      const on = b.dataset.pop === next && this.current !== next;
      b.classList.toggle("next", on);
      if (on) b.setAttribute("aria-description", "Passo seguinte sugerido");
      else b.removeAttribute("aria-description");
    });
  }

  // ------------------------------------------------------------------ camada à vista (fonte única)
  private setVisibleLayer(key: string | null, opacity = 0.8): void {
    this.visibleKey = key;
    if (key) {
      this.manager.setDouroRiskModel(key);
      this.manager.setDouroRiskOpacity(opacity);
      this.manager.setDouroRiskVisible(true);
      const sld = $("dourorisk-opacity-slider") as any;
      if (sld) sld.value = Math.round(opacity * 100);
      this.text($("dourorisk-opacity-label"), `${Math.round(opacity * 100)}%`);
    } else {
      this.manager.setDouroRiskVisible(false);
    }
    this.syncLayerUI();
  }

  /** Acerta todos os sítios que mostram o estado das camadas. */
  private syncLayerUI(): void {
    const key = this.visibleKey;
    document.querySelectorAll<HTMLButtonElement>(".cue").forEach((b) => b.setAttribute("aria-pressed", String(this.cueKeys.has(b.dataset.cue!))));
    const hideBtn = $("btn-hide-cue");
    if (hideBtn) hideBtn.hidden = !this.cueKeys.size;
    this.renderCountLegend($("cue-legend"));
    $("btn-show-burned")?.setAttribute("aria-pressed", String(this.revealFrac >= 1));
    this.text($("btn-show-burned"), this.revealFrac >= 1 ? "Esconder onde ardeu" : "Revelar onde ardeu");
    const sel = $("dourorisk-model-select") as any;
    const tog = $("dourorisk-toggle") as any;
    if (sel && key) sel.value = key;
    if (tog) tog.checked = !!key;
    renderLegend($("dourorisk-stats-items"), key || sel?.value || RISK);
    this.maps?.external(key);
    // sem janela aberta, a cor no mapa nunca fica sem legenda
    if (this.mapLegend) {
      const cues = !key && this.cueKeys.size > 0 && !!this.cueOverlay?.visible;
      const show = (!!key || cues) && !this.current;
      this.mapLegend.hidden = !show;
      if (show) {
        if (key) renderLegend(this.mapLegend, key);
        else this.renderCountLegend(this.mapLegend);
      }
    }
  }

  /** Cada passo mostra as camadas que lhe pertencem: a legenda à vista corresponde sempre ao mapa. */
  private layerForStep(name: PopName): void {
    const key = this.visibleKey;
    const keepCues = name === "escolhe" || name === "guarda";
    if (!keepCues && this.cueKeys.size) this.clearCues();
    if (name !== "escolhe") this.hideThermo();
    if (name !== "compara") {
      this.revealOverlay?.hide();
      this.stopSpark(true);
    }
    if (name !== "protege") this.markLayer.removeMany(this.markLayer.graphics.filter((g) => g.attributes?.kind === "house").toArray());
    if (name === "olha") this.setVisibleLayer(null);
    else if (keepCues) {
      if (key) this.setVisibleLayer(null);
    } else if (name === "compara") {
      if (this.revealFrac >= 1) this.setVisibleLayer(BURNED, 0.85);
      else {
        this.setVisibleLayer(null);
        if (this.revealFrac > 0) void this.drawReveal(this.revealFrac);
      }
    } else if (name === "protege") {
      this.setVisibleLayer(RISK, 0.7);
      this.drawHouse();
    }
  }

  // ------------------------------------------------------------------ clique no mapa (e alternativa por teclado)
  private async onMapClick(e: ClickEvent): Promise<void> {
    // com o Explorar ligado, tocar no mapa lê sempre os dados desse ponto (em qualquer passo)
    if (this.probe.active) {
      e.stopPropagation();
      if (e.mapPoint) this.probe.handleClick(e.mapPoint.longitude ?? 0, e.mapPoint.latitude ?? 0);
      return;
    }
    const mode = this.current;
    if (mode !== "escolhe" && mode !== "compara" && mode !== "protege") return;
    e.stopPropagation();
    const pt = e.mapPoint;
    if (!pt) return;
    if (mode === "escolhe" && !this.sealed) {
      const hit = await this.manager.view!.hitTest(e, { include: [this.tokenLayer] });
      const g = hit.results.find((r) => r.type === "graphic")?.graphic as Graphic | undefined;
      if (g) {
        this.removeToken(g);
        return;
      }
    }
    if (mode === "compara" && this.sparkArmed) {
      await this.ignite(pt.longitude ?? 0, pt.latitude ?? 0);
      return;
    }
    await this.readAt(mode, pt.longitude ?? 0, pt.latitude ?? 0);
  }

  /** Ponto do terreno ao centro do ecrã (alternativa ao toque, para quem usa teclado). */
  private centerPoint(): { lon: number; lat: number } | null {
    const view = this.manager.view;
    if (!view) return null;
    const pt = view.toMap({ x: view.width / 2, y: view.height / 2 });
    if (!pt) {
      this.say("O centro do ecrã não está sobre o terreno. Move o mapa e tenta outra vez.");
      return null;
    }
    return { lon: pt.longitude ?? 0, lat: pt.latitude ?? 0 };
  }

  private async readCenter(mode: "escolhe" | "compara" | "protege"): Promise<void> {
    const c = this.centerPoint();
    if (c) await this.readAt(mode, c.lon, c.lat);
  }

  private async readAt(mode: "escolhe" | "compara" | "protege", lon: number, lat: number): Promise<void> {
    if (mode === "escolhe") {
      if (this.sealed) {
        this.say("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
        return;
      }
      if (this.tokens.length >= MAX_TOKENS) {
        this.say("Já tens 3 fichas. Arrasta uma para a mudar, ou toca numa para a tirar.");
        return;
      }
      // só dentro do concelho (a grelha de risco cobre exatamente o concelho de Alijó)
      const inside = await VISIT_LAYERS[RISK].grid.sample(lon, lat, 0);
      if (this.current !== "escolhe" || this.sealed || this.tokens.length >= MAX_TOKENS) return;
      if (inside <= 0) {
        this.say("Põe a ficha dentro do concelho de Alijó.");
        return;
      }
      const t = this.addToken(lon, lat);
      void this.showThermo(t);
      return;
    }

    if (mode === "compara") {
      if (!this.sealed) {
        this.say("Primeiro guarda o palpite no passo 3.");
        return;
      }
      const layer = VISIT_LAYERS[BURNED];
      if (this.revealFrac < 1) {
        this.say("Primeiro revela onde ardeu.");
        return;
      }
      const cls = await layer.grid.sample(lon, lat, 1);
      this.say(cls === NO_DATA ? "Aqui não há dados." : cls > 0 ? layer.describe(cls) : layer.empty);
      return;
    }

    // protege: escolher a casa e ler o risco à volta (a cor nunca fica sozinha)
    const cls = await VISIT_LAYERS[RISK].grid.sample(lon, lat, 2);
    if (cls <= 0) {
      this.say("Aqui não há dados de risco. Toca numa casa dentro do concelho.");
      return;
    }
    this.house = { lon, lat, base: cls };
    this.drawHouse();
    this.renderHouse();
  }

  // ------------------------------------------------------------------ 2 · Escolhe: pistas que se somam
  private wireEscolhe(): void {
    $("btn-clear-tokens")?.addEventListener("click", () => {
      if (this.sealed) {
        this.say("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
        return;
      }
      this.clearTokens();
    });
    $("btn-token-center")?.addEventListener("click", () => void this.readCenter("escolhe"));
    document.querySelectorAll<HTMLButtonElement>(".cue").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.cue!;
        if (this.cueKeys.has(key)) this.cueKeys.delete(key);
        else this.cueKeys.add(key);
        void this.refreshCues();
      });
    });
    $("btn-hide-cue")?.addEventListener("click", () => {
      this.clearCues();
      document.querySelector<HTMLButtonElement>(".cue")?.focus(); // o botão desaparece: o foco volta às pistas
    });
  }

  private clearCues(): void {
    this.cueKeys.clear();
    this.cueSeq++;
    this.cueOverlay?.hide();
    this.text($("cue-point"), "");
    this.syncLayerUI();
  }

  private async refreshCues(): Promise<void> {
    const seq = ++this.cueSeq;
    const keys = [...this.cueKeys];
    this.syncLayerUI();
    if (!keys.length) {
      this.cueOverlay?.hide();
      this.text($("cue-point"), "");
      return;
    }
    this.text($("cue-point"), "A preparar o mapa…");
    try {
      const img = await renderCueCount(keys);
      if (seq !== this.cueSeq) return;
      this.cueOverlay?.draw(img);
      this.text(
        $("cue-point"),
        keys.length > 1
          ? `As cores mais escuras mostram onde se juntam mais pistas. Põe ou arrasta uma ficha para medir.`
          : "Liga mais uma pista para ver onde se juntam.",
      );
    } catch {
      if (seq === this.cueSeq) this.text($("cue-point"), "Não foi possível ler as pistas. Tenta outra vez.");
    }
    this.syncLayerUI();
  }

  /** Legenda das pistas: cor + número de pistas + chamas (nunca só a cor). */
  private renderCountLegend(el: HTMLElement | null): void {
    if (!el) return;
    const n = this.cueKeys.size;
    if (!n) {
      el.innerHTML = "";
      return;
    }
    const flame = `<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="${FLAME_PATH}"/></svg>`;
    const rows = Array.from({ length: n }, (_, i) => {
      const k = i + 1;
      const dark = k >= 3;
      const stripes = k >= 3 ? " striped" : "";
      return `<li><span class="sw${dark ? " dark" : ""}${stripes}" style="background-color:${COUNT_COLORS[i]}">${k}</span><span class="lg-label">${k === 1 ? "1 pista" : `${k} pistas juntas`}</span><span class="flames" aria-hidden="true">${flame.repeat(k)}</span></li>`;
    }).join("");
    el.innerHTML = `<p class="lg-title">Onde se juntam as pistas ligadas</p><ul>${rows}</ul>`;
  }

  /** Termómetro ao lado da ficha: quantas das pistas ligadas valem naquele sítio. */
  private async showThermo(t: { lon: number; lat: number; graphic: Graphic }, keep = false): Promise<void> {
    const seq = ++this.thermoSeq;
    const n = this.tokens.indexOf(t) + 1;
    const keys = [...this.cueKeys];
    const here = keys.length ? await cuesAt(keys, t.lon, t.lat) : [];
    if (seq !== this.thermoSeq || this.current !== "escolhe") return;
    let msg: string;
    let frac = 0;
    if (!keys.length) msg = "Liga uma pista para medir este sítio.";
    else if (!here) msg = "Fora do concelho.";
    else {
      frac = here.length / keys.length;
      msg = here.length
        ? `${here.length} de ${keys.length} pistas aqui: ${here.map((c) => c.short).join(", ")}.`
        : `Nenhuma das ${keys.length} pistas aqui.`;
    }
    this.text($("cue-point"), `Ficha ${n}: ${msg}`);
    const box = $("thermo");
    const view = this.manager.view;
    if (!box || !view) return;
    const sp = view.toScreen(new Point({ longitude: t.lon, latitude: t.lat }));
    if (!sp) return;
    this.text($("thermo-title"), `Ficha ${n}`);
    this.text($("thermo-text"), msg);
    const fill = $("thermo-fill");
    if (fill) fill.style.height = `${Math.round(frac * 100)}%`;
    box.hidden = false;
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, sp.x + 44))}px`;
    box.style.top = `${Math.min(innerHeight - h - 8, Math.max(8, sp.y - h - 30))}px`;
    window.clearTimeout(this.thermoTimer);
    if (!keep) this.thermoTimer = window.setTimeout(() => box && (box.hidden = true), 4500);
  }

  private hideThermo(): void {
    this.thermoSeq++;
    window.clearTimeout(this.thermoTimer);
    const box = $("thermo");
    if (box) box.hidden = true;
  }

  /** Arrastar uma ficha no mapa (passo 2, antes de guardar). */
  private wireDrag(): void {
    const view = this.manager.view!;
    view.on("pointer-down", async (e) => {
      this.dragging = null;
      if (this.probe.active || this.current !== "escolhe" || this.sealed || !this.tokens.length) return;
      const hit = await view.hitTest(e, { include: [this.tokenLayer] });
      const g = hit.results.find((r) => r.type === "graphic")?.graphic as Graphic | undefined;
      const token = g && this.tokens.find((t) => t.graphic === g);
      if (token) this.dragging = { token, lon: token.lon, lat: token.lat };
    });
    let last = 0;
    view.on("drag", (e) => {
      const d = this.dragging;
      if (!d) return;
      e.stopPropagation(); // o mapa não se mexe enquanto a ficha é arrastada
      const pt = view.toMap({ x: e.x, y: e.y });
      if (pt) {
        d.token.lon = pt.longitude ?? d.token.lon;
        d.token.lat = pt.latitude ?? d.token.lat;
        d.token.graphic.geometry = new Point({ longitude: d.token.lon, latitude: d.token.lat });
        const now = performance.now();
        if (now - last > 120 || e.action === "end") {
          last = now;
          void this.showThermo(d.token, e.action !== "end");
        }
      }
      if (e.action === "end") {
        this.dragging = null;
        void this.commitDrag(d);
      }
    });
  }

  private async commitDrag(d: { token: { lon: number; lat: number; graphic: Graphic }; lon: number; lat: number }): Promise<void> {
    const inside = await VISIT_LAYERS[RISK].grid.sample(d.token.lon, d.token.lat, 0);
    if (inside > 0) return;
    d.token.lon = d.lon;
    d.token.lat = d.lat;
    d.token.graphic.geometry = new Point({ longitude: d.lon, latitude: d.lat });
    this.say("A ficha tem de ficar dentro do concelho de Alijó. Voltou para onde estava.");
  }

  private clearTokens(): void {
    this.tokenLayer.removeAll();
    this.tokens = [];
    this.tokenHits = [];
    this.renderTokenSlots();
  }

  private addToken(lon: number, lat: number): { lon: number; lat: number; graphic: Graphic } {
    const n = this.tokens.length + 1;
    const graphic = new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat }),
      attributes: { n },
      symbol: new PointSymbol3D({
        symbolLayers: [new IconSymbol3DLayer({ resource: { href: tokenSvg(n) }, size: 50, anchor: "center" })],
        verticalOffset: { screenLength: 46, maxWorldLength: 600, minWorldLength: 30 },
        callout: new LineCallout3D({ size: 2, color: [28, 28, 28], border: { color: [255, 255, 255] } }),
      }),
    });
    this.tokenLayer.add(graphic);
    const t = { lon, lat, graphic };
    this.tokens.push(t);
    this.renderTokenSlots();
    return t;
  }

  private setTokenIcon(i: number, mark: Mark): void {
    const t = this.tokens[i];
    if (!t || t.graphic.attributes?.mark === mark) return;
    t.graphic.attributes = { ...t.graphic.attributes, mark };
    const sym = (t.graphic.symbol as PointSymbol3D).clone();
    (sym.symbolLayers.getItemAt(0) as IconSymbol3DLayer).resource = { href: tokenSvg(i + 1, mark) };
    t.graphic.symbol = sym;
  }

  private removeToken(g: Graphic): void {
    this.tokenLayer.remove(g);
    this.tokens = this.tokens.filter((t) => t.graphic !== g);
    // renumerar
    this.tokens.forEach((t, i) => {
      t.graphic.attributes = { n: i + 1, mark: "renumerar" };
      this.setTokenIcon(i, null);
    });
    this.renderTokenSlots();
  }

  private renderTokenSlots(): void {
    const slots = $("token-slots");
    if (slots) {
      slots.innerHTML = Array.from({ length: MAX_TOKENS }, (_, i) =>
        `<span class="slot${i < this.tokens.length ? " on" : ""}">${i + 1}</span>`,
      ).join("");
    }
    this.text($("token-count"), `Fichas no mapa: ${this.tokens.length} de ${MAX_TOKENS}`);
    if (this.tokens.length === MAX_TOKENS && this.current === "escolhe") {
      this.say("Já tens 3 fichas. Podes arrastá-las. Quando quiseres, vai ao passo 3 · Guarda.");
    }
    this.updateNext();
  }

  // ------------------------------------------------------------------ 3 · Guarda
  private faces(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>(".face"));
  }

  private wireGuarda(): void {
    const faces = this.faces();
    const choose = (b: HTMLButtonElement) => {
      this.certainty = Number(b.dataset.certeza);
      faces.forEach((f) => {
        f.setAttribute("aria-checked", String(f === b));
        f.tabIndex = f === b ? 0 : -1;
      });
      const err = $("faces-error");
      if (err) err.hidden = true;
    };
    faces.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => choose(b));
      b.addEventListener("keydown", (e) => {
        const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        let j: number | null = null;
        if (e.key in moves) j = (i + moves[e.key] + faces.length) % faces.length;
        if (e.key === "Home") j = 0;
        if (e.key === "End") j = faces.length - 1;
        if (j !== null) {
          e.preventDefault();
          faces[j].focus();
          choose(faces[j]);
        }
      });
    });
    $("btn-save-guess")?.addEventListener("click", () => void this.saveGuess());
    $("btn-new-guess")?.addEventListener("click", () => {
      this.resetGuess();
      this.open("escolhe");
    });
  }

  private resetGuess(): void {
    this.sealed = false;
    this.compared = false;
    this.certainty = 0;
    this.faces().forEach((f, i) => {
      f.setAttribute("aria-checked", "false");
      f.tabIndex = i === 0 ? 0 : -1;
    });
    this.clearTokens();
    this.setReveal(0);
    this.refreshGuarda();
    this.updateNext();
  }

  private refreshGuarda(): void {
    const need = $("guard-need");
    const form = $("guard-form");
    const sealedBox = $("guard-sealed");
    if (need) need.hidden = this.sealed || this.tokens.length === MAX_TOKENS;
    if (form) form.hidden = this.sealed || this.tokens.length < MAX_TOKENS;
    if (sealedBox) sealedBox.hidden = !this.sealed;
  }

  private async saveGuess(): Promise<void> {
    if (this.tokens.length < MAX_TOKENS) {
      this.say("Primeiro põe 3 fichas no mapa.");
      return;
    }
    if (!this.certainty) {
      const err = $("faces-error");
      if (err) err.hidden = false;
      this.faces()[0]?.focus();
      return;
    }
    const turma = (($("turma-input") as HTMLInputElement | null)?.value || "").trim().slice(0, 20);
    const guess = {
      turma,
      certeza: this.certainty,
      fichas: this.tokens.map((t) => [Number(t.lon.toFixed(5)), Number(t.lat.toFixed(5))]),
      data: new Date().toISOString(),
    };
    const code = await this.fingerprint(JSON.stringify(guess));
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      all.push({ ...guess, codigo: code });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-200)));
    } catch {
      /* o palpite fica válido nesta sessão mesmo sem armazenamento */
    }
    this.sealed = true;
    this.text($("guess-code"), code);
    const words = ["", "pouca", "alguma", "muita"][this.certainty];
    const when = new Date(guess.data).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    this.text($("guess-summary"), `${turma ? `Turma ${turma}. ` : ""}3 fichas, ${words} certeza. ${when}.`);
    this.refreshGuarda();
    this.updateNext();
    $("sealed-title")?.focus(); // o formulário (com o botão focado) desaparece
    this.say(`Palpite guardado. Código ${code}.`);
  }

  private async fingerprint(text: string): Promise<string> {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    } catch {
      // sem contexto seguro (ex.: http por IP local) não há crypto.subtle, mas há getRandomValues
      bytes = crypto.getRandomValues(new Uint8Array(6));
    }
    return Array.from(bytes.slice(0, 6), (b) => alphabet[b % alphabet.length]).join("");
  }

  // ------------------------------------------------------------------ 4 · Compara: revelação animada
  private wireCompara(): void {
    $("btn-show-burned")?.addEventListener("click", () => {
      if (!this.sealed) {
        this.say("Primeiro guarda o palpite no passo 3.");
        return;
      }
      if (this.revealFrac >= 1) this.setReveal(0);
      else this.animateReveal();
    });
    $("reveal-range")?.addEventListener("input", (e) => {
      if (!this.sealed) return;
      cancelAnimationFrame(this.revealRaf);
      this.setReveal(Number((e.target as HTMLInputElement).value) / 100);
    });
    $("btn-read-burned")?.addEventListener("click", () => void this.readCenter("compara"));
  }

  private async loadBurnedImage(): Promise<ImageData> {
    if (this.burnedFull) return this.burnedFull;
    const img = await loadImage(DOURORISK_MODELS[BURNED].image);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    this.burnedFull = ctx.getImageData(0, 0, c.width, c.height);
    return this.burnedFull;
  }

  /** Cortina de oeste para este: só a parte já passada mostra onde ardeu. */
  private async drawReveal(frac: number): Promise<void> {
    let full: ImageData;
    try {
      full = await this.loadBurnedImage();
    } catch {
      return;
    }
    if (this.current !== "compara" || this.revealFrac !== frac) return;
    const { width: w, height: h } = full;
    const cut = Math.round(frac * w);
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      out.data.set(full.data.subarray(row, row + cut * 4), row);
      // linha clara na ponta da cortina
      for (let x = Math.max(0, cut - 2); x < Math.min(w, cut + 2); x++) {
        const o = row + x * 4;
        out.data[o] = 247; out.data[o + 1] = 243; out.data[o + 2] = 234; out.data[o + 3] = 255;
      }
    }
    this.revealOverlay?.draw(out);
  }

  private setReveal(frac: number): void {
    this.revealFrac = Math.max(0, Math.min(1, frac));
    const range = $<HTMLInputElement>("reveal-range");
    if (range) range.value = String(Math.round(this.revealFrac * 100));
    if (this.revealFrac >= 1) {
      this.revealOverlay?.hide();
      if (this.current === "compara") this.setVisibleLayer(BURNED, 0.85);
      if (!this.compared) {
        this.compared = true;
        this.updateNext();
      }
    } else {
      if (this.visibleKey === BURNED) this.setVisibleLayer(null);
      if (this.revealFrac > 0 && this.current === "compara") void this.drawReveal(this.revealFrac);
      else this.revealOverlay?.hide();
    }
    this.renderScore();
    this.syncLayerUI();
  }

  private animateReveal(): void {
    cancelAnimationFrame(this.revealRaf);
    if (reduceMotion()) {
      this.setReveal(1);
      return;
    }
    const t0 = performance.now();
    let lastDraw = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 2600);
      const eased = 1 - Math.pow(1 - p, 3);
      if ((now - lastDraw > 60 && !this.revealOverlay?.busy) || p >= 1) {
        lastDraw = now;
        this.setReveal(eased);
      }
      if (p < 1 && this.current === "compara") this.revealRaf = requestAnimationFrame(step);
    };
    this.revealRaf = requestAnimationFrame(step);
  }

  /** A ficha já foi passada pela cortina? */
  private tokenRevealed(i: number): boolean {
    const t = this.tokens[i];
    if (!t) return false;
    // a cortina corta colunas da grelha do mapa "onde ardeu": a ficha conta pela sua coluna real
    const x = pixelOf(BURNED_GRID, t.lon, t.lat).x / BURNED_GRID.width;
    return this.revealFrac >= 1 || x <= this.revealFrac;
  }

  private async refreshCompara(): Promise<void> {
    const need = $("compare-need");
    const openBox = $("compare-open");
    if (need) need.hidden = this.sealed;
    if (openBox) openBox.hidden = !this.sealed;
    if (!this.sealed) return;
    const seq = ++this.compareSeq;
    const tokens = [...this.tokens];
    const layer = VISIT_LAYERS[BURNED];
    const hits: (number | null)[] = [];
    for (const t of tokens) {
      // raio de 1 célula (cerca de 25 m) à volta do centro da ficha
      hits.push(await layer.grid.sample(t.lon, t.lat, 1));
      if (seq !== this.compareSeq) return; // houve um pedido mais recente
    }
    this.tokenHits = hits;
    this.renderScore();
  }

  /** Placar, lista e sinais ✓/✗ nas fichas do mapa, conforme a cortina avança. */
  private renderScore(): void {
    const marks = $("score-marks");
    const list = $("token-results");
    const layer = VISIT_LAYERS[BURNED];
    let shown = 0;
    let hits = 0;
    const markHtml: string[] = [];
    const items: string[] = [];
    this.tokens.forEach((_, i) => {
      const cls = this.tokenHits[i];
      const seen = this.sealed && this.tokenRevealed(i) && cls != null;
      const ok = seen && cls! > 0;
      this.setTokenIcon(i, seen ? (ok ? "ok" : "no") : null);
      if (!seen) {
        markHtml.push(`<span class="sm hidden">?</span>`);
        items.push(`<li><span class="mark" aria-hidden="true">?</span><span><strong>Ficha ${i + 1}:</strong> ainda escondida.</span></li>`);
        return;
      }
      shown++;
      if (ok) hits++;
      const txt = cls === NO_DATA ? "sem dados" : ok ? layer.describe(cls!).replace("Aqui ardeu", "ardeu") : `não ardeu de ${A0} a ${A1}`;
      markHtml.push(ok ? `<span class="sm ok">✓</span>` : `<span class="sm no">✗</span>`);
      items.push(
        `<li class="${ok ? "ok" : "no"}"><span class="mark" aria-hidden="true">${ok ? "✓" : "✗"}</span><span><strong>Ficha ${i + 1}:</strong> ${txt}</span></li>`,
      );
    });
    if (marks) marks.innerHTML = markHtml.join("");
    if (list) list.innerHTML = this.tokens.length ? items.join("") : "<li>Ainda não puseste fichas. Vai ao passo 2.</li>";
    const total = this.tokens.length;
    this.text(
      $("score-text"),
      !total
        ? "Sem fichas."
        : shown < total
          ? this.revealFrac > 0
            ? "A revelar…"
            : "Carrega em Revelar."
          : hits === 0
            ? `Nenhuma das ${total} fichas caiu onde já ardeu.`
            : `${hits} das ${total} fichas ${hits === 1 ? "caiu" : "caíram"} onde já ardeu.`,
    );
  }

  private renderSummers(): void {
    const el = $("summers");
    if (!el) return;
    el.innerHTML = SUMMERS.map(
      ([y, win]) => `<span class="summer${win ? " win" : ""}" title="${y}${win ? ": acertou" : ""}">${win ? "✓" : ""}</span>`,
    ).join("");
  }

  private renderWeather(w: LiveWeatherReport): void {
    this.lastWeather = w;
    const rain = $("rain-toggle") as any;
    if (rain) rain.checked = w.isRaining;
    const ok = (v: number) => Number.isFinite(v);
    const t = Math.round(w.temperature);
    const v = Math.round(w.windSpeed);
    const h = Math.round(w.humidity);
    const parts = [
      ok(w.temperature) ? `${t} °C` : "temperatura sem dados",
      ok(w.windSpeed) ? `vento ${windWords(v)} (${v} km/h) que vem de ${rumo(w.windDirection)}` : "vento sem dados",
    ];
    this.text($("weather-plain"), `Agora em ${w.stationName}: ${parts.join(", ")}. ${w.description}.`);
    const rules = [
      { id: "dial-temp", has: ok(w.temperature), on: w.temperature > 30, value: `${t} °C`, frac: w.temperature / 45, text: `Calor: mais de 30 °C (hoje ${ok(w.temperature) ? `${t} °C` : "sem dados"})` },
      { id: "dial-hum", has: ok(w.humidity), on: w.humidity < 30, value: `${h} %`, frac: 1 - w.humidity / 100, text: `Ar seco: humidade abaixo de 30 % (hoje ${ok(w.humidity) ? `${h} %` : "sem dados"})` },
      { id: "dial-wind", has: ok(w.windSpeed), on: w.windSpeed > 30, value: `${v} km/h`, frac: w.windSpeed / 60, text: `Vento: mais de 30 km/h (hoje ${ok(w.windSpeed) ? `${v} km/h` : "sem dados"})` },
    ];
    const missing = rules.some((r) => !r.has);
    const count = rules.filter((r) => r.has && r.on).length;
    const list = $("rule30");
    if (list) {
      list.innerHTML =
        rules.map((r) => `<li class="${r.has && r.on ? "on" : ""}"><span class="mark" aria-hidden="true">${r.has && r.on ? "!" : "–"}</span>${r.text}</li>`).join("") +
        `<li class="sum">${missing ? "Faltam dados para saber se hoje cumpre a regra 30-30-30." : count === 3 ? "Hoje cumpre a regra 30-30-30: é um dia muito perigoso para incêndios." : "Hoje não cumpre a regra 30-30-30."}</li>`;
    }
    // mostradores sempre à vista
    for (const r of rules) {
      const li = $(r.id);
      if (!li) continue;
      li.classList.toggle("on", r.has && r.on);
      li.querySelector("strong")!.textContent = r.has ? r.value : "–";
      const arc = li.querySelector<SVGPathElement>(".arc");
      if (arc) arc.style.strokeDasharray = `${Math.round(82 * Math.max(0.04, Math.min(1, r.has ? r.frac : 0)))} 200`;
    }
    const sums = [
      "O tempo de agora ajuda a evitar fogos.",
      "1 de 3: atenção ao fogo.",
      "2 de 3: dia perigoso.",
      "3 de 3: dia muito perigoso. Nada de fogo!",
    ];
    this.text($("hud-30-sum"), missing ? "Faltam dados do tempo." : sums[count]);
    $("hud-30")?.classList.toggle("alert", !missing && count >= 2);
    const liveChip = document.querySelector<HTMLElement>('[data-wind="live"]');
    if (liveChip) liveChip.textContent = ok(w.windSpeed) ? `Vento de agora (${v} km/h)` : "Vento de agora";
  }

  // ------------------------------------------------------------------ 4 · E se uma faísca caísse hoje?
  private wireSpark(): void {
    $("btn-spark")?.addEventListener("click", () => {
      this.setSparkArmed(!this.sparkArmed);
      if (this.sparkArmed) this.say("Toca no mapa onde a faísca cai.");
    });
    $("btn-spark-center")?.addEventListener("click", () => {
      const c = this.centerPoint();
      if (c) void this.ignite(c.lon, c.lat);
    });
    document.querySelectorAll<HTMLButtonElement>("[data-wind]").forEach((b) =>
      b.addEventListener("click", () => {
        this.sparkWind = b.dataset.wind === "live" ? "live" : Number(b.dataset.wind);
        document.querySelectorAll<HTMLButtonElement>("[data-wind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        if (this.spark) void this.ignite(this.spark.lon, this.spark.lat);
      }),
    );
    $("btn-spark-replay")?.addEventListener("click", () => this.spark && this.playSpark());
    $("btn-spark-clear")?.addEventListener("click", () => this.stopSpark(true));
  }

  private setSparkArmed(on: boolean): void {
    this.sparkArmed = on;
    $("btn-spark")?.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("spark-armed", on);
  }

  private windForSpark(): { wind: number; from: number } {
    const w = this.lastWeather;
    const liveSpeed = w && Number.isFinite(w.windSpeed) ? w.windSpeed : 10;
    // sem medição, o vento de verão mais comum no Douro vem de noroeste
    const from = w && Number.isFinite(w.windDirection) ? w.windDirection : 315;
    return { wind: this.sparkWind === "live" ? liveSpeed : this.sparkWind, from };
  }

  private async ignite(lon: number, lat: number): Promise<void> {
    this.setSparkArmed(false);
    const { wind, from } = this.windForSpark();
    this.text($("spark-text"), "A calcular…");
    const box = $("spark-box");
    if (box) box.hidden = false;
    let result: SpreadResult | null;
    try {
      result = await simulateSpread(lon, lat, wind, from);
    } catch {
      this.say("Não foi possível ler o mapa. Tenta outra vez.");
      return;
    }
    if (!result) {
      if (box) box.hidden = true;
      this.say("Acende a faísca dentro do concelho de Alijó.");
      return;
    }
    this.spark = { lon, lat, result, wind, from };
    this.markLayer.removeMany(this.markLayer.graphics.filter((g) => g.attributes?.kind === "spark").toArray());
    this.markLayer.add(
      new Graphic({
        geometry: new Point({ longitude: lon, latitude: lat }),
        attributes: { kind: "spark" },
        symbol: new PointSymbol3D({
          symbolLayers: [new IconSymbol3DLayer({ resource: { href: sparkSvg() }, size: 34, anchor: "center" })],
          verticalOffset: { screenLength: 30, maxWorldLength: 400, minWorldLength: 20 },
          callout: new LineCallout3D({ size: 1.5, color: [255, 176, 0] }),
        }),
      }),
    );
    this.playSpark();
  }

  private playSpark(): void {
    const s = this.spark;
    if (!s) return;
    cancelAnimationFrame(this.sparkRaf);
    const dur = reduceMotion() ? 0 : 9000;
    const t0 = performance.now();
    let lastDraw = 0;
    const step = (now: number) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1;
      if ((now - lastDraw > 90 && !this.sparkOverlay?.busy) || p >= 1) {
        lastDraw = now;
        const { image, cells } = renderSpread(s.result, p * s.result.end);
        this.sparkOverlay?.draw(image);
        const fill = $("spark-fill");
        if (fill) fill.style.width = `${Math.round(p * 100)}%`;
        const ha = cells * HA_PER_CELL;
        const fields = fmtInt(ha / HA_PER_FIELD);
        if (p < 1) this.text($("spark-text"), `O fogo está a andar… já ardeu o mesmo que ${fields} campos de futebol.`);
        else this.text($("spark-text"), this.sparkSummary(s, ha));
      }
      if (p < 1 && this.current === "compara") this.sparkRaf = requestAnimationFrame(step);
    };
    this.sparkRaf = requestAnimationFrame(step);
  }

  private sparkSummary(s: { result: SpreadResult; lon: number; lat: number; wind: number; from: number }, ha: number): string {
    // para onde foi o fogo: do ponto da faísca ao centro da área ardida
    const r = s.result;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < r.time.length; i++) {
      if (r.time[i] === Infinity) continue;
      sx += i % r.width;
      sy += (i / r.width) | 0;
      n++;
    }
    // a faísca em píxeis da simulação (a grelha de 25 m agrupada em células de 50 m)
    const p = pixelOf(G25, s.lon, s.lat);
    const cx = (p.x / G25.width) * r.width, cy = (p.y / G25.height) * r.height;
    const dx = n ? sx / n - cx : 0, dy = n ? sy / n - cy : 0;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const dir = Math.hypot(dx, dy) < 3 ? "todos os lados" : rumo(deg);
    // espaço que não parte nos milhares («4 028»), como no Explorar (toLocaleString pt-PT não separa 4 algarismos)
    const fields = fmtInt(ha / HA_PER_FIELD);
    const windTxt = s.wind < 3 ? "Sem vento" : `Com vento ${windWords(s.wind)} de ${rumo(s.from)}`;
    return `${windTxt}, o fogo foi sobretudo para ${dir} e queimou o mesmo que ${fields} campos de futebol (${fmtInt(ha)} ha).`;
  }

  private stopSpark(clear: boolean): void {
    cancelAnimationFrame(this.sparkRaf);
    this.setSparkArmed(false);
    if (!clear) return;
    this.spark = null;
    this.sparkOverlay?.hide();
    this.markLayer.removeMany(this.markLayer.graphics.filter((g) => g.attributes?.kind === "spark").toArray());
    const box = $("spark-box");
    if (box) box.hidden = true;
  }

  // ------------------------------------------------------------------ 5 · Protege
  private wireProtege(): void {
    $("btn-see-sanfins")?.addEventListener("click", () => {
      this.manager.goToPreset("sanfins");
      window.dispatchEvent(new CustomEvent("orbit-stopped"));
      this.manager.setSanfinsBuildingsVisible(true);
      const bt = $("buildings-toggle") as any;
      if (bt) bt.checked = true;
      this.setVisibleLayer(RISK, 0.7);
      this.say("Toca numa casa no mapa.");
    });
    $("btn-read-risk")?.addEventListener("click", () => void this.readCenter("protege"));
    document.querySelectorAll<HTMLButtonElement>(".tile[data-action]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = b.dataset.action!;
        if (this.actions.has(a)) this.actions.delete(a);
        else this.actions.add(a);
        b.setAttribute("aria-pressed", String(this.actions.has(a)));
        this.renderHouse();
        this.drawHouse();
      }),
    );
    $("regrow-range")?.addEventListener("input", (e) => this.setYears(Number((e.target as HTMLInputElement).value)));
  }

  private setYears(years: number): void {
    this.years = years;
    const range = $<HTMLInputElement>("regrow-range");
    if (range && Number(range.value) !== years) range.value = String(years);
    this.text($("regrow-years"), years === 1 ? "1 ano" : `${years} anos`);
    const v = regrowAt(years);
    const fill = $("regrow-fill");
    if (fill) fill.style.width = `${(v / 40) * 100}%`;
    const words =
      years === 0
        ? "Acabado de limpar: quase não há mato."
        : years < 4
          ? "Ainda há pouco mato."
          : years < 8
            ? "O mato já está a voltar."
            : "O mato voltou a quase metade. É preciso limpar outra vez.";
    this.text($("regrow-text"), `${words} (Contas do estudo DouroRisk.)`);
    this.renderHouse();
    this.drawHouse();
  }

  /** Conta simples para aprender: limpar e pastorear baixam o risco à volta da casa; o mato que volta sobe-o outra vez. */
  private houseRisk(): number {
    if (!this.house) return 0;
    let r = this.house.base;
    if (this.actions.has("limpar")) r -= this.years < 4 ? 2 : this.years < 8 ? 1 : 0;
    if (this.actions.has("pastorear")) r -= 1;
    return Math.max(1, Math.min(5, r));
  }

  private renderHouse(): void {
    const box = $("house-risk");
    const chosen = [...this.actions].map((a) => PLEDGES[a]).filter(Boolean);
    const list = new Intl.ListFormat("pt-PT", { type: "conjunction" });
    this.text($("pledge"), chosen.length ? `Eu vou ${list.format(chosen)}.` : "");
    if (!box) return;
    if (!this.house) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const r = this.houseRisk();
    const base = this.house.base;
    const num = $("house-risk-num");
    if (num) {
      num.textContent = String(r);
      num.style.background = RISK_COLORS[r - 1];
      num.classList.toggle("dark", r === 1 || r === 5);
    }
    this.text($("house-risk-word"), `Risco à volta da casa: ${r} · ${RISK_WORDS[r - 1]}`);
    const changes = this.actions.has("limpar") || this.actions.has("pastorear");
    this.text(
      $("risk-point"),
      !changes
        ? `Hoje é ${base} (${RISK_WORDS[base - 1]}). Escolhe uma ação.`
        : r < base
          ? `Era ${base} (${RISK_WORDS[base - 1]}). Com o que escolheste, baixa para ${r}. Conta simples para aprender.`
          : `Era ${base}. O mato voltou: o risco subiu outra vez. Limpar é todos os anos.`,
    );
  }

  /** Anel de 50 m à volta da casa escolhida: verde quando limpo, âmbar quando o mato volta. */
  private drawHouse(): void {
    this.markLayer.removeMany(this.markLayer.graphics.filter((g) => g.attributes?.kind === "house").toArray());
    if (!this.house || this.current !== "protege") return;
    const clean = this.actions.has("limpar");
    const color: [number, number, number] = !clean ? [247, 243, 234] : this.years < 4 ? [123, 209, 72] : this.years < 8 ? [255, 176, 0] : [238, 90, 26];
    this.markLayer.add(
      new Graphic({
        geometry: new Circle({ center: new Point({ longitude: this.house.lon, latitude: this.house.lat }), radius: 50, radiusUnit: "meters", geodesic: true, numberOfPoints: 72 }),
        attributes: { kind: "house" },
        symbol: new SimpleFillSymbol({
          color: [...color, clean ? 0.55 : 0.15],
          outline: { color: [...color, 1], width: 4, style: clean ? "solid" : "dash" },
        }),
      }),
    );
  }

  // ------------------------------------------------------------------ leitura: letra, contraste
  private wireTools(): void {
    $("btn-font")?.addEventListener("click", () => {
      this.fontStep = (this.fontStep + 1) % 3;
      this.applyFont();
      this.say(["Letra normal.", "Letra maior.", "Letra muito maior."][this.fontStep]);
    });
    $("btn-contrast")?.addEventListener("click", () => {
      const on = !document.body.classList.contains("hc");
      document.body.classList.toggle("hc", on);
      $("btn-contrast")?.setAttribute("aria-pressed", String(on));
      this.store("hc", on ? "1" : "0");
    });
  }

  private applyFont(): void {
    document.documentElement.style.setProperty("--ui-scale", ["1", "1.2", "1.4"][this.fontStep]);
    this.probe.fitPadding(); // o cartão do Explorar cresce com a letra: os botões do mapa afastam-se dele
    const label = `A+, tamanho da letra: ${["normal", "maior", "muito maior"][this.fontStep]}. Carrega para mudar.`;
    $("btn-font")?.setAttribute("aria-label", label);
    $("btn-font")?.setAttribute("title", label);
    this.store("font", String(this.fontStep));
  }

  private restoreReadingPrefs(): void {
    this.fontStep = Number(this.read("font") || 0) % 3;
    this.applyFont();
    if (this.read("hc") === "1") {
      document.body.classList.add("hc");
      $("btn-contrast")?.setAttribute("aria-pressed", "true");
    }
  }

  private store(k: string, v: string): void {
    try {
      localStorage.setItem(`onde-pode-arder:${k}`, v);
    } catch {
      /* sem armazenamento: as preferências valem só nesta sessão */
    }
  }

  private read(k: string): string | null {
    try {
      return localStorage.getItem(`onde-pode-arder:${k}`);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ quiosque: aviso e recomeço sem uso
  private resetVisit(): void {
    this.close();
    this.probe.reset();
    this.maps?.reset();
    // rede de segurança: nenhum «Como sabemos?» fica aberto para a pessoa seguinte
    document.querySelectorAll<HTMLDetailsElement>("details.probe-how").forEach((d) => (d.open = false));
    this.resetGuess();
    this.visited.clear();
    this.clearCues();
    this.stopSpark(true);
    this.sparkWind = "live";
    document.querySelectorAll<HTMLButtonElement>("[data-wind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.wind === "live")));
    this.setVisibleLayer(null);
    const turma = $("turma-input") as HTMLInputElement | null;
    if (turma) turma.value = "";
    this.actions.clear();
    document.querySelectorAll<HTMLElement>(".tile[data-action]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    this.house = null;
    this.drawHouse();
    ["cue-point"].forEach((id) => this.text($(id), ""));
    this.setYears(0);
    // a pessoa seguinte começa com a letra e o contraste normais
    this.fontStep = 0;
    this.applyFont();
    document.body.classList.remove("hc");
    $("btn-contrast")?.setAttribute("aria-pressed", "false");
    this.store("hc", "0");
    this.manager.goToPreset("general");
    window.dispatchEvent(new CustomEvent("orbit-stopped"));
    this.updateNext();
    this.toast("Bem-vindo. Começa em 1 · Olha, na barra de baixo.");
  }

  private setupKiosk(): void {
    if (!new URLSearchParams(location.search).has("quiosque")) return;
    // no quiosque não se sai da app: a apresentação não tem recomeço automático
    $("btn-home")?.setAttribute("hidden", "");
    const brand = document.querySelector<HTMLAnchorElement>(".hud-brand a");
    brand?.removeAttribute("href");
    brand?.removeAttribute("title");
    const warn = $("idle-warn");
    let idle: number | undefined;
    let final: number | undefined;
    const arm = () => {
      window.clearTimeout(idle);
      window.clearTimeout(final);
      if (warn) warn.hidden = true;
      idle = window.setTimeout(() => {
        // 20 s de aviso, com um botão para continuar (WCAG 2.2.1)
        if (warn) warn.hidden = false;
        $("btn-idle-continue")?.focus();
        final = window.setTimeout(() => {
          if (warn) warn.hidden = true;
          this.resetVisit();
          arm();
        }, 20_000);
      }, 120_000);
    };
    $("btn-idle-continue")?.addEventListener("click", arm);
    const activity = () => {
      if (!warn || warn.hidden) arm();
    };
    ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focusin"].forEach((ev) =>
      window.addEventListener(ev, activity, { passive: true }),
    );
    window.addEventListener("scroll", activity, { capture: true, passive: true });
    arm();
  }
}
