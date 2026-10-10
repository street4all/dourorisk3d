// Desenho livre sobre o terreno 3D: uma MediaLayer cuja imagem é um ImageData feito no browser.
// Serve para as pistas que se somam, a revelação de "onde ardeu" e a faísca.
// A imagem cobre uma grelha PT-TM06 inteira (ou proporcional: a faísca usa células de 50 m) e é
// colocada em blocos, cada um pelos seus 4 cantos reais (gridImageElements).
import MediaLayer from "@arcgis/core/layers/MediaLayer.js";
import type ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import type EsriMap from "@arcgis/core/Map.js";
import type { GridGeo } from "../geo/grid";
import { gridImageElements } from "../geo/gridMedia";

export class CanvasOverlay {
  readonly layer: MediaLayer;
  private elements: ImageElement[] = [];
  private seq = 0;
  private shown = 0;

  constructor(map: EsriMap, title: string, private grid: GridGeo, opacity = 0.85) {
    this.layer = new MediaLayer({ title, opacity, visible: false, listMode: "hide" });
    map.add(this.layer);
  }

  /**
   * Mostra a imagem (substitui a anterior). Mudar `element.image` não volta a desenhar na SceneView,
   * por isso cada imagem nova entra em elementos novos (um por bloco), que trocam com os anteriores.
   */
  draw(image: ImageData): void {
    const seq = ++this.seq;
    const next = gridImageElements(image, this.grid);
    this.layer.visible = true;
    // numa animação as imagens chegam mais depressa do que a cena as prepara:
    // só troca quando a nova está pronta, e salta as que entretanto ficaram velhas
    void Promise.all(next.map((e) => e.load().catch(() => undefined))).then(() => {
      if (seq !== this.seq) return;
      // a camada já carregada tem uma fonte vazia: juntam-se os elementos a ela (substituir a fonte não pega)
      const src = this.layer.source as any;
      if (src?.elements) {
        src.elements.addMany(next);
        if (this.elements.length) src.elements.removeMany(this.elements);
      } else this.layer.source = next as any;
      this.elements = next;
      this.shown = seq;
    });
  }

  /** Muda a grelha das próximas imagens (para mapas com grelhas diferentes na mesma camada). */
  setGrid(grid: GridGeo): void {
    this.grid = grid;
  }

  /** Há uma imagem a preparar? (as animações esperam por ela antes de mandar a seguinte) */
  get busy(): boolean {
    return this.seq !== this.shown;
  }

  hide(): void {
    this.shown = ++this.seq;
    this.layer.visible = false;
  }

  get visible(): boolean {
    return this.layer.visible;
  }
}
