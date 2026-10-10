// Imagens de grelhas PT-TM06 numa MediaLayer: cada imagem entra em n × n blocos (gridTiles), cada um
// com os seus 4 cantos reais, para o desvio de desenho do SDK ficar em ~1 m em vez de ~19 m
// (ver MEDIA_TILES e cornersGeoreferenceOfPixels em ./grid).
import ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import { gridTiles, type GridGeo } from "./grid";

/** Imagem que cobre uma grelha inteira (com as dimensões da grelha, ou proporcional). */
export type GridImageSource = ImageData | HTMLImageElement | HTMLCanvasElement;

/** Algum píxel não transparente no retângulo [x0, x1[ × [y0, y1[ do ImageData? */
function hasInk(img: ImageData, x0: number, y0: number, x1: number, y1: number): boolean {
  const { data, width } = img;
  for (let y = y0; y < y1; y++) {
    for (let i = (y * width + x0) * 4 + 3, end = (y * width + x1) * 4; i < end; i += 4) if (data[i] !== 0) return true;
  }
  return false;
}

/**
 * Os ImageElements (um por bloco) que desenham `image` sobre a grelha `grid`. Com um ImageData, os
 * blocos totalmente transparentes ficam de fora (não há nada para desenhar neles).
 */
export function gridImageElements(image: GridImageSource, grid: GridGeo): ImageElement[] {
  const w = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const h = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const out: ImageElement[] = [];
  for (const t of gridTiles(grid, w, h)) {
    const tw = t.x1 - t.x0, th = t.y1 - t.y0;
    let part: ImageData | HTMLCanvasElement;
    if (image instanceof ImageData) {
      if (!hasInk(image, t.x0, t.y0, t.x1, t.y1)) continue;
      part = new ImageData(tw, th);
      for (let y = 0; y < th; y++) {
        const from = ((t.y0 + y) * w + t.x0) * 4;
        part.data.set(image.data.subarray(from, from + tw * 4), y * tw * 4);
      }
    } else {
      part = document.createElement("canvas");
      part.width = tw;
      part.height = th;
      part.getContext("2d")!.drawImage(image, t.x0, t.y0, tw, th, 0, 0, tw, th);
    }
    out.push(new ImageElement({ image: part, georeference: t.georeference }));
  }
  return out;
}

/** Lê a imagem `url` (que cobre a grelha) e devolve os seus ImageElements em blocos, já carregados. */
export async function loadGridImageElements(url: string, grid: GridGeo): Promise<ImageElement[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Não foi possível ler ${url}`));
    el.src = url;
  });
  const elements = gridImageElements(img, grid);
  await Promise.all(elements.map((e) => e.load()));
  return elements;
}
