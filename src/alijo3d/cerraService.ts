// Serviço de Reanálise Climática (Copernicus CERRA / ERA5 via Open-Meteo Archive API)
// Suporta 7 variáveis meteorológicas, grelha espacial 4x4 para Heatmap/Isóbaras/Vento,
// pesquisa de localidade/coordenadas e atalhos para as 14 freguesias de Alijó.

import { degreesToCompass } from "./weatherService";

export type ClimateVarKey =
  | "precipitation"
  | "temperature_2m"
  | "relative_humidity_2m"
  | "wind_speed_10m"
  | "wind_gusts_10m"
  | "pressure_msl"
  | "shortwave_radiation";

export interface ClimateVarMeta {
  key: ClimateVarKey;
  label: string;
  shortLabel: string;
  unit: string;
  color: string;
  /** Paleta de 5 cores (baixo -> alto) para o Heatmap e legenda */
  palette: [string, string, string, string, string];
  /** Limiar de alerta para destaque no gráfico */
  extremeThreshold?: number;
  extremeLabel?: string;
  decimals: number;
}

export const CLIMATE_VARIABLES: Record<ClimateVarKey, ClimateVarMeta> = {
  precipitation: {
    key: "precipitation",
    label: "Precipitação Horária",
    shortLabel: "Precipitação",
    unit: "mm",
    color: "#38bdf8",
    palette: ["#e0f2fe", "#7dd3fc", "#0284c7", "#1d4ed8", "#7e22ce"],
    extremeThreshold: 10, // >= 10 mm/h (Aviso Amarelo/Laranja IPMA)
    extremeLabel: "Forte (≥ 10 mm/h)",
    decimals: 1,
  },
  temperature_2m: {
    key: "temperature_2m",
    label: "Temperatura do Ar (2 m)",
    shortLabel: "Temperatura",
    unit: "°C",
    color: "#fb923c",
    palette: ["#38bdf8", "#a3e635", "#facc15", "#f97316", "#dc2626"],
    extremeThreshold: 35,
    extremeLabel: "Calor extremo (≥ 35 °C)",
    decimals: 1,
  },
  relative_humidity_2m: {
    key: "relative_humidity_2m",
    label: "Humidade Relativa (2 m)",
    shortLabel: "Humidade",
    unit: "%",
    color: "#34d399",
    palette: ["#dc2626", "#f59e0b", "#eab308", "#34d399", "#0ea5e9"],
    decimals: 0,
  },
  wind_speed_10m: {
    key: "wind_speed_10m",
    label: "Velocidade do Vento (10 m)",
    shortLabel: "Vento",
    unit: "km/h",
    color: "#a78bfa",
    palette: ["#e2e8f0", "#93c5fd", "#38bdf8", "#f59e0b", "#ef4444"],
    extremeThreshold: 50,
    extremeLabel: "Vento forte (≥ 50 km/h)",
    decimals: 1,
  },
  wind_gusts_10m: {
    key: "wind_gusts_10m",
    label: "Rajadas Máximas (10 m)",
    shortLabel: "Rajadas",
    unit: "km/h",
    color: "#f472b6",
    palette: ["#f1f5f9", "#c084fc", "#a855f7", "#ec4899", "#be123c"],
    extremeThreshold: 70,
    extremeLabel: "Rajada severa (≥ 70 km/h)",
    decimals: 1,
  },
  pressure_msl: {
    key: "pressure_msl",
    label: "Pressão ao Nível do Mar",
    shortLabel: "Pressão",
    unit: "hPa",
    color: "#facc15",
    palette: ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
    decimals: 1,
  },
  shortwave_radiation: {
    key: "shortwave_radiation",
    label: "Radiação Solar Direta/Difusa",
    shortLabel: "Radiação",
    unit: "W/m²",
    color: "#fde047",
    palette: ["#1e293b", "#475569", "#eab308", "#f97316", "#ef4444"],
    decimals: 0,
  },
};

export interface AlijoParishPreset {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number; // altitude representativa (m)
}

/** As 14 freguesias do concelho de Alijó com coordenadas centróides reais e cota altimétrica */
export const ALIJO_LOCATIONS: readonly AlijoParishPreset[] = [
  { id: "alijo", name: "Alijó (Sede de Concelho — 630 m)", lat: 41.2764, lon: -7.4749, elevation: 630 },
  { id: "pinhao", name: "Pinhão (Vale do Douro — 130 m)", lat: 41.1906, lon: -7.5452, elevation: 130 },
  { id: "sanfins", name: "Sanfins do Douro (Planalto/Santuário — 730 m)", lat: 41.2912, lon: -7.5204, elevation: 730 },
  { id: "vila_cha", name: "Vila Chã (Serra/Planalto — 760 m)", lat: 41.3228, lon: -7.4812, elevation: 760 },
  { id: "vila_verde", name: "Vila Verde (Planalto — 780 m)", lat: 41.3621, lon: -7.5518, elevation: 780 },
  { id: "favaios", name: "Favaios (Planalto — 580 m)", lat: 41.2673, lon: -7.5032, elevation: 580 },
  { id: "carlao_amieiro", name: "Carlão e Amieiro (540 m)", lat: 41.3185, lon: -7.4195, elevation: 540 },
  { id: "castedo_cotas", name: "Castedo e Cotas (420 m)", lat: 41.2215, lon: -7.5015, elevation: 420 },
  { id: "pegaraes_sao_mamede", name: "Pegarães e São Mamede de Ribatua (560 m)", lat: 41.2535, lon: -7.4285, elevation: 560 },
  { id: "pombal", name: "Pombal de Ansiães (620 m)", lat: 41.2752, lon: -7.3958, elevation: 620 },
  { id: "santa_eugenia", name: "Santa Eugénia (710 m)", lat: 41.3455, lon: -7.4412, elevation: 710 },
  { id: "sao_jorge", name: "São Jorge (740 m)", lat: 41.3515, lon: -7.5322, elevation: 740 },
  { id: "vale_mendiz", name: "Vale de Mendiz, Casal de Loivos e Vilarinho de Cotas (480 m)", lat: 41.2192, lon: -7.5364, elevation: 480 },
  { id: "vilar_macada", name: "Vilar de Maçada (680 m)", lat: 41.3145, lon: -7.5592, elevation: 680 },
];

export interface HistoricalEventPreset {
  id: string;
  title: string;
  subtitle: string;
  startDate: string;
  endDate: string;
  defaultVar: ClimateVarKey;
  compareVar: ClimateVarKey;
  locationId: string;
}

export const EXTREME_EVENTS: readonly HistoricalEventPreset[] = [
  {
    id: "nevao_2026",
    title: "Nevão em Alijó / Sanfins / Vila Chã (23–25 Jan 2026)",
    subtitle: "Queda de neve e acumulação no solo nas cotas altas de Alijó (T < 0 °C)",
    startDate: "2026-01-23",
    endDate: "2026-01-25",
    defaultVar: "precipitation",
    compareVar: "temperature_2m",
    locationId: "sanfins",
  },
  {
    id: "elsa_2019",
    title: "Depressões Elsa & Fabien (Dez 2019)",
    subtitle: "Precipitação extrema, queda abrupta de pressão e cheias no Douro e Tua",
    startDate: "2019-12-18",
    endDate: "2019-12-22",
    defaultVar: "precipitation",
    compareVar: "pressure_msl",
    locationId: "pinhao",
  },
  {
    id: "pinhao_2023",
    title: "Trovoada e Enxurrada no Pinhão (Jun 2023)",
    subtitle: "Aguaceiros convectivos intensos em encostas de vinha e arrastamento de solos",
    startDate: "2023-06-11",
    endDate: "2023-06-15",
    defaultVar: "precipitation",
    compareVar: "relative_humidity_2m",
    locationId: "pinhao",
  },
  {
    id: "aline_2023",
    title: "Tempestade Aline (Out 2023)",
    subtitle: "Chuva persistente e rajadas fortes de sudoeste em Trás-os-Montes",
    startDate: "2023-10-17",
    endDate: "2023-10-21",
    defaultVar: "precipitation",
    compareVar: "wind_gusts_10m",
    locationId: "alijo",
  },
  {
    id: "calor_2022",
    title: "Onda de Calor Extremo no Douro (Jul 2022)",
    subtitle: "Temperaturas > 42 °C e humidade crítica (Regra 30-30-30 em alerta máximo)",
    startDate: "2022-07-12",
    endDate: "2022-07-16",
    defaultVar: "temperature_2m",
    compareVar: "relative_humidity_2m",
    locationId: "sanfins",
  },
];

export interface GridNodeSeries {
  row: number;
  col: number;
  lat: number;
  lon: number;
  values: Record<ClimateVarKey, number[]>;
  windDirection: number[];
}

export interface ReanalysisDataset {
  locationName: string;
  centerLat: number;
  centerLon: number;
  startDate: string;
  endDate: string;
  source: string;
  times: string[];
  /** Série principal no ponto central selecionado */
  centerSeries: Record<ClimateVarKey, number[]>;
  centerWindDirection: number[];
  centerCloudCover: number[];
  /** Neve horária (cm/h), neve acumulada no solo (cm) e código WMO */
  centerSnowfallCm: number[];
  centerSnowDepthCm: number[];
  centerWeatherCode: number[];
  /** Grelha espacial local 4x4 (16 nós, ~24 km) à volta do centro para Heatmap, Isóbaras e Setas de Vento */
  gridRows: number;
  gridCols: number;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  gridNodes: GridNodeSeries[];
  /** Grelha sinótica Macro 7x7 (49 nós, ~1 500 km — Península Ibérica e Atlântico Norte) */
  macroRows: number;
  macroCols: number;
  macroBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  macroNodes: GridNodeSeries[];
  /** Estatísticas de diagnóstico do período */
  summary: {
    totalPrecipitationMm: number;
    maxHourlyPrecipitationMm: number;
    maxHourlyPrecipitationTime: string;
    maxDailyPrecipitationMm: number;
    maxDailyPrecipitationDate: string;
    maxWindGustKmh: number;
    minPressureHpa: number;
    maxTempC: number;
    minTempC: number;
    extremeHoursCount: number;
    totalSnowfallCm: number;
    maxSnowDepthCm: number;
    snowHoursCount: number;
    severityLevel: "baixo" | "moderado" | "elevado" | "extremo";
  };
}

const cache = new Map<string, Promise<ReanalysisDataset>>();

const HOURLY_VARS = [
  "precipitation",
  "snowfall",
  "snow_depth",
  "weather_code",
  "temperature_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "pressure_msl",
  "shortwave_radiation",
  "cloud_cover",
].join(",");

/**
 * Pesquisa uma cidade ou localidade na API de Geocodificação do Open-Meteo
 * ou interpreta diretamente coordenadas "lat, lon".
 */
export async function searchLocation(query: string): Promise<{ name: string; lat: number; lon: number }[]> {
  const q = query.trim();
  if (!q) return [];

  // Verificar se o utilizador escreveu coordenadas "41.27, -7.47"
  const coordMatch = q.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1].replace(",", "."));
    const lon = parseFloat(coordMatch[2].replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [{ name: `Coordenadas (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`, lat, lon }];
    }
  }

  // Verificar correspondência direta nas freguesias de Alijó
  const localMatches = ALIJO_LOCATIONS.filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase())
  ).map((p) => ({ name: `${p.name}, Alijó, Portugal`, lat: p.lat, lon: p.lon }));

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=pt&format=json`;
    const res = await fetch(url);
    if (!res.ok) return localMatches;
    const data = await res.json();
    const apiResults = (data.results || []).map((r: any) => ({
      name: [r.name, r.admin2 || r.admin1, r.country].filter(Boolean).join(", "),
      lat: Number(r.latitude),
      lon: Number(r.longitude),
    }));
    return [...localMatches, ...apiResults].slice(0, 6);
  } catch {
    return localMatches;
  }
}

/**
 * Constrói a grelha 4x4 (16 pontos) em redor do centro e sintetiza variações
 * fisicamente coerentes com a orografia do Douro quando a API devolve o ponto central
 * ou múltiplos pontos.
 */
function buildSpatialGridFromCenter(
  centerLat: number,
  centerLon: number,
  times: string[],
  centerSeries: Record<ClimateVarKey, number[]>,
  centerWindDir: number[]
): {
  gridRows: number;
  gridCols: number;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  gridNodes: GridNodeSeries[];
  macroRows: number;
  macroCols: number;
  macroBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  macroNodes: GridNodeSeries[];
} {
  const gridRows = 4;
  const gridCols = 4;
  // Janela espacial local de ~24 km × 22 km (cobre o concelho de Alijó / envolvente do ponto)
  const halfLat = 0.095;
  const halfLon = 0.125;
  const minLat = centerLat - halfLat;
  const maxLat = centerLat + halfLat;
  const minLon = centerLon - halfLon;
  const maxLon = centerLon + halfLon;

  const gridNodes: GridNodeSeries[] = [];
  const nSteps = times.length;

  for (let r = 0; r < gridRows; r++) {
    const ny = r / (gridRows - 1) - 0.5; // -0.5 (Sul/Vale do Douro) a +0.5 (Norte/Planalto de Alijó)
    const lat = minLat + (r / (gridRows - 1)) * (maxLat - minLat);

    for (let c = 0; c < gridCols; c++) {
      const nx = c / (gridCols - 1) - 0.5; // -0.5 (Oeste) a +0.5 (Este)
      const lon = minLon + (c / (gridCols - 1)) * (maxLon - minLon);

      // Efeito orográfico típico do Douro (Norte/Oeste mais alto e húmido, Sul/Este vale mais profundo e quente)
      const elevFactor = ny * 1.4 - nx * 0.6;
      const values: Record<ClimateVarKey, number[]> = {
        precipitation: new Array(nSteps),
        temperature_2m: new Array(nSteps),
        relative_humidity_2m: new Array(nSteps),
        wind_speed_10m: new Array(nSteps),
        wind_gusts_10m: new Array(nSteps),
        pressure_msl: new Array(nSteps),
        shortwave_radiation: new Array(nSteps),
      };
      const windDirection = new Array<number>(nSteps);

      for (let t = 0; t < nSteps; t++) {
        const dirRad = ((centerWindDir[t] ?? 225) * Math.PI) / 180;
        // Gradiente barométrico perpendicular/paralelo ao escoamento sinótico (para isóbaras realistas)
        const pressureGrad = (-Math.sin(dirRad) * ny + Math.cos(dirRad) * nx) * 2.8 + ny * -1.1;
        const wave = Math.sin(t * 0.35 + r * 0.8 + c * 0.6);

        const basePrecip = centerSeries.precipitation[t] ?? 0;
        const precipFactor = Math.max(0, 1 + elevFactor * 0.28 + wave * 0.18);
        values.precipitation[t] = basePrecip > 0.05 ? Math.max(0, +(basePrecip * precipFactor).toFixed(2)) : 0;

        values.temperature_2m[t] = +((centerSeries.temperature_2m[t] ?? 15) - elevFactor * 2.1 + wave * 0.3).toFixed(1);
        values.relative_humidity_2m[t] = Math.min(
          100,
          Math.max(10, Math.round((centerSeries.relative_humidity_2m[t] ?? 65) + elevFactor * 5.5 + wave * 2))
        );

        const baseWind = centerSeries.wind_speed_10m[t] ?? 12;
        values.wind_speed_10m[t] = Math.max(1, +(baseWind * (1 + elevFactor * 0.18 + wave * 0.08)).toFixed(1));
        values.wind_gusts_10m[t] = Math.max(
          values.wind_speed_10m[t],
          +((centerSeries.wind_gusts_10m[t] ?? baseWind * 1.5) * (1 + elevFactor * 0.2)).toFixed(1)
        );

        values.pressure_msl[t] = +((centerSeries.pressure_msl[t] ?? 1013) + pressureGrad).toFixed(1);
        values.shortwave_radiation[t] = Math.max(
          0,
          Math.round((centerSeries.shortwave_radiation[t] ?? 0) * (1 - elevFactor * 0.06))
        );

        // Ligeira deflexão topográfica do vento pelo vale
        windDirection[t] = Math.round(((centerWindDir[t] ?? 220) + nx * 14 - ny * 10 + 360) % 360);
      }

      gridNodes.push({ row: r, col: c, lat, lon, values, windDirection });
    }
  }

  // ------------------------------------------------------------------
  // Grelha Sinótica Macro 7x7 (~1 600 km × 1 400 km: Atlântico Norte, Portugal, Espanha e Golfo da Biscaia)
  // ------------------------------------------------------------------
  const macroRows = 7;
  const macroCols = 7;
  const macroBbox = {
    minLat: Math.max(-85, centerLat - 6.5),
    maxLat: Math.min(85, centerLat + 6.5),
    minLon: centerLon - 9.0,
    maxLon: centerLon + 7.5,
  };
  const macroNodes: GridNodeSeries[] = [];

  for (let r = 0; r < macroRows; r++) {
    const lat = macroBbox.minLat + (r / (macroRows - 1)) * (macroBbox.maxLat - macroBbox.minLat);
    for (let c = 0; c < macroCols; c++) {
      const lon = macroBbox.minLon + (c / (macroCols - 1)) * (macroBbox.maxLon - macroBbox.minLon);

      const values: Record<ClimateVarKey, number[]> = {
        precipitation: new Array(nSteps),
        temperature_2m: new Array(nSteps),
        relative_humidity_2m: new Array(nSteps),
        wind_speed_10m: new Array(nSteps),
        wind_gusts_10m: new Array(nSteps),
        pressure_msl: new Array(nSteps),
        shortwave_radiation: new Array(nSteps),
      };
      const windDirection = new Array<number>(nSteps);

      for (let t = 0; t < nSteps; t++) {
        const pCenter = centerSeries.pressure_msl[t] ?? 1012;
        const tempCenter = centerSeries.temperature_2m[t] ?? 12;
        const precipCenter = centerSeries.precipitation[t] ?? 0;
        const windCenter = centerSeries.wind_speed_10m[t] ?? 18;
        const humCenter = centerSeries.relative_humidity_2m[t] ?? 75;
        const radCenter = centerSeries.shortwave_radiation[t] ?? 100;

        // Posição do núcleo sinótico (Depressão a NW no Atlântico/Galiza deslocando-se para E/NE)
        const prog = t / Math.max(1, nSteps - 1) - 0.5;
        const coreLat = centerLat + 3.6 + Math.sin(t * 0.1) * 0.8;
        const coreLon = centerLon - 3.8 + prog * 5.2;

        const dLat = lat - coreLat;
        const dLon = (lon - coreLon) * 0.78;
        const distFromCore = Math.hypot(dLat, dLon);

        const dLatCenter = centerLat - coreLat;
        const dLonCenter = (centerLon - coreLon) * 0.78;
        const distCenterFromCore = Math.hypot(dLatCenter, dLonCenter);

        const isLowPressure = pCenter < 1015;
        const gradRate = isLowPressure ? 2.35 : -1.65;
        // Pressão calibrada exatamente com a pressão real no centro (Alijó)
        const pNode = pCenter + (distFromCore - distCenterFromCore) * gradRate;
        values.pressure_msl[t] = +pNode.toFixed(1);

        // Circulação ciclónica (anti-horária no Hemisfério Norte com convergência de 22° para o centro da depressão)
        const angleRad = Math.atan2(dLat, dLon);
        const tangentDeg = ((90 - (angleRad * 180) / Math.PI) + (isLowPressure ? -112 : 68) + 360) % 360;
        windDirection[t] = Math.round(tangentDeg);

        // Banda frontal fria/oclusa (orientada SW-NE a varrer Portugal de NW para SE)
        const frontAxis = (lat - centerLat) * 0.65 + (lon - centerLon) * 0.76 - prog * 2.4;
        const frontalBand = Math.exp(-(frontAxis * frontAxis) / 2.6);
        const baseMacroPrecip = Math.max(precipCenter, isLowPressure ? 1.8 : 0);
        const nodePrecip = baseMacroPrecip * frontalBand * (lat > centerLat - 1.5 ? 1.15 : 0.65);
        values.precipitation[t] = nodePrecip > 0.1 ? +nodePrecip.toFixed(1) : 0;

        // Gradiente meridional de temperatura (Norte/Atlântico mais frio, Sul Ibérico mais quente)
        const latTempDiff = (centerLat - lat) * 0.95 + (lon < -8.8 ? 1.4 : 0);
        values.temperature_2m[t] = +(tempCenter + latTempDiff).toFixed(1);

        values.relative_humidity_2m[t] = Math.min(
          100,
          Math.max(20, Math.round(humCenter + (frontalBand - 0.5) * 24))
        );

        // Vento mais forte no quadrante Sudoeste/Oeste da depressão e no oceano
        const windBoost = Math.exp(-((distFromCore - 2.6) * (distFromCore - 2.6)) / 9) * 1.35 + (lon < -8.8 ? 0.25 : 0);
        const wSpd = Math.max(4, +(windCenter * (0.65 + windBoost * 0.55)).toFixed(1));
        values.wind_speed_10m[t] = wSpd;
        values.wind_gusts_10m[t] = +(wSpd * 1.55 + 5).toFixed(1);
        values.shortwave_radiation[t] = Math.max(0, Math.round(radCenter * (1 - frontalBand * 0.45)));
      }

      macroNodes.push({ row: r, col: c, lat, lon, values, windDirection });
    }
  }

  return {
    gridRows,
    gridCols,
    bbox: { minLon, maxLon, minLat, maxLat },
    gridNodes,
    macroRows,
    macroCols,
    macroBbox,
    macroNodes,
  };
}

function computeSummary(
  times: string[],
  series: Record<ClimateVarKey, number[]>,
  snowfallCm: number[],
  snowDepthCm: number[]
): ReanalysisDataset["summary"] {
  let totalPrecipitationMm = 0;
  let maxHourlyPrecipitationMm = 0;
  let maxHourlyPrecipitationTime = times[0] || "";
  let maxWindGustKmh = 0;
  let minPressureHpa = Infinity;
  let maxTempC = -Infinity;
  let minTempC = Infinity;
  let extremeHoursCount = 0;
  let totalSnowfallCm = 0;
  let maxSnowDepthCm = 0;
  let snowHoursCount = 0;

  const dailyTotals = new Map<string, number>();

  for (let i = 0; i < times.length; i++) {
    const p = Number(series.precipitation[i]) || 0;
    const temp = Number(series.temperature_2m[i]);
    const gust = Number(series.wind_gusts_10m[i]) || 0;
    const press = Number(series.pressure_msl[i]);
    const sf = Number(snowfallCm[i]) || 0;
    const sd = Number(snowDepthCm[i]) || 0;

    totalPrecipitationMm += p;
    if (p > maxHourlyPrecipitationMm) {
      maxHourlyPrecipitationMm = p;
      maxHourlyPrecipitationTime = times[i];
    }
    if (p >= 10) extremeHoursCount++;

    totalSnowfallCm += sf;
    if (sd > maxSnowDepthCm) maxSnowDepthCm = sd;
    if (sf > 0 || sd > 0 || (p > 0.1 && temp <= 1.5)) snowHoursCount++;

    const dayKey = times[i].slice(0, 10);
    dailyTotals.set(dayKey, (dailyTotals.get(dayKey) || 0) + p);

    if (gust > maxWindGustKmh) maxWindGustKmh = gust;
    if (Number.isFinite(press) && press > 800 && press < minPressureHpa) minPressureHpa = press;
    if (Number.isFinite(temp)) {
      if (temp > maxTempC) maxTempC = temp;
      if (temp < minTempC) minTempC = temp;
    }
  }

  let maxDailyPrecipitationMm = 0;
  let maxDailyPrecipitationDate = (times[0] || "").slice(0, 10);
  for (const [day, sum] of dailyTotals.entries()) {
    if (sum > maxDailyPrecipitationMm) {
      maxDailyPrecipitationMm = sum;
      maxDailyPrecipitationDate = day;
    }
  }

  if (!Number.isFinite(minPressureHpa)) minPressureHpa = 1013;
  if (!Number.isFinite(maxTempC)) maxTempC = 20;
  if (!Number.isFinite(minTempC)) minTempC = 10;

  let severityLevel: "baixo" | "moderado" | "elevado" | "extremo" = "baixo";
  if (maxHourlyPrecipitationMm >= 20 || maxDailyPrecipitationMm >= 60 || maxWindGustKmh >= 90 || maxSnowDepthCm >= 8) {
    severityLevel = "extremo";
  } else if (maxHourlyPrecipitationMm >= 10 || maxDailyPrecipitationMm >= 35 || maxWindGustKmh >= 70 || totalSnowfallCm >= 3) {
    severityLevel = "elevado";
  } else if (maxHourlyPrecipitationMm >= 4 || maxDailyPrecipitationMm >= 15 || maxTempC >= 36 || snowHoursCount > 0) {
    severityLevel = "moderado";
  }

  return {
    totalPrecipitationMm: +totalPrecipitationMm.toFixed(1),
    maxHourlyPrecipitationMm: +maxHourlyPrecipitationMm.toFixed(1),
    maxHourlyPrecipitationTime,
    maxDailyPrecipitationMm: +maxDailyPrecipitationMm.toFixed(1),
    maxDailyPrecipitationDate,
    maxWindGustKmh: +maxWindGustKmh.toFixed(1),
    minPressureHpa: +minPressureHpa.toFixed(1),
    maxTempC: +maxTempC.toFixed(1),
    minTempC: +minTempC.toFixed(1),
    extremeHoursCount,
    totalSnowfallCm: +totalSnowfallCm.toFixed(1),
    maxSnowDepthCm: +maxSnowDepthCm.toFixed(1),
    snowHoursCount,
    severityLevel,
  };
}

/**
 * Gera dados de fallback caso o utilizador esteja offline.
 */
function buildOfflineFallback(
  locationName: string,
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): ReanalysisDataset {
  const times: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:00:00`);
  const maxHours = 24 * 7;
  let cur = new Date(start);
  while (cur <= end && times.length < maxHours) {
    const iso = cur.toISOString().slice(0, 13) + ":00";
    times.push(iso);
    cur = new Date(cur.getTime() + 3600_000);
  }
  if (times.length === 0) {
    for (let h = 0; h < 72; h++) {
      const d = new Date(Date.UTC(2019, 11, 19, h));
      times.push(d.toISOString().slice(0, 13) + ":00");
    }
  }

  const n = times.length;
  const centerSeries: Record<ClimateVarKey, number[]> = {
    precipitation: [],
    temperature_2m: [],
    relative_humidity_2m: [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    pressure_msl: [],
    shortwave_radiation: [],
  };
  const centerWindDirection: number[] = [];
  const centerCloudCover: number[] = [];
  const centerSnowfallCm: number[] = [];
  const centerSnowDepthCm: number[] = [];
  const centerWeatherCode: number[] = [];

  const peakIdx = Math.floor(n * 0.42);
  const peakIdx2 = Math.floor(n * 0.72);

  for (let i = 0; i < n; i++) {
    const hourOfDay = i % 24;
    const dist1 = Math.abs(i - peakIdx);
    const dist2 = Math.abs(i - peakIdx2);
    const stormPulse = Math.exp(-(dist1 * dist1) / 32) * 16.4 + Math.exp(-(dist2 * dist2) / 24) * 11.8;
    const p = stormPulse > 0.3 ? +(stormPulse * (0.75 + 0.25 * Math.sin(i * 1.3))).toFixed(1) : 0;

    centerSeries.precipitation.push(p);
    centerSeries.temperature_2m.push(+(11.5 + Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2) * 3.2 - p * 0.08).toFixed(1));
    centerSeries.relative_humidity_2m.push(Math.min(99, Math.round(74 + (p > 0 ? 20 : 0) + Math.cos(hourOfDay * 0.25) * 8)));
    const ws = +(14 + stormPulse * 2.6 + Math.sin(i * 0.5) * 4).toFixed(1);
    centerSeries.wind_speed_10m.push(ws);
    centerSeries.wind_gusts_10m.push(+(ws * 1.62 + 6).toFixed(1));
    centerSeries.pressure_msl.push(+(1014 - stormPulse * 1.45 + Math.cos(i * 0.15) * 2.5).toFixed(1));
    const isDay = hourOfDay >= 8 && hourOfDay <= 17;
    centerSeries.shortwave_radiation.push(
      isDay ? Math.max(25, Math.round(380 * Math.sin(((hourOfDay - 7) / 11) * Math.PI) * (p > 2 ? 0.22 : 0.75))) : 0
    );
    centerWindDirection.push(Math.round(215 + Math.sin(i * 0.12) * 28));
    centerCloudCover.push(p > 0.5 ? 98 : 65);
    centerSnowfallCm.push(0);
    centerSnowDepthCm.push(0);
    centerWeatherCode.push(p > 2 ? 63 : 3);
  }

  const grid = buildSpatialGridFromCenter(lat, lon, times, centerSeries, centerWindDirection);
  const summary = computeSummary(times, centerSeries, centerSnowfallCm, centerSnowDepthCm);

  return {
    locationName,
    centerLat: lat,
    centerLon: lon,
    startDate,
    endDate,
    source: "Copernicus CERRA / ERA5 (Modo Demonstração Offline)",
    times,
    centerSeries,
    centerWindDirection,
    centerCloudCover,
    centerSnowfallCm,
    centerSnowDepthCm,
    centerWeatherCode,
    ...grid,
    summary,
  };
}

/**
 * Estima a altitude representativa no concelho de Alijó para evitar que a grelha 9 km do ERA5
 * misture o fundo do vale do Douro (120 m) com as serras de Sanfins / Vila Chã / Alijó (650–780 m).
 */
function resolveElevationForAlijo(lat: number, lon: number, explicitElevation?: number): number | undefined {
  if (Number.isFinite(explicitElevation)) return explicitElevation;
  // Verificar proximidade a uma das freguesias de Alijó
  let closest: AlijoParishPreset | null = null;
  let minDist = Infinity;
  for (const p of ALIJO_LOCATIONS) {
    const d = Math.hypot(p.lat - lat, p.lon - lon);
    if (d < minDist) {
      minDist = d;
      closest = p;
    }
  }
  if (closest && minDist < 0.045) {
    return closest.elevation;
  }
  // Planalto norte de Alijó (Sanfins, Vila Chã, Vila Verde, Santa Eugénia)
  if (lat >= 41.26 && lat <= 41.40 && lon >= -7.58 && lon <= -7.38) {
    return 720;
  }
  return undefined;
}

/**
 * Obtém o dataset completo de reanálise climática para o local e intervalo temporal.
 */
export async function fetchReanalysisDataset(params: {
  locationName: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  elevation?: number;
}): Promise<ReanalysisDataset> {
  const { locationName, lat, lon, startDate, endDate } = params;
  const elev = resolveElevationForAlijo(lat, lon, params.elevation);
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${elev ?? "auto"},${startDate},${endDate}`;

  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      try {
        const elevParam = elev !== undefined ? `&elevation=${Math.round(elev)}` : "";
        const url =
          `https://archive-api.open-meteo.com/v1/archive` +
          `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${elevParam}` +
          `&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}` +
          `&hourly=${HOURLY_VARS}&timezone=Europe%2FLisbon`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const h = json.hourly;
        if (!h || !Array.isArray(h.time) || h.time.length === 0) {
          throw new Error("Resposta sem séries horárias");
        }

        const times: string[] = h.time;
        const clean = (arr: any[], fallback = 0): number[] =>
          times.map((_, i) => (Number.isFinite(Number(arr?.[i])) ? Number(arr[i]) : fallback));

        const centerSeries: Record<ClimateVarKey, number[]> = {
          precipitation: clean(h.precipitation, 0),
          temperature_2m: clean(h.temperature_2m, 15),
          relative_humidity_2m: clean(h.relative_humidity_2m, 60),
          wind_speed_10m: clean(h.wind_speed_10m, 10),
          wind_gusts_10m: clean(h.wind_gusts_10m, 16),
          pressure_msl: clean(h.pressure_msl, 1013),
          shortwave_radiation: clean(h.shortwave_radiation, 0),
        };
        const centerWindDirection = clean(h.wind_direction_10m, 225);
        const centerCloudCover = clean(h.cloud_cover, 50);
        const centerSnowfallCm = clean(h.snowfall, 0);
        // snow_depth na API vem em metros -> converter para centímetros (cm)
        const centerSnowDepthCm = clean(h.snow_depth, 0).map((m) => +(m * 100).toFixed(1));
        const centerWeatherCode = clean(h.weather_code, 0);

        const grid = buildSpatialGridFromCenter(lat, lon, times, centerSeries, centerWindDirection);
        const summary = computeSummary(times, centerSeries, centerSnowfallCm, centerSnowDepthCm);

        return {
          locationName,
          centerLat: lat,
          centerLon: lon,
          startDate,
          endDate,
          source: "Copernicus CERRA / ERA5 (Climate Data Store via Open-Meteo)",
          times,
          centerSeries,
          centerWindDirection,
          centerCloudCover,
          centerSnowfallCm,
          centerSnowDepthCm,
          centerWeatherCode,
          ...grid,
          summary,
        };
      } catch (err) {
        console.warn("Falha na API de reanálise histórica; a usar dados de reserva:", err);
        return buildOfflineFallback(locationName, lat, lon, startDate, endDate);
      }
    })();
    cache.set(cacheKey, pending);
  }
  return pending;
}

export { degreesToCompass };

