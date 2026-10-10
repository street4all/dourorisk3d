// "Só o concelho de Alijó": alguns mapas (ICNF, declive, sol, mato, quantas vezes ardeu) passam os limites
// do concelho. Aqui faz-se uma cópia de cada imagem cortada pelo limite do concelho (uma vez, no browser)
// e troca-se a imagem que a camada usa. As grelhas de leitura (Explorar, pistas) não mudam.
// O limite (lon/lat) passa uma vez para PT-TM06 e daí, por aritmética, para os píxeis de cada grelha.
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";
import { pixelOfXY } from "../geo/grid";
import { toTM06 } from "../geo/pttm06";

const full: Record<string, string> = {};
const clipped: Record<string, Promise<string | null>> = {};
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

/** Cópia da imagem do mapa só com o que fica dentro do concelho (URL de um blob), ou null se falhar. */
function clippedUrl(key: string): Promise<string | null> {
  if (!clipped[key]) {
    clipped[key] = (async () => {
      const model = DOURORISK_MODELS[key];
      const [rings, img] = await Promise.all([concelhoRings(), loadImage(full[key] ?? model.image)]);
      const grid = model.grid;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      // a imagem tem as dimensões da grelha (se não tiver, escala-se na mesma proporção)
      const sx = c.width / grid.width, sy = c.height / grid.height;
      const ctx = c.getContext("2d")!;
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
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      return blob ? URL.createObjectURL(blob) : null;
    })().catch(() => {
      delete clipped[key];
      return null;
    });
  }
  return clipped[key];
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
    if (!on) {
      if (model.image !== full[key]) {
        model.image = full[key];
        ready(key);
      }
      continue;
    }
    void clippedUrl(key).then((url) => {
      if (!url || !onlyConcelho || model.image === url) return;
      model.image = url;
      ready(key);
    });
  }
}
