// "Só o concelho de Alijó": alguns mapas (ICNF, declive, sol, mato, quantas vezes ardeu) passam os limites
// do concelho. Aqui faz-se uma cópia de cada imagem cortada pelo limite do concelho (uma vez, no browser)
// e troca-se a imagem que a camada usa. As grelhas de leitura (Explorar, pistas) não mudam.
// O limite (lon/lat) passa uma vez para PT-TM06 e daí, por aritmética, para os píxeis de cada grelha.
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { pixelOfXY } from "../geo/grid";
import { toTM06 } from "../geo/pttm06";
import {
  FIRE_WEATHER_MAP_KEYS,
  applyFireWeatherDeltaToCanvas,
  getFireWeatherDelta,
  resolveModelImageUrl,
} from "./derivedLayers";

const full: Record<string, string> = {};
const renderedCache: Record<string, Promise<string | null>> = {};
let onlyConcelho = true;
let concelho: Promise<[number, number][][]> | null = null;

/** Anéis do concelho em PT-TM06 [x, y] (projetados vértice a vértice, uma vez). */
function concelhoRings(): Promise<[number, number][][]> {
  if (!concelho) {
    concelho = fetch("/data/alijo-concelho.geojson")
      .then((r) => r.json())
      .then((g) => {
        const geom = g.features[0].geometry;
        const rings: number[][][] = geom.type === "MultiPolygon" ? geom.coordinates.flat() : geom.coordinates;
        return rings.map((ring) => ring.map(([lon, lat]) => toTM06(lon, lat)));
      });
    concelho.catch(() => (concelho = null));
  }
  return concelho;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const realSrc = await resolveModelImageUrl(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(realSrc));
    img.src = realSrc;
  });
}

function buildModelUrl(key: string): Promise<string | null> {
  const model = DOURORISK_MODELS[key];
  if (!model) return Promise.resolve(null);
  full[key] ??= model.image;

  const isFireMap = (FIRE_WEATHER_MAP_KEYS as readonly string[]).includes(key);
  const isDerived = key === "erosao_pos_fogo" || key === "neve_gelo_25m";
  const delta = isFireMap ? getFireWeatherDelta() : 0;

  if (!onlyConcelho && delta === 0) {
    if (isDerived) {
      return resolveModelImageUrl(full[key]);
    }
    return Promise.resolve(full[key]);
  }

  const cacheKey = isDerived
    ? `${key}|clip=${onlyConcelho ? 1 : 0}`
    : `${key}|clip=${onlyConcelho ? 1 : 0}|delta=${delta}`;

  if (!renderedCache[cacheKey]) {
    renderedCache[cacheKey] = (async () => {
      const [rings, img] = await Promise.all([
        onlyConcelho ? concelhoRings() : Promise.resolve(null),
        loadImage(full[key]),
      ]);
      const grid = model.grid;
      const scale = delta !== 0 && img.naturalWidth > 1200 ? 0.5 : 1;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const sx = c.width / grid.width;
      const sy = c.height / grid.height;
      const ctx = c.getContext("2d", { willReadFrequently: delta !== 0 })!;
      ctx.imageSmoothingEnabled = false;

      if (rings) {
        ctx.beginPath();
        for (const ring of rings) {
          ring.forEach(([x, y], i) => {
            const p = pixelOfXY(grid, x, y);
            if (i === 0) ctx.moveTo(p.x * sx, p.y * sy);
            else ctx.lineTo(p.x * sx, p.y * sy);
          });
          ctx.closePath();
        }
        ctx.clip("evenodd");
      }

      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (delta !== 0) {
        applyFireWeatherDeltaToCanvas(ctx, c.width, c.height, delta);
      }
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      return blob ? URL.createObjectURL(blob) : null;
    })().catch(() => {
      delete renderedCache[cacheKey];
      return null;
    });
  }
  return renderedCache[cacheKey];
}

export function isOnlyConcelho(): boolean {
  return onlyConcelho;
}

/**
 * Liga ou desliga o corte pelo concelho para estes mapas. Prepara as cópias cortadas em segundo plano;
 * `ready(key)` é chamado quando a imagem de um mapa muda (para voltar a desenhar a camada, se estiver à vista).
 */
export function setOnlyConcelho(on: boolean, keys: string[], ready: (key: string) => void): void {
  onlyConcelho = on;
  for (const key of keys) {
    const model = DOURORISK_MODELS[key];
    if (!model) continue;
    full[key] ??= model.image;
    void buildModelUrl(key).then((url) => {
      if (!url || onlyConcelho !== on || model.image === url) return;
      model.image = url;
      ready(key);
    });
  }
}

/**
 * Recalcula as imagens das camadas sensíveis à meteorologia quando muda a data/hora escolhida.
 */
export function refreshClippedKeys(keys: string[], ready: (key: string) => void): void {
  for (const key of keys) {
    const model = DOURORISK_MODELS[key];
    if (!model) continue;
    full[key] ??= model.image;
    if (key === "erosao_pos_fogo" || key === "neve_gelo_25m") {
      delete renderedCache[`${key}|clip=1`];
      delete renderedCache[`${key}|clip=0`];
    }
    void buildModelUrl(key).then((url) => {
      if (!url) return;
      model.image = url;
      ready(key);
    });
  }
}
