// "Só o concelho de Alijó": alguns mapas (ICNF, declive, sol, mato, quantas vezes ardeu) passam os limites
// do concelho. Aqui faz-se uma cópia de cada imagem cortada pelo limite do concelho (uma vez, no browser)
// e troca-se a imagem que a camada usa. As grelhas de leitura (Explorar, pistas) não mudam.
import { DOURORISK_MODELS } from "../alijo3d/alijoScene";

const full: Record<string, string> = {};
const clipped: Record<string, Promise<string | null>> = {};
let onlyConcelho = true;
let concelho: Promise<number[][][]> | null = null;

function concelhoRings(): Promise<number[][][]> {
  if (!concelho) {
    concelho = fetch("/data/alijo-concelho.geojson")
      .then((r) => r.json())
      .then((g) => {
        const geom = g.features[0].geometry;
        return geom.type === "MultiPolygon" ? geom.coordinates.flat() : geom.coordinates;
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
      const { xmin, ymin, xmax, ymax } = model.extent;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const x = ((lon - xmin) / (xmax - xmin)) * c.width;
          const y = ((ymax - lat) / (ymax - ymin)) * c.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
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
