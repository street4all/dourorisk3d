// Camadas espaciais sobrepostas no mapa 3D para o módulo de Reanálise Climática (Copernicus CERRA / ERA5):
// 1. Heatmap contínuo (MediaLayer + CornersGeoreference)
// 2. Isóbaras de pressão ao nível do mar em hPa (GraphicsLayer 3D com polilinhas + rótulos)
// 3. Setas de direção e intensidade do vento (GraphicsLayer 3D orientado)

import type EsriMap from "@arcgis/core/Map.js";
import MediaLayer from "@arcgis/core/layers/MediaLayer.js";
import ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import CornersGeoreference from "@arcgis/core/layers/support/CornersGeoreference.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import TextSymbol3DLayer from "@arcgis/core/symbols/TextSymbol3DLayer.js";
import {
  CLIMATE_VARIABLES,
  type ClimateVarKey,
  type ReanalysisDataset,
} from "../alijo3d/cerraService";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function samplePalette(palette: readonly string[], t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (palette.length - 1);
  const idx = Math.min(palette.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = hexToRgb(palette[idx]);
  const c1 = hexToRgb(palette[idx + 1]);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

function windArrowSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="19" fill="rgba(18,20,23,0.72)" stroke="${color}" stroke-width="2.5"/>
    <path d="M24 8 L33 26 L26.5 23 L26.5 38 L21.5 38 L21.5 23 L15 26 Z" fill="${color}" stroke="#121417" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function centerPinSvg(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="22" fill="rgba(2,132,199,0.25)" stroke="#38bdf8" stroke-width="3"/>
    <circle cx="28" cy="28" r="8" fill="#38bdf8" stroke="#ffffff" stroke-width="3"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class ClimateMapOverlay {
  private heatmapLayer: MediaLayer;
  private isobarLayer: GraphicsLayer;
  private windVectorLayer: GraphicsLayer;
  private currentElement: ImageElement | null = null;
  private renderSeq = 0;

  public showHeatmap = true;
  public showIsobars = true;
  public showWindArrows = true;

  constructor(map: EsriMap) {
    this.heatmapLayer = new MediaLayer({
      title: "Reanálise Climática — Heatmap",
      opacity: 0.72,
      visible: false,
      listMode: "hide",
    });

    this.isobarLayer = new GraphicsLayer({
      title: "Reanálise Climática — Isóbaras (hPa)",
      elevationInfo: { mode: "relative-to-ground", offset: 45 },
      visible: false,
      listMode: "hide",
    });

    this.windVectorLayer = new GraphicsLayer({
      title: "Reanálise Climática — Setas de Vento",
      elevationInfo: { mode: "relative-to-ground", offset: 75 },
      visible: false,
      listMode: "hide",
    });

    map.addMany([this.heatmapLayer, this.isobarLayer, this.windVectorLayer]);
  }

  public setOpacity(opacity: number): void {
    this.heatmapLayer.opacity = Math.max(0.1, Math.min(1, opacity));
  }

  public clear(): void {
    this.renderSeq++;
    this.heatmapLayer.visible = false;
    this.isobarLayer.visible = false;
    this.windVectorLayer.visible = false;
    this.isobarLayer.removeAll();
    this.windVectorLayer.removeAll();
  }

  /**
   * Interpola um valor escalar na posição normalizada (u, v) in [0, 1] x [0, 1]
   * a partir dos nós da grelha 4x4.
   */
  private interpolateGrid(
    dataset: ReanalysisDataset,
    extractor: (nodeIdx: number) => number,
    u: number,
    v: number
  ): number {
    const rows = dataset.gridRows;
    const cols = dataset.gridCols;
    const gy = Math.max(0, Math.min(rows - 1.0001, v * (rows - 1)));
    const gx = Math.max(0, Math.min(cols - 1.0001, u * (cols - 1)));
    const r0 = Math.floor(gy);
    const c0 = Math.floor(gx);
    const r1 = Math.min(rows - 1, r0 + 1);
    const c1 = Math.min(cols - 1, c0 + 1);
    const fy = gy - r0;
    const fx = gx - c0;

    const v00 = extractor(r0 * cols + c0);
    const v10 = extractor(r0 * cols + c1);
    const v01 = extractor(r1 * cols + c0);
    const v11 = extractor(r1 * cols + c1);

    const top = v00 * (1 - fx) + v10 * fx;
    const bot = v01 * (1 - fx) + v11 * fx;
    return top * (1 - fy) + bot * fy;
  }

  /**
   * Atualiza o Heatmap, as Isóbaras e as Setas de Vento para o passo temporal `stepIdx`.
   */
  public renderStep(
    dataset: ReanalysisDataset,
    varKey: ClimateVarKey,
    stepIdx: number
  ): { minVal: number; maxVal: number } {
    const seq = ++this.renderSeq;
    const clampedIdx = Math.max(0, Math.min(dataset.times.length - 1, stepIdx));

    // 1. Extrair valores da variável escolhida nos nós da grelha
    const nodeVals = dataset.gridNodes.map((n) => n.values[varKey]?.[clampedIdx] ?? 0);
    let minVal = Math.min(...nodeVals);
    let maxVal = Math.max(...nodeVals);

    // Garantir amplitude mínima para que a escala de cores seja legível
    if (varKey === "precipitation") {
      minVal = 0;
      maxVal = Math.max(maxVal, 5);
    } else if (Math.abs(maxVal - minVal) < 1) {
      minVal -= 0.5;
      maxVal += 0.5;
    }

    // 2. Desenhar Heatmap (MediaLayer)
    if (this.showHeatmap) {
      this.drawHeatmapCanvas(dataset, varKey, clampedIdx, minVal, maxVal, seq);
    } else {
      this.heatmapLayer.visible = false;
    }

    // 3. Desenhar Isóbaras (GraphicsLayer)
    if (this.showIsobars) {
      this.drawIsobars(dataset, clampedIdx);
      this.isobarLayer.visible = true;
    } else {
      this.isobarLayer.visible = false;
      this.isobarLayer.removeAll();
    }

    // 4. Desenhar Setas de Vento + Marcador Central (GraphicsLayer)
    if (this.showWindArrows) {
      this.drawWindVectors(dataset, clampedIdx);
      this.windVectorLayer.visible = true;
    } else {
      this.windVectorLayer.visible = false;
      this.windVectorLayer.removeAll();
    }

    return { minVal, maxVal };
  }

  private drawHeatmapCanvas(
    dataset: ReanalysisDataset,
    varKey: ClimateVarKey,
    stepIdx: number,
    minVal: number,
    maxVal: number,
    seq: number
  ): void {
    const W = 144;
    const H = 144;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const meta = CLIMATE_VARIABLES[varKey];
    const span = Math.max(1e-5, maxVal - minVal);

    const extractor = (idx: number) => dataset.gridNodes[idx]?.values[varKey]?.[stepIdx] ?? 0;

    for (let py = 0; py < H; py++) {
      // py = 0 é o topo (Norte -> v = 1), py = H-1 é o fundo (Sul -> v = 0)
      const v = 1 - py / (H - 1);
      // Suavizar bordas exteriores com ligeiro fade nos últimos 6% da malha
      const edgeY = Math.min(1, Math.min(v, 1 - v) / 0.06);

      for (let px = 0; px < W; px++) {
        const u = px / (W - 1);
        const edgeX = Math.min(1, Math.min(u, 1 - u) / 0.06);
        const edgeAlpha = edgeX * edgeY;

        const val = this.interpolateGrid(dataset, extractor, u, v);
        const norm = (val - minVal) / span;
        const [r, g, b] = samplePalette(meta.palette, norm);

        // Para precipitação, valores muito próximos de 0 ficam mais translúcidos para deixar ver o terreno
        let alpha = 215;
        if (varKey === "precipitation" && val < 0.15) {
          alpha = Math.round((val / 0.15) * 90);
        }

        const pIdx = (py * W + px) * 4;
        img.data[pIdx] = r;
        img.data[pIdx + 1] = g;
        img.data[pIdx + 2] = b;
        img.data[pIdx + 3] = Math.round(alpha * edgeAlpha);
      }
    }

    ctx.putImageData(img, 0, 0);

    const { minLon, maxLon, minLat, maxLat } = dataset.bbox;
    const georeference = new CornersGeoreference({
      topLeft: new Point({ longitude: minLon, latitude: maxLat }),
      topRight: new Point({ longitude: maxLon, latitude: maxLat }),
      bottomLeft: new Point({ longitude: minLon, latitude: minLat }),
      bottomRight: new Point({ longitude: maxLon, latitude: minLat }),
    });

    const nextElem = new ImageElement({ image: canvas, georeference });
    this.heatmapLayer.visible = true;

    void nextElem
      .load()
      .catch(() => undefined)
      .then(() => {
        if (seq !== this.renderSeq) return;
        const src = this.heatmapLayer.source as any;
        if (src?.elements) {
          src.elements.add(nextElem);
          if (this.currentElement) src.elements.remove(this.currentElement);
        } else {
          this.heatmapLayer.source = [nextElem] as any;
        }
        this.currentElement = nextElem;
      });
  }

  /**
   * Traça isolinhas de pressão atmosférica (isóbaras em hPa) por Marching Squares
   * numa subgrelha 20x20 sobre a área de estudo.
   */
  private drawIsobars(dataset: ReanalysisDataset, stepIdx: number): void {
    this.isobarLayer.removeAll();

    const N = 20;
    const extractor = (idx: number) => dataset.gridNodes[idx]?.values.pressure_msl?.[stepIdx] ?? 1013;
    const field: number[][] = [];
    let minP = Infinity;
    let maxP = -Infinity;

    for (let r = 0; r <= N; r++) {
      const v = r / N;
      const row: number[] = [];
      for (let c = 0; c <= N; c++) {
        const u = c / N;
        const p = this.interpolateGrid(dataset, extractor, u, v);
        row.push(p);
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
      field.push(row);
    }

    const { minLon, maxLon, minLat, maxLat } = dataset.bbox;
    const toLon = (u: number) => minLon + u * (maxLon - minLon);
    const toLat = (v: number) => minLat + v * (maxLat - minLat);

    const span = maxP - minP;
    const stepHpa = span > 4 ? 1.0 : 0.5;
    const firstLevel = Math.ceil(minP / stepHpa) * stepHpa;

    const graphics: Graphic[] = [];

    for (let level = firstLevel; level <= maxP; level += stepHpa) {
      const paths: number[][][] = [];
      let labelPoint: [number, number] | null = null;

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v00 = field[r][c];
          const v10 = field[r][c + 1];
          const v11 = field[r + 1][c + 1];
          const v01 = field[r + 1][c];

          const pts: [number, number][] = [];
          const interp = (a: number, b: number) => {
            const d = b - a;
            return Math.abs(d) < 1e-6 ? 0.5 : Math.max(0, Math.min(1, (level - a) / d));
          };

          // Aresta Sul (v00 -> v10)
          if ((v00 < level) !== (v10 < level)) {
            pts.push([(c + interp(v00, v10)) / N, r / N]);
          }
          // Aresta Este (v10 -> v11)
          if ((v10 < level) !== (v11 < level)) {
            pts.push([(c + 1) / N, (r + interp(v10, v11)) / N]);
          }
          // Aresta Norte (v01 -> v11)
          if ((v01 < level) !== (v11 < level)) {
            pts.push([(c + interp(v01, v11)) / N, (r + 1) / N]);
          }
          // Aresta Oeste (v00 -> v01)
          if ((v00 < level) !== (v01 < level)) {
            pts.push([c / N, (r + interp(v00, v01)) / N]);
          }

          if (pts.length >= 2) {
            const pA = [toLon(pts[0][0]), toLat(pts[0][1])];
            const pB = [toLon(pts[1][0]), toLat(pts[1][1])];
            paths.push([pA, pB]);
            if (!labelPoint && r >= 4 && r <= N - 4 && c >= 4 && c <= N - 4) {
              labelPoint = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
            }
          }
        }
      }

      if (paths.length > 0) {
        graphics.push(
          new Graphic({
            geometry: new Polyline({ paths, spatialReference: { wkid: 4326 } }),
            symbol: new SimpleLineSymbol({
              color: [255, 255, 255, 0.92],
              width: 2.2,
              style: "short-dash",
            }),
          })
        );

        if (labelPoint) {
          graphics.push(
            new Graphic({
              geometry: new Point({ longitude: labelPoint[0], latitude: labelPoint[1] }),
              symbol: new PointSymbol3D({
                symbolLayers: [
                  new TextSymbol3DLayer({
                    text: `${level.toFixed(stepHpa < 1 ? 1 : 0)} hPa`,
                    size: 11,
                    material: { color: "#ffffff" },
                    halo: { color: "#121417", size: 2 },
                    background: { color: [18, 20, 23, 0.78] },
                  }),
                ],
              }),
            })
          );
        }
      }
    }

    this.isobarLayer.addMany(graphics);
  }

  /**
   * Desenha setas de vento orientadas numa grelha 4x4 sobre a região e o pino do ponto central.
   */
  private drawWindVectors(dataset: ReanalysisDataset, stepIdx: number): void {
    this.windVectorLayer.removeAll();
    const graphics: Graphic[] = [];

    for (const node of dataset.gridNodes) {
      const speed = node.values.wind_speed_10m?.[stepIdx] ?? 10;
      const fromDeg = node.windDirection?.[stepIdx] ?? 225;
      // O vento sopra DE `fromDeg` PARA `(fromDeg + 180) % 360`
      const toDeg = (fromDeg + 180) % 360;

      const color =
        speed >= 50 ? "#ef4444" : speed >= 30 ? "#f59e0b" : speed >= 15 ? "#38bdf8" : "#cbd5e1";

      graphics.push(
        new Graphic({
          geometry: new Point({ longitude: node.lon, latitude: node.lat }),
          symbol: new PointSymbol3D({
            symbolLayers: [
              new IconSymbol3DLayer({
                resource: { href: windArrowSvg(color) },
                size: speed >= 35 ? 28 : 24,
                angle: toDeg,
              }),
            ],
          }),
        })
      );
    }

    // Marcador do ponto central em análise
    graphics.push(
      new Graphic({
        geometry: new Point({ longitude: dataset.centerLon, latitude: dataset.centerLat }),
        symbol: new PointSymbol3D({
          symbolLayers: [
            new IconSymbol3DLayer({
              resource: { href: centerPinSvg() },
              size: 34,
            }),
          ],
        }),
      })
    );

    this.windVectorLayer.addMany(graphics);
  }
}
