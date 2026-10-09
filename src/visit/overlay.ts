// Desenho livre sobre o terreno 3D: uma MediaLayer cuja imagem é um ImageData feito no browser.
// Serve para as pistas que se somam, a revelação de "onde ardeu" e a faísca.
import MediaLayer from "@arcgis/core/layers/MediaLayer.js";
import ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import ExtentAndRotationGeoreference from "@arcgis/core/layers/support/ExtentAndRotationGeoreference.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import type EsriMap from "@arcgis/core/Map.js";
import type { Extent4326 } from "./sampler";

export class CanvasOverlay {
  readonly layer: MediaLayer;
  private element: ImageElement | null = null;
  private seq = 0;
  private shown = 0;

  constructor(map: EsriMap, title: string, private extent: Extent4326, opacity = 0.85) {
    this.layer = new MediaLayer({ title, opacity, visible: false, listMode: "hide" });
    map.add(this.layer);
  }

  /**
   * Mostra a imagem (substitui a anterior). Mudar `element.image` não volta a desenhar na SceneView,
   * por isso cada imagem nova entra num elemento novo, que troca com o anterior.
   */
  draw(image: ImageData): void {
    const { xmin, ymin, xmax, ymax } = this.extent;
    const seq = ++this.seq;
    const next = new ImageElement({
      image,
      georeference: new ExtentAndRotationGeoreference({
        extent: new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }),
      }),
    });
    this.layer.visible = true;
    // numa animação as imagens chegam mais depressa do que a cena as prepara:
    // só troca quando a nova está pronta, e salta as que entretanto ficaram velhas
    void next
      .load()
      .catch(() => undefined)
      .then(() => {
        if (seq !== this.seq) return;
        // a camada já carregada tem uma fonte vazia: junta-se o elemento a ela (substituir a fonte não pega)
        const src = this.layer.source as any;
        if (src?.elements) {
          src.elements.add(next);
          if (this.element) src.elements.remove(this.element);
        } else this.layer.source = [next] as any;
        this.element = next;
        this.shown = seq;
      });
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
