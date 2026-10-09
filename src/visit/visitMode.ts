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

type PopName = "olha" | "escolhe" | "guarda" | "compara" | "protege" | "mais" | "ajuda";
const STEPS: PopName[] = ["olha", "escolhe", "guarda", "compara", "protege"];
const MAX_TOKENS = 3;
const STORAGE_KEY = "onde-pode-arder:palpites";

// Verões de 2001 a 2025 com mais de 5 ha ardidos no concelho; true = o mapa só com relevo
// (declive + exposição, 20 % do território) apanhou mais área ardida do que o acaso.
const SUMMERS: [number, boolean][] = [
  [2001, false], [2002, false], [2003, false], [2004, false], [2005, false], [2006, false], [2009, false],
  [2010, true], [2011, true], [2012, false], [2013, false], [2014, false], [2015, true], [2016, true],
  [2017, false], [2018, false], [2019, false], [2020, false], [2022, false], [2024, false], [2025, false],
];

// Biomassa (modelo DouroRisk) por anos desde o fogo; maduro = 40.
const REGROW: Record<number, { value: number; text: string }> = {
  0: { value: 0, text: "Logo a seguir ao fogo, quase não há mato." },
  2: { value: 1.03, text: "2 anos depois do fogo, há muito pouco mato: 1 em 40." },
  5: { value: 6.05, text: "5 anos depois do fogo, o mato já volta a crescer: 6 em 40." },
  10: { value: 18.68, text: "10 anos depois do fogo, o mato volta a quase metade: 19 em 40." },
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
  private lastOpener: HTMLElement | null = null;
  private tokens: { lon: number; lat: number; graphic: Graphic }[] = [];
  private tokenLayer = new GraphicsLayer({ title: "Fichas do palpite", elevationInfo: { mode: "relative-to-ground" }, listMode: "hide" });
  private sealed = false;
  private certainty = 0;
  private activeCue: string | null = null;
  private burnedShown = false;
  private toastTimer: number | undefined;
  private fontStep = 0;

  constructor(private manager: Alijo3DManager) {}

  init(): void {
    const view = this.manager.view;
    if (view) {
      view.map?.add(this.tokenLayer);
      // espaço para a marca (topo) e para a barra (baixo): os widgets do mapa não ficam por baixo
      view.ui.padding = { top: 96, left: 16, right: 16, bottom: 146 };
      // sem duplicados: a cena já junta a sua bússola e o seletor de navegação;
      // os botões + e − ficam como alternativa a juntar e afastar os dedos
      view.ui.components = ["zoom"];
      view.on("click", (e) => this.onMapClick(e));
    }
    this.wireDock();
    this.wireTools();
    this.wireEscolhe();
    this.wireGuarda();
    this.wireCompara();
    this.wireProtege();
    this.renderTokenSlots();
    this.renderSummers();
    renderLegend($("burned-legend"), "recorrencia_a11y");
    renderLegend($("risk-legend"), "risco_2025");
    this.setRegrow(10);
    this.restoreReadingPrefs();
    this.setupKiosk();
    window.addEventListener("live-weather", (e) => this.renderWeather((e as CustomEvent<LiveWeatherReport>).detail));
    this.toast("Começa aqui: toca em 1 · Olha, na barra de baixo.");
  }

  // ------------------------------------------------------------------ janelas
  private wireDock(): void {
    document.querySelectorAll<HTMLElement>("[data-pop]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.pop as PopName;
        if (this.current === name) this.close();
        else this.open(name, btn);
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
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName.startsWith("CALCITE-");
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-5]$/.test(e.key)) {
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
    document.body.dataset.mode = name;
    this.lastOpener = opener || document.querySelector<HTMLElement>(`.dock [data-pop="${name}"]`);
    document.querySelectorAll<HTMLElement>("[data-pop]").forEach((b) => {
      const on = b.dataset.pop === name;
      b.setAttribute("aria-expanded", String(on));
      b.classList.toggle("active", on);
    });
    const q = pop.querySelector<HTMLElement>(".pop-q");
    if (q) {
      q.tabIndex = -1;
      q.focus({ preventScroll: true });
    }
    pop.querySelector(".pop-body")?.scrollTo({ top: 0 });
    if (name === "guarda") this.refreshGuarda();
    if (name === "compara") void this.refreshCompara();
    if (name === "escolhe" && this.sealed) this.toast("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
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
  }

  private hide(name: PopName): void {
    const pop = $(`pop-${name}`);
    if (pop) pop.hidden = true;
  }

  toast(msg: string): void {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("show"), 5000);
  }

  // ------------------------------------------------------------------ clique no mapa
  private async onMapClick(e: ClickEvent): Promise<void> {
    const mode = this.current;
    if (mode !== "escolhe" && mode !== "compara" && mode !== "protege") return;
    e.stopPropagation();
    const pt = e.mapPoint;
    if (!pt) return;
    const lon = pt.longitude ?? 0;
    const lat = pt.latitude ?? 0;

    if (mode === "escolhe") {
      if (this.sealed) {
        this.toast("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
        return;
      }
      const hit = await this.manager.view!.hitTest(e, { include: [this.tokenLayer] });
      const g = hit.results.find((r) => r.type === "graphic")?.graphic as Graphic | undefined;
      if (g) {
        this.removeToken(g);
        return;
      }
      if (this.tokens.length >= MAX_TOKENS) {
        this.toast("Já tens 3 fichas. Toca numa ficha para a tirar.");
        return;
      }
      this.addToken(lon, lat);
      if (this.activeCue) {
        const layer = VISIT_LAYERS[this.activeCue];
        const cls = await layer.grid.sample(lon, lat, 1);
        this.say($("cue-point"), `Ficha ${this.tokens.length}: ${cls ? layer.describe(cls) : layer.empty}`);
      }
      return;
    }

    if (mode === "compara") {
      const cls = await VISIT_LAYERS.recorrencia_a11y.grid.sample(lon, lat, 1);
      this.toast(cls ? VISIT_LAYERS.recorrencia_a11y.describe(cls) : VISIT_LAYERS.recorrencia_a11y.empty);
      return;
    }

    // protege: ler o risco no ponto (a cor nunca fica sozinha)
    const cls = await VISIT_LAYERS.risco_2025.grid.sample(lon, lat, 2);
    this.say($("risk-point"), cls ? VISIT_LAYERS.risco_2025.describe(cls) : "Aqui não há dados de risco. Toca dentro do concelho.");
  }

  private say(el: HTMLElement | null, text: string): void {
    if (el) el.textContent = text;
  }

  // ------------------------------------------------------------------ 2 · Escolhe
  private wireEscolhe(): void {
    $("btn-clear-tokens")?.addEventListener("click", () => {
      if (this.sealed) {
        this.toast("O palpite já está guardado. Para mudar, faz um novo palpite no passo 3.");
        return;
      }
      this.tokenLayer.removeAll();
      this.tokens = [];
      this.renderTokenSlots();
    });
    document.querySelectorAll<HTMLButtonElement>(".cue").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.cue!;
        this.setCue(this.activeCue === key ? null : key);
      });
    });
    $("btn-hide-cue")?.addEventListener("click", () => this.setCue(null));
  }

  private setCue(key: string | null): void {
    this.activeCue = key;
    this.burnedShown = key === "recorrencia_a11y";
    document.querySelectorAll<HTMLButtonElement>(".cue").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cue === key)));
    const hideBtn = $("btn-hide-cue");
    if (hideBtn) hideBtn.hidden = !key;
    this.say($("cue-point"), key ? "Toca no mapa para pôr uma ficha e saber como é esse sítio." : "");
    if (key) {
      this.showLayer(key, 0.8);
      renderLegend($("cue-legend"), key);
    } else {
      this.hideLayer();
      renderLegend($("cue-legend"), "");
    }
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
    this.say($("token-count"), `Fichas no mapa: ${this.tokens.length} de ${MAX_TOKENS}`);
    if (this.tokens.length === MAX_TOKENS && this.current === "escolhe") {
      this.toast("Já tens 3 fichas. Quando quiseres, vai ao passo 3 · Guarda.");
    }
  }

  // ------------------------------------------------------------------ 3 · Guarda
  private wireGuarda(): void {
    const faces = Array.from(document.querySelectorAll<HTMLButtonElement>(".face"));
    const choose = (b: HTMLButtonElement) => {
      this.certainty = Number(b.dataset.certeza);
      faces.forEach((f) => {
        f.setAttribute("aria-checked", String(f === b));
        f.tabIndex = f === b ? 0 : -1;
      });
    };
    faces.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", () => choose(b));
      b.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const next = faces[(i + (e.key === "ArrowRight" ? 1 : faces.length - 1)) % faces.length];
          next.focus();
          choose(next);
        }
      });
    });
    $("btn-save-guess")?.addEventListener("click", () => void this.saveGuess());
    $("btn-new-guess")?.addEventListener("click", () => {
      this.sealed = false;
      this.certainty = 0;
      faces.forEach((f) => f.setAttribute("aria-checked", "false"));
      this.tokenLayer.removeAll();
      this.tokens = [];
      this.renderTokenSlots();
      this.refreshGuarda();
      this.open("escolhe");
    });
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
      this.toast("Primeiro põe 3 fichas no mapa.");
      return;
    }
    if (!this.certainty) {
      this.toast("Escolhe uma cara: pouca, alguma ou muita certeza.");
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
    this.say($("guess-code"), code);
    const words = ["", "pouca", "alguma", "muita"][this.certainty];
    const when = new Date(guess.data).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    this.say($("guess-summary"), `${turma ? `Turma ${turma}. ` : ""}3 fichas, ${words} certeza. ${when}.`);
    this.refreshGuarda();
    this.toast(`Palpite guardado. Código ${code}.`);
  }

  private async fingerprint(text: string): Promise<string> {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    } catch {
      bytes = new TextEncoder().encode(text + Date.now());
    }
    return Array.from(bytes.slice(0, 6), (b) => alphabet[b % alphabet.length]).join("");
  }

  // ------------------------------------------------------------------ 4 · Compara
  private wireCompara(): void {
    $("btn-show-burned")?.addEventListener("click", () => {
      if (this.burnedShown) {
        this.burnedShown = false;
        this.hideLayer();
      } else {
        this.burnedShown = true;
        this.activeCue = null;
        this.showLayer("recorrencia_a11y", 0.85);
      }
      this.syncBurnedBtn();
    });
  }

  private syncBurnedBtn(): void {
    const b = $("btn-show-burned");
    if (!b) return;
    b.setAttribute("aria-pressed", String(this.burnedShown));
    b.textContent = this.burnedShown ? "Esconder onde ardeu" : "Mostrar onde ardeu";
  }

  private async refreshCompara(): Promise<void> {
    this.syncBurnedBtn();
    const list = $("token-results");
    if (!list) return;
    if (!this.tokens.length) {
      list.innerHTML = "<li>Ainda não puseste fichas. Vai ao passo 2.</li>";
      return;
    }
    const grid = VISIT_LAYERS.recorrencia_a11y.grid;
    let hits = 0;
    const items: string[] = [];
    for (const [i, t] of this.tokens.entries()) {
      // raio de 1 célula (cerca de 25 m) à volta do centro da ficha
      const cls = await grid.sample(t.lon, t.lat, 1);
      if (cls) hits++;
      const txt = cls ? VISIT_LAYERS.recorrencia_a11y.describe(cls).replace("Aqui ardeu", "ardeu") : "não ardeu desde 1990";
      items.push(
        `<li class="${cls ? "ok" : "no"}"><span class="mark" aria-hidden="true">${cls ? "✓" : "✗"}</span><span><strong>Ficha ${i + 1}:</strong> ${txt}</span></li>`,
      );
    }
    const total = this.tokens.length;
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
    const t = Math.round(w.temperature);
    const v = Math.round(w.windSpeed);
    this.say(
      $("weather-plain"),
      `Agora no Pinhão: ${t} °C, vento ${windWords(v)} (${v} km/h) que vem de ${windFrom(w.windDirection)}. ${w.description}.`,
    );
    const rules = [
      { ok: w.temperature > 30, text: `Calor: mais de 30 °C (hoje ${t} °C)` },
      { ok: w.humidity < 30, text: `Ar seco: humidade abaixo de 30 (hoje ${Math.round(w.humidity)})` },
      { ok: w.windSpeed > 30, text: `Vento: mais de 30 km/h (hoje ${v} km/h)` },
    ];
    const all = rules.every((r) => r.ok);
    const list = $("rule30");
    if (list) {
      list.innerHTML =
        rules.map((r) => `<li class="${r.ok ? "on" : ""}"><span class="mark" aria-hidden="true">${r.ok ? "!" : "–"}</span>${r.text}</li>`).join("") +
        `<li class="sum">${all ? "Hoje cumpre a regra 30-30-30: é um dia muito perigoso para o fogo." : "Hoje não cumpre a regra 30-30-30."}</li>`;
    }
  }

  // ------------------------------------------------------------------ 5 · Protege
  private wireProtege(): void {
    $("btn-see-sanfins")?.addEventListener("click", () => {
      this.manager.goToPreset("sanfins");
      this.manager.setSanfinsBuildingsVisible(true);
      const bt = $("buildings-toggle") as any;
      if (bt) bt.checked = true;
      this.showLayer("risco_2025", 0.7);
      this.say($("risk-point"), "Toca no mapa para saber o risco de fogo nesse sítio.");
    });
    document.querySelectorAll<HTMLButtonElement>(".regrow .chip").forEach((b) =>
      b.addEventListener("click", () => this.setRegrow(Number(b.dataset.years))),
    );
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(".actions input"));
    boxes.forEach((cb) =>
      cb.addEventListener("change", () => {
        const chosen = boxes.filter((b) => b.checked).map((b) => PLEDGES[b.value]);
        this.say($("pledge"), chosen.length ? `Eu vou ${chosen.join(" e ")}.` : "");
      }),
    );
  }

  private setRegrow(years: number): void {
    const r = REGROW[years];
    if (!r) return;
    document.querySelectorAll<HTMLButtonElement>(".regrow .chip").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.years) === years)));
    const fill = $("regrow-fill");
    if (fill) fill.style.width = `${(r.value / 40) * 100}%`;
    this.say($("regrow-text"), `Pelas contas do modelo: ${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}`);
  }

  // ------------------------------------------------------------------ camadas
  private showLayer(key: string, opacity: number): void {
    this.manager.setDouroRiskModel(key);
    this.manager.setDouroRiskOpacity(opacity);
    this.manager.setDouroRiskVisible(true);
    const sel = $("dourorisk-model-select") as any;
    const tog = $("dourorisk-toggle") as any;
    const sld = $("dourorisk-opacity-slider") as any;
    if (sel) sel.value = key;
    if (tog) tog.checked = true;
    if (sld) sld.value = Math.round(opacity * 100);
    const lbl = $("dourorisk-opacity-label");
    if (lbl) lbl.textContent = `${Math.round(opacity * 100)}%`;
    renderLegend($("dourorisk-stats-items"), key);
  }

  private hideLayer(): void {
    this.manager.setDouroRiskVisible(false);
    const tog = $("dourorisk-toggle") as any;
    if (tog) tog.checked = false;
  }

  // ------------------------------------------------------------------ leitura: letra, contraste
  private wireTools(): void {
    $("btn-font")?.addEventListener("click", () => {
      this.fontStep = (this.fontStep + 1) % 3;
      this.applyFont();
      this.toast(["Letra normal.", "Letra maior.", "Letra muito maior."][this.fontStep]);
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

  // ------------------------------------------------------------------ quiosque: volta ao início sem uso
  private setupKiosk(): void {
    if (!new URLSearchParams(location.search).has("quiosque")) return;
    let timer: number | undefined;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (this.current === "guarda" || this.current === "escolhe") return; // nunca a meio de uma atividade
        this.close();
        this.manager.goToPreset("general");
        this.toast("Bem-vindo. Começa em 1 · Olha, na barra de baixo.");
      }, 120_000);
    };
    ["pointerdown", "keydown", "wheel"].forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
  }
}
