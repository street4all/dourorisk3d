// Camadas derivadas a 25 m geradas no browser a partir das grelhas oficiais do estudo DouroRisk:
// 1. "erosao_pos_fogo" — Erosão pós-fogo e derrocada de socalcos (escala de 1 a 5)
// 2. "neve_gelo_25m"   — Suscetibilidade à acumulação de neve e gelo negro (escala de 1 a 4)

import { gridFromManifest } from "../geo/grid";
import { MDT, VALUES, decode } from "./values";

const G25 = gridFromManifest("g25");

export const EROSAO_COLORS = ["#036403", "#88B302", "#FFFE06", "#FE9900", "#DD2203"] as const;
export const NEVE_GELO_COLORS = ["#0284c7", "#38bdf8", "#93c5fd", "#e0f2fe"] as const;
export const NEVE_GELO_WORDS = [
  "abrigo do vale (raro gelar)",
  "meia-encosta (geada frequente)",
  "encosta fria ou sombria (gelo na estrada)",
  "terras altas (acumulação de neve e gelo)",
] as const;

interface DerivedLayerCache {
  classes: Uint8Array;
  blobUrl: string;
}

let erosaoPromise: Promise<DerivedLayerCache> | null = null;
let neveGeloPromise: Promise<DerivedLayerCache> | null = null;

function hexToRgba(hex: string, alpha = 230): [number, number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    alpha,
  ];
}

async function classesToBlobUrl(
  classes: Uint8Array,
  palette: readonly string[],
  alphaByClass?: readonly number[]
): Promise<string> {
  const { width, height } = G25;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const out = new Uint32Array(img.data.buffer);

  const rgbaLut = new Uint32Array(palette.length + 1);
  for (let c = 1; c <= palette.length; c++) {
    const a = alphaByClass ? alphaByClass[c - 1] : 230;
    const [r, g, b] = hexToRgba(palette[c - 1], a);
    rgbaLut[c] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    if (c >= 1 && c <= palette.length) {
      out[i] = rgbaLut[c];
    }
  }

  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
}

/**
 * Calcula a grelha de classes (1..5) e a imagem PNG para "erosao_pos_fogo" (Erosão pós-fogo e socalcos a 25 m).
 */
async function buildErosaoLayer(): Promise<DerivedLayerCache> {
  if (!erosaoPromise) {
    erosaoPromise = (async () => {
      const [mdtRes, concBytes, rioBytes, decBytes, uaBytes, recBytes, bioBytes] = await Promise.all([
        MDT.rawView(),
        VALUES.concelho.bytes(),
        VALUES.rio.bytes(),
        VALUES.declive.bytes(),
        VALUES.ultimoAno.bytes(),
        VALUES.recorrencia.bytes(),
        VALUES.biomassa.bytes(),
      ]);

      const { width, height } = G25;
      const n = width * height;
      const classes = new Uint8Array(n);

      const slopeLut = new Float32Array(256);
      const yearLut = new Int16Array(256);
      const recLut = new Int16Array(256);
      const bioLut = new Float32Array(256);
      for (let b = 0; b < 256; b++) {
        slopeLut[b] = decode("declive_pct", b) ?? 0;
        yearLut[b] = decode("ultimo_ano", b) ?? 0;
        recLut[b] = decode("recorrencia_valor", b) ?? 0;
        bioLut[b] = decode("biomassa_t_ha", b) ?? 15;
      }

      if (concBytes && decBytes) {
        const mdtView = mdtRes?.view ?? null;
        const nodata = mdtRes?.nodata ?? -32768;

        for (let i = 0; i < n; i++) {
          if (!concBytes[i]) continue;
          if (rioBytes && rioBytes[i]) continue;

          const slope = slopeLut[decBytes[i]];
          const lastYear = uaBytes ? yearLut[uaBytes[i]] : 0;
          const fireRec = recBytes ? recLut[recBytes[i]] : 0;
          const bio = bioBytes ? bioLut[bioBytes[i]] : 15;
          const alt = mdtView ? mdtView.getInt16(i * 2, true) : 450;

          // Fator topográfico (declive + faixa de socalcos vitícolas do Douro < 580 m)
          const isTerraceBelt = alt !== nodata && alt < 580 && slope >= 24;
          const ls =
            slope >= 42
              ? 2.45
              : slope >= 30
                ? 1.9
                : slope >= 20
                  ? 1.38
                  : slope >= 10
                    ? 0.85
                    : 0.35;

          // Fator pós-fogo e proteção vegetal
          let fireFactor = 1.0;
          if (lastYear >= 2020) {
            fireFactor = 2.35;
          } else if (lastYear >= 2015 || fireRec >= 3) {
            fireFactor = 1.68;
          } else if (fireRec >= 1) {
            fireFactor = 1.28;
          } else if (bio >= 24) {
            fireFactor = 0.6;
          }

          const terraceBoost = isTerraceBelt ? 1.22 : 1.0;
          const score = ls * fireFactor * terraceBoost;

          let cls = 1;
          if (score >= 2.35) cls = 5;
          else if (score >= 1.55) cls = 4;
          else if (score >= 0.95) cls = 3;
          else if (score >= 0.52) cls = 2;

          classes[i] = cls;
        }
      }

      const blobUrl = await classesToBlobUrl(classes, EROSAO_COLORS);
      return { classes, blobUrl };
    })();
  }
  return erosaoPromise;
}

/**
 * Calcula a grelha de classes (1..4) e a imagem PNG para "neve_gelo_25m" (Suscetibilidade a neve e gelo a 25 m).
 */
async function buildNeveGeloLayer(): Promise<DerivedLayerCache> {
  if (!neveGeloPromise) {
    neveGeloPromise = (async () => {
      const [mdtRes, concBytes, rioBytes, expBytes] = await Promise.all([
        MDT.rawView(),
        VALUES.concelho.bytes(),
        VALUES.rio.bytes(),
        VALUES.exposicao.bytes(),
      ]);

      const { width, height } = G25;
      const n = width * height;
      const classes = new Uint8Array(n);

      if (mdtRes && concBytes) {
        const { view: mdtView, nodata } = mdtRes;

        for (let i = 0; i < n; i++) {
          if (!concBytes[i]) continue;
          if (rioBytes && rioBytes[i]) continue;

          const alt = mdtView.getInt16(i * 2, true);
          if (alt === nodata || alt < 50) continue;

          // Bónus de exposição solar: encostas viradas a Norte/Umbria conservam gelo e neve ~45 m mais abaixo
          let aspectBonus = 0;
          if (expBytes) {
            const rawExp = expBytes[i];
            if (rawExp > 0 && (rawExp < 45 || rawExp > 205)) {
              aspectBonus = 45;
            } else if (rawExp >= 95 && rawExp <= 165) {
              aspectBonus = -25;
            }
          }

          const effAlt = alt + aspectBonus;
          let cls = 1;
          if (effAlt >= 675) cls = 4;
          else if (effAlt >= 565) cls = 3;
          else if (effAlt >= 410) cls = 2;

          classes[i] = cls;
        }
      }

      const blobUrl = await classesToBlobUrl(classes, NEVE_GELO_COLORS, [160, 195, 220, 242]);
      return { classes, blobUrl };
    })();
  }
  return neveGeloPromise;
}

export async function getErosaoClasses(): Promise<Uint8Array> {
  const res = await buildErosaoLayer();
  return res.classes;
}

export async function getNeveGeloClasses(): Promise<Uint8Array> {
  const res = await buildNeveGeloLayer();
  return res.classes;
}

/**
 * Converte marcadores "derived:erosao_pos_fogo" ou "derived:neve_gelo_25m" no Blob URL real gerado a 25 m.
 */
export async function resolveModelImageUrl(url: string): Promise<string> {
  if (url === "derived:erosao_pos_fogo") {
    const res = await buildErosaoLayer();
    return res.blobUrl;
  }
  if (url === "derived:neve_gelo_25m") {
    const res = await buildNeveGeloLayer();
    return res.blobUrl;
  }
  return url;
}

/**
 * Miniaturas SVG nítidas para os cartões de "Mapas de risco" (#maps-card).
 */
export function thumbnailForMap(key: string): string {
  if (key === "erosao_pos_fogo") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="14" fill="#181b20"/>
      <path d="M12 78 L34 32 L54 54 L72 22 L86 78 Z" fill="#FE9900" opacity="0.85"/>
      <path d="M28 78 L48 42 L68 28 L86 78 Z" fill="#DD2203" opacity="0.9"/>
      <path d="M10 78 Q48 66 86 78" stroke="#FFFE06" stroke-width="4" fill="none" stroke-dasharray="6 4"/>
      <circle cx="34" cy="24" r="6" fill="#036403"/>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  if (key === "neve_gelo_25m") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="14" fill="#0f172a"/>
      <path d="M10 80 L36 26 L58 52 L74 20 L88 80 Z" fill="#0284c7"/>
      <path d="M22 55 L36 26 L49 41 Z" fill="#e0f2fe"/>
      <path d="M60 44 L74 20 L82 48 Z" fill="#e0f2fe"/>
      <path d="M16 66 L82 66" stroke="#93c5fd" stroke-width="3" stroke-dasharray="5 3"/>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return `/images/mapas/${key}.png`;
}
