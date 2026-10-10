// Mapas de risco: escolher e ver os vários mapas (com miniaturas), mudar a força da cor e
// comparar dois mapas com uma cortina (um à esquerda, outro à direita). Disponível em qualquer passo.
import type EsriMap from "@arcgis/core/Map.js";
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { CanvasOverlay } from "./overlay";
import { renderLegend } from "./layers";
import { extentTM06, gridFromManifest, type GridGeo } from "../geo/grid";
import { isOnlyConcelho, setOnlyConcelho } from "./clip";

/** A grelha de 25 m: a cortina anda sobre a largura dela (o concelho e arredores). */
const G25 = gridFromManifest("g25");

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

/**
 * Colunas da cortina nas grelhas ga (metade oeste) e gb (metade este), para um corte perto da linha
 * x = cutX em PT-TM06. As colunas das grelhas são paralelas a essa linha, mas os bordos das colunas de
 * grelhas diferentes não coincidem: se cada metade arredondasse à sua coluna ficava uma folga sem cor
 * (até ~14 m entre a g25 e uma g10). Por isso o corte cai num bordo de coluna da grelha mais grossa,
 * escolhido entre os vizinhos de cutX (±2 colunas: os bordos de 25 m e de 10 m repetem o padrão a cada
 * 50 m) como o que tem um bordo da outra grelha mais perto; a outra metade corta nesse bordo.
 * Folga ou sobreposição: 0 m entre mapas da mesma grelha, < 0,8 m entre a g25 e uma g10, 0,34 m entre
 * as duas g10. O corte afasta-se de cutX no máximo 1,5 colunas da grelha grossa (37,5 m na g25), bem
 * menos do que um passo da cortina (1 % ≈ 212 m).
 */
function curtainCols(ga: GridGeo, gb: GridGeo, cutX: number): [number, number] {
  const [coarse, fine] = ga.cell >= gb.cell ? [ga, gb] : [gb, ga];
  const k0 = Math.round((cutX - coarse.x0) / coarse.cell);
  let best = { k: k0, j: 0, gap: Infinity };
  for (const k of [k0, k0 - 1, k0 + 1, k0 - 2, k0 + 2]) {
    const x = coarse.x0 + k * coarse.cell;
    const j = Math.round((x - fine.x0) / fine.cell);
    const gap = Math.abs(fine.x0 + j * fine.cell - x);
    // à mesma folga (1 mm) fica o mais perto de cutX (a ordem da lista)
    if (gap < best.gap - 1e-3) best = { k, j, gap };
  }
  return coarse === ga ? [best.k, best.j] : [best.j, best.k];
}

/**
 * Copia só as colunas a oeste (side "left") ou a este ("right") da coluna `col` da grelha (bordo
 * oeste da coluna; ver curtainCols). A imagem tem as dimensões da grelha (ou proporcional).
 */
function half(full: ImageData, grid: GridGeo, col: number, side: "left" | "right"): ImageData {
  const { width: w, height: h } = full;
  const cut = Math.max(0, Math.min(w, Math.round(col * (w / grid.width))));
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
    this.left = new CanvasOverlay(map, "Comparar mapas (esquerda)", G25, this.opacity);
    this.right = new CanvasOverlay(map, "Comparar mapas (direita)", G25, this.opacity);
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

  /** Quiosque: a pessoa seguinte encontra os Mapas como no início (força da cor, cortina e só o concelho). */
  reset(): void {
    this.setOpen(false);
    this.stopCompare();
    this.opacity = 0.8;
    this.frac = 0.5;
    this.left.layer.opacity = this.right.layer.opacity = this.opacity;
    const op = $("maps-opacity") as HTMLInputElement | null;
    if (op) op.value = "80";
    const label = $("maps-opacity-label");
    if (label) label.textContent = "80 %";
    const curtain = $("maps-curtain") as HTMLInputElement | null;
    if (curtain) curtain.value = "50";
    const clip = $("maps-clip") as HTMLInputElement | null;
    if (clip && !clip.checked) {
      clip.checked = true;
      clip.dispatchEvent(new Event("change"));
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
    const ga = DOURORISK_MODELS[a].grid, gb = DOURORISK_MODELS[b].grid;
    // a cortina anda sobre a largura do concelho (grelha de 25 m), em PT-TM06
    const e25 = extentTM06(G25);
    const cutX = e25.xmin + this.frac * (e25.xmax - e25.xmin);
    const [colA, colB] = curtainCols(ga, gb, cutX);
    this.left.setGrid(ga);
    this.right.setGrid(gb);
    this.left.layer.opacity = this.right.layer.opacity = this.opacity;
    this.left.draw(half(ia, ga, colA, "left"));
    this.right.draw(half(ib, gb, colB, "right"));
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
