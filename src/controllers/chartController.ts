import type MapView from "@arcgis/core/views/MapView.js";
import type GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import { INDICATORS } from "../data/types";
import type { EconomicIndicator } from "../data/types";

export interface ChartItem {
  id: string;
  name: string;
  value: number;
  secondary: string;
  geometry: any;
}

export class ChartController {
  private view: MapView;
  private municipalitiesLayer: GeoJSONLayer;
  private parishesLayer: GeoJSONLayer;
  private containerElement: HTMLElement;
  private kpiTitleElement: HTMLElement | null = null;
  private kpiValueElement: HTMLElement | null = null;
  private kpiSubElement: HTMLElement | null = null;

  constructor(
    view: MapView,
    municipalitiesLayer: GeoJSONLayer,
    parishesLayer: GeoJSONLayer,
    containerElement: HTMLElement
  ) {
    this.view = view;
    this.municipalitiesLayer = municipalitiesLayer;
    this.parishesLayer = parishesLayer;
    this.containerElement = containerElement;

    this.kpiTitleElement = document.getElementById("kpi-title");
    this.kpiValueElement = document.getElementById("kpi-value");
    this.kpiSubElement = document.getElementById("kpi-sub");
  }

  public async update(
    indicatorId: string,
    district: string,
    municipalityId: string,
    activeLayerName: "municipalities" | "parishes"
  ): Promise<void> {
    const indicator = INDICATORS[indicatorId];
    if (!indicator) return;

    const layer = activeLayerName === "parishes" ? this.parishesLayer : this.municipalitiesLayer;
    const query = layer.createQuery();

    const clauses: string[] = [];
    if (municipalityId !== "ALL") {
      clauses.push(`id_municipio = '${municipalityId}'`);
    } else if (district !== "ALL") {
      clauses.push(`distrito = '${district}'`);
    }

    query.where = clauses.length > 0 ? clauses.join(" AND ") : "1=1";
    query.outFields = ["*"];
    query.returnGeometry = true;

    try {
      const featureSet = await layer.queryFeatures(query);
      const items: ChartItem[] = [];

      let totalVal = 0;
      let count = 0;

      featureSet.features.forEach((f) => {
        const val = f.attributes[indicator.attributeField];
        if (typeof val === "number" && !isNaN(val)) {
          totalVal += val;
          count++;
          const name =
            activeLayerName === "parishes"
              ? f.attributes.nome_freguesia
              : f.attributes.nome_municipio;
          const secondary =
            activeLayerName === "parishes"
              ? f.attributes.nome_municipio
              : f.attributes.distrito;

          items.push({
            id: activeLayerName === "parishes" ? f.attributes.id_freguesia : f.attributes.id_municipio,
            name,
            secondary,
            value: val,
            geometry: f.geometry,
          });
        }
      });

      // Sort descending
      items.sort((a, b) => b.value - a.value);

      // Update KPI
      this.updateKPIs(items, totalVal, count, indicator, activeLayerName, municipalityId, district);

      // Render chart list (top 10 items)
      this.renderBars(items.slice(0, 10), indicator);
    } catch (err) {
      console.warn("Chart query error:", err);
    }
  }

  private updateKPIs(
    items: ChartItem[],
    totalVal: number,
    count: number,
    indicator: EconomicIndicator,
    activeLayerName: string,
    municipalityId: string,
    district: string
  ): void {
    if (!this.kpiTitleElement || !this.kpiValueElement || !this.kpiSubElement) return;

    if (count === 0) {
      this.kpiTitleElement.textContent = "Sem dados";
      this.kpiValueElement.textContent = "-";
      this.kpiSubElement.textContent = "Nenhum território cumpre os critérios.";
      return;
    }

    const avg = Math.round((totalVal / count) * 10) / 10;
    const topItem = items[0];

    const scopeName =
      municipalityId !== "ALL"
        ? `Concelho selecionado (${topItem ? topItem.secondary : ""})`
        : district !== "ALL"
        ? `Distrito de ${district}`
        : "Portugal Continental";

    this.kpiTitleElement.textContent = `${indicator.label} — ${scopeName}`;
    this.kpiValueElement.textContent = `${avg} ${indicator.unit}`;
    this.kpiSubElement.textContent = `Média de ${count} ${
      activeLayerName === "parishes" ? "freguesias" : "municípios"
    }. Destaque: ${topItem.name} (${topItem.value} ${indicator.unit}).`;
  }

  private renderBars(items: ChartItem[], indicator: EconomicIndicator): void {
    if (items.length === 0) {
      this.containerElement.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--calcite-color-text-3);">
          Nenhum elemento a apresentar para os filtros selecionados.
        </div>
      `;
      return;
    }

    const maxValue = Math.max(...items.map((i) => i.value), 1);

    let html = `
      <div class="chart-list-container">
        <div class="chart-header">
          <span>Top 10 Territórios</span>
          <span style="font-weight: 600;">${indicator.unit}</span>
        </div>
    `;

    items.forEach((item, index) => {
      const pct = Math.min(Math.round((item.value / maxValue) * 100), 100);
      html += `
        <div class="chart-row" data-id="${item.id}" tabindex="0">
          <div class="chart-row-info">
            <span class="chart-rank">#${index + 1}</span>
            <span class="chart-name" title="${item.name}">${item.name}</span>
            <span class="chart-value">${item.value}</span>
          </div>
          <div class="chart-bar-bg">
            <div class="chart-bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    this.containerElement.innerHTML = html;

    // Attach click listeners to rows to highlight on map
    const rows = this.containerElement.querySelectorAll(".chart-row");
    rows.forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-id");
        const found = items.find((i) => i.id === id);
        if (found && found.geometry) {
          this.view.goTo(found.geometry.extent ? found.geometry.extent.expand(1.4) : found.geometry, {
            duration: 800,
          });
          this.view.openPopup({
            location: found.geometry.extent ? found.geometry.extent.center : found.geometry,
            features: [
              {
                geometry: found.geometry,
                attributes: { ...found },
              } as any,
            ],
          });
        }
      });
    });
  }
}
