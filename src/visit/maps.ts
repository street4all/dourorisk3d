// Mapas de risco: escolher e ver os vários mapas (com miniaturas), mudar a força da cor e
// comparar dois mapas com uma cortina (um à esquerda, outro à direita). Disponível em qualquer passo.
import type EsriMap from "@arcgis/core/Map.js";
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { CanvasOverlay } from "./overlay";
import { EXT_25M, renderLegend } from "./layers";
import type { Extent4326 } from "./sampler";
import { isOnlyConcelho, setOnlyConcelho } from "./clip";

export interface MapChoice {
  key: string;
  title: string;
  /** frase curta: o que o mapa mostra */
  about: string;
  group: "risco" | "pistas";
}

export const MAP_CHOICES: MapChoice[] = [
  { key: "risco_2025", group: "risco", title: "Risco de incêndio", about: "Estudo DouroRisk (2025): onde o fogo faria mais estragos, juntando o perigo e o que há para perder." },
  { key: "perigosidade_2025", group: "risco", title: "Perigo de incêndio", about: "Estudo DouroRisk (2025): onde é mais provável o fogo começar e espalhar-se." },
  { key: "icnf_conjuntural", group: "risco", title: "Perigo oficial (2025)", about: "Mapa do ICNF para este ano, com o mato e os fogos recentes." },
  { key: "icnf_estrutural", group: "risco", title: "Perigo oficial (2020–2030)", about: "Mapa do ICNF para 10 anos: o perigo que vem da forma do terreno e da ocupação." },
  { key: "recorrencia_a11y", group: "risco", title: "Quantas vezes ardeu", about: "Onde o fogo passou entre 1990 e 2025, e quantas vezes." },
  { key: "declive_a11y", group: "pistas", title: "Encostas inclinadas", about: "Nas encostas inclinadas o fogo sobe mais depressa." },
  { key: "exposicao_sol", group: "pistas", title: "Encostas ao sol", about: "As encostas viradas a sul e a poente secam mais." },
  { key: "biomassa_2025", group: "pistas", title: "Quanto mato há", about: "Mais mato é mais combustível para o fogo." },
];

const images = new Map<string, Promise<ImageData>>();

/** Carrega uma imagem. Espera pelo "load" e não por decode(), que fica parado com a página escondida. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Não foi possível ler ${src}`));
    img.src = src;
  });
}

/** Imagem do mapa (a mesma que a camada mostra), lida uma vez. */
function imageData(key: string): Promise<ImageData> {
  let p = images.get(key);
  if (!p) {
    p = (async () => {
      const img = await loadImage(DOURORISK_MODELS[key].image);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    })();
    p.catch(() => images.delete(key));
    images.set(key, p);
  }
  return p;
}

/** Copia só as colunas a oeste (side "left") ou a este ("right") da longitude da cortina. */
function half(full: ImageData, extent: Extent4326, cutLon: number, side: "left" | "right"): ImageData {
  const { width: w, height: h } = full;
  const cut = Math.max(0, Math.min(w, Math.round(((cutLon - extent.xmin) / (extent.xmax - extent.xmin)) * w)));
  const out = new ImageData(w, h);
  const [c0, c1] = side === "left" ? [0, cut] : [cut, w];
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    out.data.set(full.data.subarray(row + c0 * 4, row + c1 * 4), row + c0 * 4);
  }
  return out;
}

const $ = (id: string) => document.getElementById(id);

export interface MapsHooks {
  /** mapa à vista na camada DouroRisk (null = nenhum) */
  current(): string | null;
  /** mostra (ou esconde) um mapa na camada DouroRisk, com a força da cor dada */
  show(key: string | null, opacity: number): void;
  /** o painel abriu (a visita fecha o que não cabe ao lado) */
  opened(): void;
  /** a imagem de um mapa mudou (cortada ou inteira): quem a guardou deve lê-la outra vez */
  imageChanged(key: string): void;
}

export class MapsPanel {
  open = false;
  private opacity = 0.8;
  private compareKey: string | null = null;
  private frac = 0.5;
  private left: CanvasOverlay;
  private right: CanvasOverlay;
  private seq = 0;
  /** a mudança de camada veio deste painel (não termina a comparação) */
  private internal = false;

  constructor(map: EsriMap, private hooks: MapsHooks) {
    this.left = new CanvasOverlay(map, "Comparar mapas (esquerda)", EXT_25M, this.opacity);
    this.right = new CanvasOverlay(map, "Comparar mapas (direita)", EXT_25M, this.opacity);
  }

  init(): void {
    this.renderCards();
    $("btn-maps")?.addEventListener("click", () => this.setOpen(!this.open));
    $("maps-close")?.addEventListener("click", () => this.setOpen(false));
    $("maps-opacity")?.addEventListener("input", (e) => {
      this.opacity = Number((e.target as HTMLInputElement).value) / 100;
      const label = $("maps-opacity-label");
      if (label) label.textContent = `${Math.round(this.opacity * 100)} %`;
      this.left.layer.opacity = this.right.layer.opacity = this.opacity;
      const key = this.hooks.current();
      if (key && !this.compareKey) this.show(key, this.opacity);
    });
    $("maps-compare")?.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.compareKey = v || null;
      void this.refreshCompare();
    });
    // só o concelho de Alijó (ligado de início): prepara as cópias cortadas sem atrasar a abertura da app
    const clip = $("maps-clip") as HTMLInputElement | null;
    const keys = MAP_CHOICES.map((c) => c.key);
    const applyClip = (on: boolean) => setOnlyConcelho(on, keys, (key) => this.imageReady(key));
    window.setTimeout(() => applyClip(clip ? clip.checked : true), 2500);
    clip?.addEventListener("change", () => applyClip(clip.checked));
    $("maps-curtain")?.addEventListener("input", (e) => {
      this.frac = Number((e.target as HTMLInputElement).value) / 100;
      void this.refreshCompare();
    });
  }

  /** Uma imagem passou a cortada (ou voltou a inteira): volta a desenhar o que estiver à vista. */
  private imageReady(key: string): void {
    images.delete(key);
    this.hooks.imageChanged(key);
    const current = this.hooks.current();
    if (this.compareKey && (key === current || key === this.compareKey)) void this.refreshCompare();
    else if (key === current) this.show(key, this.opacity);
  }

  setOpen(on: boolean): void {
    if (this.open === on) return;
    this.open = on;
    $("btn-maps")?.setAttribute("aria-pressed", String(on));
    const card = $("maps-card");
    if (card) card.hidden = !on;
    document.body.classList.toggle("maps-open", on);
    if (on) {
      this.hooks.opened();
      // abrir sem nenhum mapa à vista mostra o primeiro (o risco)
      if (!this.hooks.current() && !this.compareKey) this.choose("risco_2025");
      else this.sync(this.hooks.current());
      $("maps-title")?.focus({ preventScroll: true });
    } else {
      this.stopCompare();
      $("btn-maps")?.focus({ preventScroll: true });
    }
  }

  /** A camada mudou (num passo, no "Mais" ou aqui): acerta os cartões; se veio de fora, a comparação acaba. */
  external(key: string | null): void {
    if (!this.internal && this.compareKey) this.stopCompare();
    this.sync(key);
  }

  private show(key: string | null, opacity: number): void {
    this.internal = true;
    try {
      this.hooks.show(key, opacity);
    } finally {
      this.internal = false;
    }
  }

  private sync(key: string | null): void {
    document.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.map === (key ?? ""))));
    const choice = MAP_CHOICES.find((c) => c.key === key);
    const about = $("maps-about");
    if (about) about.textContent = choice ? choice.about : "Sem mapa: só a paisagem.";
    const clip = $("maps-clip") as HTMLInputElement | null;
    if (clip) clip.checked = isOnlyConcelho();
    renderLegend($("maps-legend"), key ?? "");
    // a lista "comparar com" não oferece o mapa que já está à vista
    const sel = $("maps-compare") as HTMLSelectElement | null;
    if (sel) {
      for (const opt of Array.from(sel.options)) opt.disabled = !!opt.value && opt.value === key;
      if (this.compareKey === key) {
        this.compareKey = null;
        sel.value = "";
      }
    }
  }

  private renderCards(): void {
    const groups: [MapChoice["group"], string][] = [
      ["risco", "maps-risco"],
      ["pistas", "maps-pistas"],
    ];
    for (const [g, id] of groups) {
      const box = $(id);
      if (!box) continue;
      box.innerHTML = MAP_CHOICES.filter((c) => c.group === g)
        .map(
          (c) =>
            `<button type="button" class="map-card" data-map="${c.key}" aria-pressed="false"><img src="/images/mapas/${c.key}.png" alt="" loading="lazy" /><span>${c.title}</span></button>`,
        )
        .join("");
    }
    const none = $("maps-none");
    none?.addEventListener("click", () => this.choose(null));
    document.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) => b.addEventListener("click", () => this.choose(b.dataset.map || null)));
    const sel = $("maps-compare") as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML =
        `<option value="">Não comparar</option>` + MAP_CHOICES.map((c) => `<option value="${c.key}">${c.title}</option>`).join("");
    }
  }

  private choose(key: string | null): void {
    this.show(key, this.compareKey ? 0 : this.opacity);
    this.sync(key);
    if (this.compareKey) void this.refreshCompare();
  }

  /** Cortina: o mapa escolhido à esquerda, o de comparar à direita. */
  private async refreshCompare(): Promise<void> {
    const a = this.hooks.current();
    const b = this.compareKey;
    const box = $("maps-curtain-box");
    if (box) box.hidden = !b;
    const seq = ++this.seq;
    if (!b || !a) {
      this.stopCompare(false);
      return;
    }
    let ia: ImageData, ib: ImageData;
    try {
      [ia, ib] = await Promise.all([imageData(a), imageData(b)]);
    } catch {
      return;
    }
    if (seq !== this.seq) return;
    const ea = DOURORISK_MODELS[a].extent, eb = DOURORISK_MODELS[b].extent;
    // a cortina anda sobre a largura do concelho
    const cutLon = EXT_25M.xmin + this.frac * (EXT_25M.xmax - EXT_25M.xmin);
    this.left.setExtent(ea);
    this.right.setExtent(eb);
    this.left.layer.opacity = this.right.layer.opacity = this.opacity;
    this.left.draw(half(ia, ea, cutLon, "left"));
    this.right.draw(half(ib, eb, cutLon, "right"));
    // as duas metades substituem a camada inteira enquanto se compara
    this.show(a, 0);
    const ta = MAP_CHOICES.find((c) => c.key === a)?.title ?? "";
    const tb = MAP_CHOICES.find((c) => c.key === b)?.title ?? "";
    const lbl = $("maps-curtain-label");
    if (lbl) lbl.textContent = `Oeste: ${ta} · Este: ${tb}`;
    renderLegend($("maps-legend-b"), b);
  }

  private stopCompare(resetSelect = true): void {
    this.seq++;
    this.left.hide();
    this.right.hide();
    const a = this.hooks.current();
    if (a) this.show(a, this.opacity);
    renderLegend($("maps-legend-b"), "");
    const box = $("maps-curtain-box");
    if (box) box.hidden = true;
    if (resetSelect) {
      this.compareKey = null;
      const sel = $("maps-compare") as HTMLSelectElement | null;
      if (sel) sel.value = "";
    }
  }
}
