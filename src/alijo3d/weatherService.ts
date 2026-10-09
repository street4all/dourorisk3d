export interface LiveWeatherReport {
  provider: string;
  stationName: string;
  time: string;
  temperature: number; // °C
  humidity: number; // %
  precipitation: number; // mm
  rain: number; // mm
  cloudCover: number; // %
  windSpeed: number; // km/h
  windDirection: number; // graus
  windDirectionText: string;
  windGusts?: number; // km/h
  weatherCode: number;
  description: string;
  isRaining: boolean;
  pressure?: number;
  radiation?: number;
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Céu Limpo",
  1: "Principalmente Limpo",
  2: "Parcialmente Nublado",
  3: "Encoberto",
  45: "Nevoeiro",
  48: "Nevoeiro com geada",
  51: "Chuvisco Ligeiro",
  53: "Chuvisco Moderado",
  55: "Chuvisco Denso",
  61: "Chuva Fraca",
  63: "Chuva Moderada",
  65: "Chuva Forte",
  80: "Aguaceiros Fracos",
  81: "Aguaceiros Moderados",
  82: "Aguaceiros Violentos",
  95: "Trovoada",
  96: "Trovoada com Granizo Ligeiro",
  99: "Trovoada com Granizo Forte",
};

const COMPASS_MAP: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

const IPMA_WEATHER_TYPES: Record<number, string> = {
  1: "Céu limpo",
  2: "Céu pouco nublado",
  3: "Céu parcialmente nublado",
  4: "Céu muito nublado ou encoberto",
  5: "Céu nublado por nuvens altas",
  6: "Aguaceiros / Chuva",
  7: "Aguaceiros fracos",
  8: "Aguaceiros fortes",
  9: "Chuva / períodos de chuva",
  10: "Chuva fraca",
  11: "Chuva forte",
  12: "Nevoeiro / neblina",
  13: "Neve",
  14: "Trovoada",
  15: "Trovoada com aguaceiros",
  16: "Granizo",
  17: "Geada",
  18: "Chuva e trovoada",
  19: "Aguaceiros e trovoada",
  20: "Chuva com neve",
  21: "Aguaceiros de neve",
  22: "Nevina",
  23: "Céu com abertas",
  24: "Nevoeiro matinal",
  25: "Vento forte e chuva",
};

/**
 * Converts wind direction degrees to compass rose abbreviation
 */
export function degreesToCompass(deg: number): string {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round((deg % 360) / 22.5) % 16;
  return directions[index];
}

/**
 * Fetches official real-time meteorological observations from IPMA
 * (Instituto Português do Mar e da Atmosfera)
 * Targets station 1210655 (Pinhão, Santa Bárbara - Concelho de Alijó)
 */
export async function fetchIPMALiveWeather(): Promise<LiveWeatherReport> {
  const PINHAO_STATION_ID = 1210655; // Pinhão, Santa Bárbara (Alijó)
  const VILA_REAL_STATION_ID = 1200567; // Vila Real (fallback regional)

  const obsResponse = await fetch(
    "https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson"
  );
  if (!obsResponse.ok) {
    throw new Error(`Falha na API IPMA: ${obsResponse.statusText}`);
  }

  const obsGeo = await obsResponse.json();
  const features = obsGeo.features || [];

  let target = features.find((f: any) => f.properties?.idEstacao === PINHAO_STATION_ID)?.properties;

  // Fallback to Vila Real if Pinhao is temporarily offline or has -99 readings
  if (!target || target.temperatura === -99) {
    const fallback = features.find((f: any) => f.properties?.idEstacao === VILA_REAL_STATION_ID)?.properties;
    if (fallback) target = fallback;
  }

  if (!target) {
    throw new Error("Estação meteorológica do IPMA em Alijó/Douro não encontrada.");
  }

  // Fetch forecast weather type for Vila Real / Douro area
  let weatherDesc = "Céu Limpo";
  let weatherCode = 1;
  let isRaining = (target.precAcumulada ?? 0) > 0;
  let cloudCover = 25;

  try {
    const fcRes = await fetch(
      "https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/1171400.json"
    );
    if (fcRes.ok) {
      const fcData = await fcRes.json();
      const today = fcData.data?.[0];
      if (today) {
        weatherCode = today.idWeatherType;
        weatherDesc = IPMA_WEATHER_TYPES[weatherCode] || "Condições Estáveis";
        if (weatherCode >= 6 && weatherCode <= 11) isRaining = true;
        cloudCover = weatherCode >= 4 ? 85 : weatherCode >= 2 ? 45 : 15;
      }
    }
  } catch (err) {
    console.warn("Could not fetch IPMA forecast classification:", err);
  }

  const dirStr = target.descDirVento || "N";
  const windDirDeg = COMPASS_MAP[dirStr] ?? 0;

  return {
    provider: "IPMA (Oficial Portugal)",
    stationName: target.localEstacao || "Pinhão, Santa Bárbara (Alijó)",
    time: target.time,
    temperature: target.temperatura,
    humidity: target.humidade,
    precipitation: target.precAcumulada >= 0 ? target.precAcumulada : 0,
    rain: target.precAcumulada >= 0 ? target.precAcumulada : 0,
    cloudCover,
    windSpeed: target.intensidadeVentoKM >= 0 ? target.intensidadeVentoKM : 10,
    windDirection: windDirDeg,
    windDirectionText: dirStr,
    weatherCode,
    description: weatherDesc,
    isRaining,
    pressure: target.pressao > 0 ? target.pressao : undefined,
    radiation: target.radiacao > 0 ? target.radiacao : undefined,
  };
}

/**
 * Fetches real current weather telemetry from Open-Meteo for Alijó (lat: 41.276, lon: -7.475)
 */
export async function fetchOpenMeteoLiveWeather(): Promise<LiveWeatherReport> {
  const lat = 41.276;
  const lon = -7.475;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha na API Open-Meteo: ${response.statusText}`);
  }

  const data = await response.json();
  const current = data.current;

  const weatherCode = current.weather_code ?? 0;
  const isRaining = (current.precipitation ?? 0) > 0 || (current.rain ?? 0) > 0 || weatherCode >= 51;
  const windDir = current.wind_direction_10m ?? 0;

  return {
    provider: "Open-Meteo (ECMWF)",
    stationName: "Alijó (Centro Urbano)",
    time: current.time,
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    precipitation: current.precipitation ?? 0,
    rain: current.rain ?? 0,
    cloudCover: current.cloud_cover ?? 0,
    windSpeed: current.wind_speed_10m ?? 12,
    windDirection: windDir,
    windDirectionText: degreesToCompass(windDir),
    windGusts: current.wind_gusts_10m,
    weatherCode,
    description: WMO_DESCRIPTIONS[weatherCode] || "Condições Variáveis",
    isRaining,
  };
}

/**
 * Backward compatibility alias
 */
export const fetchAlijoLiveWeather = fetchOpenMeteoLiveWeather;

/**
 * Unified getter by provider
 */
export async function fetchWeather(provider: "ipma" | "open-meteo"): Promise<LiveWeatherReport> {
  if (provider === "ipma") {
    return fetchIPMALiveWeather();
  }
  return fetchOpenMeteoLiveWeather();
}
