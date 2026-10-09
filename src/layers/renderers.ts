import ClassBreaksRenderer from "@arcgis/core/renderers/ClassBreaksRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import type { EconomicIndicator } from "../data/types";

/**
 * Creates an outline symbol based on current mode/layer
 */
function createOutline(isParish: boolean): SimpleLineSymbol {
  return new SimpleLineSymbol({
    color: isParish ? [255, 255, 255, 0.4] : [255, 255, 255, 0.7],
    width: isParish ? 0.5 : 1.2,
  });
}

/**
 * Generates an ArcGIS ClassBreaksRenderer for any configured indicator
 */
export function createIndicatorRenderer(indicator: EconomicIndicator, isParish = false): ClassBreaksRenderer {
  const outline = createOutline(isParish);

  const classBreakInfos = indicator.breaks.map((b) => ({
    minValue: b.minValue,
    maxValue: b.maxValue,
    symbol: new SimpleFillSymbol({
      color: b.color,
      outline,
    }),
    label: b.label,
  }));

  return new ClassBreaksRenderer({
    field: indicator.attributeField,
    legendOptions: {
      title: indicator.label + " (" + indicator.unit + ")",
    },
    defaultSymbol: new SimpleFillSymbol({
      color: [200, 200, 200, 0.4],
      outline,
    }),
    defaultLabel: "Sem dados ou sigilo estatístico",
    classBreakInfos,
  });
}
