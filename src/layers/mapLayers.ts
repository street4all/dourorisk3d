import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import { INDICATORS } from "../data/types";
import { createIndicatorRenderer } from "./renderers";
import { createMunicipalPopupTemplate, createParishPopupTemplate } from "./popups";

export interface LayersContext {
  municipalitiesLayer: GeoJSONLayer;
  parishesLayer: GeoJSONLayer;
}

/**
 * Creates and initializes both GeoJSON layers
 */
export function createMapLayers(): LayersContext {
  const municipalitiesLayer = new GeoJSONLayer({
    id: "municipalities-layer",
    title: "Municípios de Portugal",
    url: "/data/portugal-municipios.geojson",
    copyright: "DGT (CAOP) / INE Portugal",
    outFields: ["*"],
    popupTemplate: createMunicipalPopupTemplate(),
    renderer: createIndicatorRenderer(INDICATORS.densidade_empresas, false),
    opacity: 0.9,
    visible: true,
  });

  const parishesLayer = new GeoJSONLayer({
    id: "parishes-layer",
    title: "Freguesias de Portugal",
    url: "/data/portugal-freguesias.geojson",
    copyright: "DGT (CAOP) / Censos INE",
    outFields: ["*"],
    popupTemplate: createParishPopupTemplate(),
    renderer: createIndicatorRenderer(INDICATORS.pct_empregadores, true),
    opacity: 0.92,
    visible: false, // Initially false when viewing national municipality overview
  });

  return { municipalitiesLayer, parishesLayer };
}
