import type MapView from "@arcgis/core/views/MapView.js";
import type GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import type GeoJSONLayerView from "@arcgis/core/views/layers/GeoJSONLayerView.js";
import FeatureEffect from "@arcgis/core/layers/support/FeatureEffect.js";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter.js";
import { INDICATORS } from "../data/types";
import type { FilterState } from "../data/types";
import { createIndicatorRenderer } from "../layers/renderers";

export class FilterController {
  private view: MapView;
  private municipalitiesLayer: GeoJSONLayer;
  private parishesLayer: GeoJSONLayer;
  private munLayerView: GeoJSONLayerView | null = null;
  private parishLayerView: GeoJSONLayerView | null = null;

  public state: FilterState = {
    indicatorId: "densidade_empresas",
    selectedDistrict: "ALL",
    selectedMunicipality: "ALL",
    minThreshold: 0,
    activeLayer: "municipalities",
  };

  constructor(view: MapView, municipalitiesLayer: GeoJSONLayer, parishesLayer: GeoJSONLayer) {
    this.view = view;
    this.municipalitiesLayer = municipalitiesLayer;
    this.parishesLayer = parishesLayer;
  }

  public async initialize(): Promise<void> {
    this.munLayerView = (await this.view.whenLayerView(this.municipalitiesLayer)) as unknown as GeoJSONLayerView;
    this.parishLayerView = (await this.view.whenLayerView(this.parishesLayer)) as unknown as GeoJSONLayerView;
  }

  public setIndicator(indicatorId: string): void {
    const indicator = INDICATORS[indicatorId];
    if (!indicator) return;

    this.state.indicatorId = indicatorId;

    if (indicator.targetLayer === "parishes") {
      this.state.activeLayer = "parishes";
      this.parishesLayer.visible = true;
      this.municipalitiesLayer.visible = false;
      this.parishesLayer.renderer = createIndicatorRenderer(indicator, true);
    } else {
      this.state.activeLayer = "municipalities";
      this.municipalitiesLayer.visible = true;
      this.parishesLayer.visible = false;
      this.municipalitiesLayer.renderer = createIndicatorRenderer(indicator, false);
    }

    this.state.minThreshold = indicator.min;
    this.applyFilters();
  }

  public setDistrict(district: string): void {
    this.state.selectedDistrict = district;
    this.state.selectedMunicipality = "ALL";
    this.applyFilters();
    this.zoomToSelection();
  }

  public setMunicipality(municipalityId: string): void {
    this.state.selectedMunicipality = municipalityId;

    // When a specific municipality is selected, switch to parishes layer if not already
    if (municipalityId !== "ALL") {
      if (this.state.activeLayer === "municipalities") {
        // Automatically switch to parish view for that municipality
        this.setIndicator("pct_empregadores");
      }
    }

    this.applyFilters();
    this.zoomToSelection();
  }

  public setThreshold(threshold: number): void {
    this.state.minThreshold = threshold;
    this.applyFilters();
  }

  public resetView(): void {
    this.state.selectedDistrict = "ALL";
    this.state.selectedMunicipality = "ALL";
    this.setIndicator("densidade_empresas");
    this.applyFilters();
    this.view.goTo({
      center: [-8.2245, 39.55],
      zoom: 7,
    });
  }

  private applyFilters(): void {
    const indicator = INDICATORS[this.state.indicatorId];
    if (!indicator) return;

    const clauses: string[] = [];

    if (this.state.selectedDistrict !== "ALL") {
      clauses.push(`distrito = '${this.state.selectedDistrict}'`);
    }

    if (this.state.selectedMunicipality !== "ALL") {
      clauses.push(`id_municipio = '${this.state.selectedMunicipality}'`);
    }

    if (this.state.minThreshold > indicator.min) {
      clauses.push(`${indicator.attributeField} >= ${this.state.minThreshold}`);
    }

    const whereClause = clauses.length > 0 ? clauses.join(" AND ") : "1=1";

    const effect = new FeatureEffect({
      filter: new FeatureFilter({
        where: whereClause,
      }),
      includedEffect: "bloom(0.4, 0.6px, 0.1)",
      excludedEffect: "grayscale(85%) opacity(22%)",
    });

    if (this.state.activeLayer === "parishes" && this.parishLayerView) {
      this.parishLayerView.featureEffect = effect;
      if (this.munLayerView) this.munLayerView.featureEffect = null;
    } else if (this.munLayerView) {
      this.munLayerView.featureEffect = effect;
      if (this.parishLayerView) this.parishLayerView.featureEffect = null;
    }
  }

  private async zoomToSelection(): Promise<void> {
    const targetLayer = this.state.activeLayer === "parishes" ? this.parishesLayer : this.municipalitiesLayer;

    const query = targetLayer.createQuery();
    const clauses: string[] = [];

    if (this.state.selectedMunicipality !== "ALL") {
      clauses.push(`id_municipio = '${this.state.selectedMunicipality}'`);
    } else if (this.state.selectedDistrict !== "ALL") {
      clauses.push(`distrito = '${this.state.selectedDistrict}'`);
    }

    if (clauses.length === 0) {
      this.view.goTo({ center: [-8.2245, 39.55], zoom: 7 });
      return;
    }

    query.where = clauses.join(" AND ");
    query.returnGeometry = true;

    try {
      const extent = await targetLayer.queryExtent(query);
      if (extent && extent.extent) {
        this.view.goTo(extent.extent.expand(1.15), { duration: 900 });
      }
    } catch {
      // Fallback
    }
  }
}
