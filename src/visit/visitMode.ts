// Modo Visita "Onde pode arder?": mapa em ecrã inteiro, barra de 5 passos e janelas flutuantes.
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import LineCallout3D from "@arcgis/core/symbols/callouts/LineCallout3D.js";
import type { Alijo3DManager } from "../alijo3d/alijoScene";
import type { LiveWeatherReport } from "../alijo3d/weatherService";
import type { ClickEvent } from "@arcgis/core/views/input/types.js";
import { VISIT_LAYERS, renderLegend } from "./layers";
import { NO_DATA } from "./sampler";

type PopName = "olha" | "escolhe" | "guarda" | "compara" | "protege" | "mais" | "ajuda";
const STEPS: PopName[] = ["olha", "escolhe", "guarda", "compara", "protege"];
const MAX_TOKENS = 3;
const STORAGE_KEY = "onde-pode-arder:palpites";
const BURNED = "recorrencia_a11y";
const RISK = "risco_2025";
/** Pistas do passo 2. Nenhuma mostra onde ardeu: isso é a resposta do passo 4. */
const CUES = ["declive_a11y", "exposicao_sol", "biomassa_2025", "icnf_estrutural"];
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Verões de 2001 a 2025 com mais de 5 ha ardidos no concelho; true = o mapa só com relevo
// (declive + exposição, 20 % do território) apanhou mais área ardida do que o acaso.
const SUMMERS: [number, boolean][] = [
  [2001, false], [2002, false], [2003, false], [2004, false], [2005, false], [2006, false], [2009, false],
  [2010, true], [2011, true], [2012, false], [2013, false], [2014, false], [2015, true], [2016, true],
  [2017, false], [2018, false], [2019, false], [2020, false], [2022, false], [2024, false], [2025, false],
];

// Biomassa (estudo DouroRisk) por anos desde o fogo; mato maduro = 40.
const REGROW: Record<number, { value: number; text: string }> = {
  0: { value: 0, text: "Logo a seguir ao fogo, quase não há mato." },
  2: { value: 1.03, text: "2 anos depois do fogo, há muito pouco mato." },
  5: { value: 6.05, text: "5 anos depois do fogo, o mato já volta a crescer." },
  10: { value: 18.68, text: "10 anos depois do fogo, o mato volta a quase metade." },
};

const PLEDGES: Record<string, string> = {
  limpar: "limpar o mato à volta da casa",
  queimadas: "não fazer queimadas com calor ou vento",
  "112": "ligar 112 se vir fumo",
  encontro: "saber onde é o ponto de encontro da aldeia",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function tokenSvg(n: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'>
    <circle cx='32' cy='32' r='27' fill='#ffffff' stroke='#1c1c1c' stroke-width='6'/>
    <circle cx='32' cy='32' r='20' fill='none' stroke='#681078' stroke-width='4'/>
    <text x='32' y='42' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-weight='700' font-size='28' fill='#1c1c1c'>${n}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function windWords(kmh: number): string {
  if (kmh < 6) return "quase parado";
  if (kmh < 20) return "fraco";
  if (kmh < 40) return "moderado";
  if (kmh < 60) return "forte";
  return "muito forte";
}

function windFrom(deg: number): string {
  const names = ["norte", "nordeste", "nascente", "sudeste", "sul", "sudoeste", "poente", "noroeste"];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export class VisitMode {
  private current: PopName | null = null;
  private openedAt = 0;
  private lastOpener: HTMLElement | null = null;
  private tokens: { lon: number; lat: number; graphic: Graphic }[] = [];
  private tokenLayer = new GraphicsLayer({ title: "Fichas do palpite", elevationInfo: { mode: "relative-to-ground" }, listMode: "hide" });
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

  constructor(private manager: Alijo3DManager) {}

  init(): void {
    const view = this.manager.view;
    if (view) {
      view.map?.add(this.tokenLayer);
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
    }
    if (reduceMotion()) {
      this.manager.setWindVisible(false);
      const wt = $("wind-toggle") as any;
      if (wt) wt.checked = false;
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
    this.wireProtege();
    this.renderTokenSlots();
    this.renderSummers();
    renderLegend($("burned-legend"), BURNED);
    renderLegend($("risk-legend"), RISK);
    this.setRegrow(10);
    this.restoreReadingPrefs();
    this.setupKiosk();
    this.updateNext();
    window.addEventListener("live-weather", (e) => this.renderWeather((e as CustomEvent<LiveWeatherReport>).detail));
    window.addEventListener("live-weather-error", () => this.text($("weather-plain"), "Agora não foi possível saber o tempo."));
    window.addEventListener("risk-layer", (e) => {
      const { key, visible } = (e as CustomEvent<{ key: string; visible: boolean }>).detail;
      this.visibleKey = visible ? key : null;
      this.syncLayerUI();
    });
    this.toast("Começa aqui: toca em 1 · Olha, na barra de baixo.");
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

  /** Acerta todos os sítios que mostram o estado da camada. */
  private syncLayerUI(): void {
    const key = this.visibleKey;
    document.querySelectorAll<HTMLButtonElement>(".cue").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cue === key)));
    const isCue = !!key && CUES.includes(key);
    const hideBtn = $("btn-hide-cue");
    if (hideBtn) hideBtn.hidden = !isCue;
    renderLegend($("cue-legend"), isCue ? key! : "");
    $("btn-show-burned")?.setAttribute("aria-pressed", String(key === BURNED));
    const sel = $("dourorisk-model-select") as any;
    const tog = $("dourorisk-toggle") as any;
    if (sel && key) sel.value = key;
    if (tog) tog.checked = !!key;
    renderLegend($("dourorisk-stats-items"), key || sel?.value || RISK);
    // sem janela aberta, a cor no mapa nunca fica sem legenda
    if (this.mapLegend) {
      const show = !!key && !this.current;
      this.mapLegend.hidden = !show;
      if (show) renderLegend(this.mapLegend, key!);
    }
  }

  /** Cada passo mostra a camada que lhe pertence: a legenda à vista corresponde sempre ao mapa. */
  private layerForStep(name: PopName): void {
    const key = this.visibleKey;
    if (name === "olha") this.setVisibleLayer(null);
    else if (name === "escolhe" || name === "guarda") {
      if (key && !CUES.includes(key)) this.setVisibleLayer(null);
    } else if (name === "compara") {
      if (key !== BURNED) this.setVisibleLayer(null);
    } else if (name === "protege") this.setVisibleLayer(RISK, 0.7);
  }

  // ------------------------------------------------------------------ clique no mapa (e alternativa por teclado)
  private async onMapClick(e: ClickEvent): Promise<void> {
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
    await this.readAt(mode, pt.longitude ?? 0, pt.latitude ?? 0);
  }

  /** Lê o centro do mapa: a mesma ação do toque, para quem usa teclado. */
  private async readCenter(mode: "escolhe" | "compara" | "protege"): Promise<void> {
    const view = this.manager.view;
    if (!view) return;
    const pt = view.toMap({ x: view.width / 2, y: view.height / 2 });
    if (!pt) {
      this.say("O centro do ecrã não está sobre o terreno. Move o mapa e tenta outra vez.");
      return;
    }
    await this.readAt(mode, pt.longitude ?? 0, pt.latitude ?? 0);
  }

  private async readAt(mode: "escolhe" | "compara" | "protege", lon: number, lat: number): Promise<void> {
    if (mode === "escolhe") {
      if (this.sealed) {
        this.say("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
        return;
      }
      if (this.tokens.length >= MAX_TOKENS) {
        this.say("Já tens 3 fichas. Toca numa ficha para a tirar.");
        return;
      }
      // só dentro do concelho (a grelha de risco cobre exatamente o concelho de Alijó)
      const inside = await VISIT_LAYERS[RISK].grid.sample(lon, lat, 0);
      if (this.current !== "escolhe" || this.sealed || this.tokens.length >= MAX_TOKENS) return;
      if (inside <= 0) {
        this.say("Põe a ficha dentro do concelho de Alijó.");
        return;
      }
      this.addToken(lon, lat);
      const n = this.tokens.length;
      const key = this.visibleKey;
      if (key && CUES.includes(key)) {
        const layer = VISIT_LAYERS[key];
        const cls = await layer.grid.sample(lon, lat, 1);
        this.text($("cue-point"), `Ficha ${n}: ${cls > 0 ? layer.describe(cls) : layer.empty}`);
      }
      return;
    }

    if (mode === "compara") {
      if (!this.sealed) {
        this.say("Primeiro guarda o palpite no passo 3.");
        return;
      }
      const layer = VISIT_LAYERS[BURNED];
      const cls = await layer.grid.sample(lon, lat, 1);
      this.say(cls === NO_DATA ? "Aqui não há dados." : cls > 0 ? layer.describe(cls) : layer.empty);
      return;
    }

    // protege: ler o risco no ponto (a cor nunca fica sozinha)
    const cls = await VISIT_LAYERS[RISK].grid.sample(lon, lat, 2);
    this.text($("risk-point"), cls > 0 ? VISIT_LAYERS[RISK].describe(cls) : "Aqui não há dados de risco. Toca dentro do concelho.");
  }

  // ------------------------------------------------------------------ 2 · Escolhe
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
        const on = this.visibleKey === key;
        this.setVisibleLayer(on ? null : key, 0.8);
        this.text($("cue-point"), on ? "" : "Toca no mapa para pôr uma ficha e saber como é esse sítio.");
      });
    });
    $("btn-hide-cue")?.addEventListener("click", () => {
      const was = document.querySelector<HTMLButtonElement>(`.cue[data-cue="${this.visibleKey}"]`);
      this.setVisibleLayer(null);
      this.text($("cue-point"), "");
      was?.focus(); // o botão "Esconder" desaparece: o foco volta à pista
    });
  }

  private clearTokens(): void {
    this.tokenLayer.removeAll();
    this.tokens = [];
    this.renderTokenSlots();
  }

  private addToken(lon: number, lat: number): void {
    const n = this.tokens.length + 1;
    const graphic = new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat }),
      attributes: { n },
      symbol: new PointSymbol3D({
        symbolLayers: [new IconSymbol3DLayer({ resource: { href: tokenSvg(n) }, size: 40, anchor: "center" })],
        verticalOffset: { screenLength: 46, maxWorldLength: 600, minWorldLength: 30 },
        callout: new LineCallout3D({ size: 2, color: [28, 28, 28], border: { color: [255, 255, 255] } }),
      }),
    });
    this.tokenLayer.add(graphic);
    this.tokens.push({ lon, lat, graphic });
    this.renderTokenSlots();
  }

  private removeToken(g: Graphic): void {
    this.tokenLayer.remove(g);
    this.tokens = this.tokens.filter((t) => t.graphic !== g);
    // renumerar
    this.tokens.forEach((t, i) => {
      const sym = (t.graphic.symbol as PointSymbol3D).clone();
      (sym.symbolLayers.getItemAt(0) as IconSymbol3DLayer).resource = { href: tokenSvg(i + 1) };
      t.graphic.symbol = sym;
      t.graphic.attributes = { n: i + 1 };
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
      this.say("Já tens 3 fichas. Quando quiseres, vai ao passo 3 · Guarda.");
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

  // ------------------------------------------------------------------ 4 · Compara
  private wireCompara(): void {
    $("btn-show-burned")?.addEventListener("click", () => {
      if (!this.sealed) {
        this.say("Primeiro guarda o palpite no passo 3.");
        return;
      }
      this.setVisibleLayer(this.visibleKey === BURNED ? null : BURNED, 0.85);
      if (this.visibleKey === BURNED) {
        this.compared = true;
        this.updateNext();
      }
    });
    $("btn-read-burned")?.addEventListener("click", () => void this.readCenter("compara"));
  }

  private async refreshCompara(): Promise<void> {
    const need = $("compare-need");
    const openBox = $("compare-open");
    if (need) need.hidden = this.sealed;
    if (openBox) openBox.hidden = !this.sealed;
    const list = $("token-results");
    if (!list || !this.sealed) return;
    const seq = ++this.compareSeq;
    const tokens = [...this.tokens];
    const layer = VISIT_LAYERS[BURNED];
    let hits = 0;
    const items: string[] = [];
    for (const [i, t] of tokens.entries()) {
      // raio de 1 célula (cerca de 25 m) à volta do centro da ficha
      const cls = await layer.grid.sample(t.lon, t.lat, 1);
      if (seq !== this.compareSeq) return; // houve um pedido mais recente
      if (cls > 0) hits++;
      const txt = cls === NO_DATA ? "sem dados" : cls > 0 ? layer.describe(cls).replace("Aqui ardeu", "ardeu") : "não ardeu desde 1990";
      items.push(
        `<li class="${cls > 0 ? "ok" : "no"}"><span class="mark" aria-hidden="true">${cls > 0 ? "✓" : "✗"}</span><span><strong>Ficha ${i + 1}:</strong> ${txt}</span></li>`,
      );
    }
    const total = tokens.length;
    items.push(`<li class="sum"><strong>${hits} de ${total} ${total === 1 ? "ficha ficou" : "fichas ficaram"} em zona que já ardeu.</strong></li>`);
    list.innerHTML = items.join("");
  }

  private renderSummers(): void {
    const el = $("summers");
    if (!el) return;
    el.innerHTML = SUMMERS.map(
      ([y, win]) => `<span class="summer${win ? " win" : ""}" title="${y}${win ? ": acertou" : ""}">${win ? "✓" : ""}</span>`,
    ).join("");
  }

  private renderWeather(w: LiveWeatherReport): void {
    const rain = $("rain-toggle") as any;
    if (rain) rain.checked = w.isRaining;
    const ok = (v: number) => Number.isFinite(v);
    const t = Math.round(w.temperature);
    const v = Math.round(w.windSpeed);
    const h = Math.round(w.humidity);
    const parts = [
      ok(w.temperature) ? `${t} °C` : "temperatura sem dados",
      ok(w.windSpeed) ? `vento ${windWords(v)} (${v} km/h) que vem de ${windFrom(w.windDirection)}` : "vento sem dados",
    ];
    this.text($("weather-plain"), `Agora em ${w.stationName}: ${parts.join(", ")}. ${w.description}.`);
    const rules = [
      { has: ok(w.temperature), on: w.temperature > 30, text: `Calor: mais de 30 °C (hoje ${ok(w.temperature) ? `${t} °C` : "sem dados"})` },
      { has: ok(w.humidity), on: w.humidity < 30, text: `Ar seco: humidade abaixo de 30 % (hoje ${ok(w.humidity) ? `${h} %` : "sem dados"})` },
      { has: ok(w.windSpeed), on: w.windSpeed > 30, text: `Vento: mais de 30 km/h (hoje ${ok(w.windSpeed) ? `${v} km/h` : "sem dados"})` },
    ];
    const missing = rules.some((r) => !r.has);
    const all = rules.every((r) => r.has && r.on);
    const list = $("rule30");
    if (list) {
      list.innerHTML =
        rules.map((r) => `<li class="${r.has && r.on ? "on" : ""}"><span class="mark" aria-hidden="true">${r.has && r.on ? "!" : "–"}</span>${r.text}</li>`).join("") +
        `<li class="sum">${missing ? "Faltam dados para saber se hoje cumpre a regra 30-30-30." : all ? "Hoje cumpre a regra 30-30-30: é um dia muito perigoso para incêndios." : "Hoje não cumpre a regra 30-30-30."}</li>`;
    }
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
      this.text($("risk-point"), "Toca no mapa para saber o risco de incêndio nesse sítio.");
    });
    $("btn-read-risk")?.addEventListener("click", () => void this.readCenter("protege"));
    document.querySelectorAll<HTMLButtonElement>(".regrow .chip").forEach((b) =>
      b.addEventListener("click", () => this.setRegrow(Number(b.dataset.years))),
    );
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(".actions input"));
    const list = new Intl.ListFormat("pt-PT", { type: "conjunction" });
    boxes.forEach((cb) =>
      cb.addEventListener("change", () => {
        const chosen = boxes.filter((b) => b.checked).map((b) => PLEDGES[b.value]);
        this.text($("pledge"), chosen.length ? `Eu vou ${list.format(chosen)}.` : "");
      }),
    );
  }

  private setRegrow(years: number): void {
    const r = REGROW[years];
    if (!r) return;
    document.querySelectorAll<HTMLButtonElement>(".regrow .chip").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.years) === years)));
    const fill = $("regrow-fill");
    if (fill) fill.style.width = `${(r.value / 40) * 100}%`;
    this.text($("regrow-text"), `${r.text} São contas do estudo DouroRisk.`);
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
    this.resetGuess();
    this.visited.clear();
    this.setVisibleLayer(null);
    const turma = $("turma-input") as HTMLInputElement | null;
    if (turma) turma.value = "";
    document.querySelectorAll<HTMLInputElement>(".actions input").forEach((b) => (b.checked = false));
    ["pledge", "cue-point", "risk-point"].forEach((id) => this.text($(id), ""));
    this.setRegrow(10);
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
