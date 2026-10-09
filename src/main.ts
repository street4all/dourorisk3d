import "./style.css";

// Calcite Components Web Component imports (controlos dentro das janelas do Modo Visita)
import "@esri/calcite-components/components/calcite-icon";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-select";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-slider";
import "@esri/calcite-components/components/calcite-switch";
import "@esri/calcite-components/components/calcite-chip";
import "@esri/calcite-components/components/calcite-segmented-control";
import "@esri/calcite-components/components/calcite-segmented-control-item";

// 3D Scene Manager and Live Weather Service
import { Alijo3DManager } from "./alijo3d/alijoScene";
import { fetchWeather } from "./alijo3d/weatherService";
import { applyAccessibleLayers, renderLegend } from "./visit/layers";
import { VisitMode } from "./visit/visitMode";

let alijo3dManager: Alijo3DManager | null = null;

async function initializeApp() {
  // 0. Camadas DouroRisk com escala segura para daltonismo (antes de criar a cena)
  applyAccessibleLayers();

  // 1. Initialize dedicated 3D SceneView directly into container
  alijo3dManager = new Alijo3DManager("alijo-scene-container");
  await alijo3dManager.initialize();

  // A visita começa com a paisagem limpa: a camada de risco abre-se nos passos
  alijo3dManager.setDouroRiskVisible(false);
  // e com céu limpo até chegar o tempo real do Pinhão
  alijo3dManager.setRainEnabled(false);

  // 2. Modo Visita (antes dos controlos, para receber o primeiro tempo ao vivo)
  new VisitMode(alijo3dManager).init();

  // 3. Setup all UI controls and event listeners
  setupThemeToggle();
  setup3DControls(alijo3dManager);
}

// Dark / Light Theme Toggle
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  if (!themeToggleBtn) return;
  const icon = themeToggleBtn.querySelector("calcite-icon");

  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("calcite-mode-dark");
    document.body.classList.toggle("calcite-mode-dark", !isDark);
    document.body.classList.toggle("calcite-mode-light", isDark);
    const label = isDark ? "Modo escuro" : "Modo claro";
    themeToggleBtn.setAttribute("aria-label", label);
    themeToggleBtn.setAttribute("title", label);
    icon?.setAttribute("icon", isDark ? "moon" : "brightness");
  });
}

// Wire all 3D Environment, Weather, and Camera Rotation Controls
function setup3DControls(manager: Alijo3DManager) {
  // UI Elements
  const windElevMode = document.getElementById("wind-elev-mode") as any;
  const windOffsetSlider = document.getElementById("wind-offset-slider") as any;
  const windOffsetLabel = document.getElementById("wind-offset-label");
  const windSpeedSlider = document.getElementById("wind-speed-slider") as any;
  const windSpeedLabel = document.getElementById("wind-speed-label");
  const windDensitySlider = document.getElementById("wind-density-slider") as any;
  const windToggle = document.getElementById("wind-toggle") as any;

  const rainToggle = document.getElementById("rain-toggle") as any;
  const rainIntensitySlider = document.getElementById("rain-intensity-slider") as any;
  const rainIntensityLabel = document.getElementById("rain-intensity-label");
  const cloudCoverSlider = document.getElementById("cloud-cover-slider") as any;
  const cloudCoverLabel = document.getElementById("cloud-cover-label");

  const weatherBadge = document.getElementById("live-weather-badge") as any;
  const providerSelect = document.getElementById("weather-provider-select") as any;
  const syncWeatherBtn = document.getElementById("sync-weather-btn");

  const telemetryStation = document.getElementById("telemetry-station");
  const telemetryDesc = document.getElementById("telemetry-desc");
  const telemetryTemp = document.getElementById("telemetry-temp");
  const telemetryHum = document.getElementById("telemetry-hum");
  const telemetryWind = document.getElementById("telemetry-wind");
  const telemetryDir = document.getElementById("telemetry-dir");
  const telemetryRain = document.getElementById("telemetry-rain");
  const telemetryCloud = document.getElementById("telemetry-cloud");

  // Sync Live Weather from IPMA / Open-Meteo
  const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "sem dados");
  let weatherRequest = 0; // só a resposta do pedido mais recente conta
  const syncLiveWeather = async () => {
    const req = ++weatherRequest;
    if (weatherBadge) {
      weatherBadge.kind = "neutral";
      weatherBadge.textContent = "A atualizar…";
    }
    syncWeatherBtn?.setAttribute("disabled", "");

    try {
      const provider = providerSelect?.value || "ipma";
      const weather = await fetchWeather(provider as any);
      if (req !== weatherRequest) return;

      if (telemetryStation) telemetryStation.textContent = weather.stationName;
      if (telemetryDesc) telemetryDesc.textContent = weather.description;
      if (telemetryTemp) telemetryTemp.textContent = fmt(weather.temperature);
      if (telemetryHum) telemetryHum.textContent = fmt(weather.humidity, 0);
      if (telemetryWind) telemetryWind.textContent = fmt(weather.windSpeed);
      if (telemetryDir) telemetryDir.textContent = `${weather.windDirection}° (${weather.windDirectionText})`;
      if (telemetryRain) telemetryRain.textContent = fmt(weather.precipitation);
      if (telemetryCloud) telemetryCloud.textContent = `${weather.cloudCover}`;

      if (weatherBadge) {
        weatherBadge.kind = "brand";
        weatherBadge.textContent = provider === "ipma" ? "IPMA" : "Open-Meteo";
      }

      // o motor 3D precisa de um número: sem medição de vento usa um valor calmo
      manager.updateFromLiveTelemetry({ ...weather, windSpeed: Number.isFinite(weather.windSpeed) ? weather.windSpeed : 10 });
      window.dispatchEvent(new CustomEvent("live-weather", { detail: weather }));

      // Reflect in sliders (com os valores que o motor está mesmo a usar)
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
      const st = manager.state;
      if (windSpeedSlider) windSpeedSlider.value = clamp(st.windSpeed, 5, 45);
      if (windSpeedLabel) windSpeedLabel.textContent = `${clamp(st.windSpeed, 5, 45)}`;
      if (rainIntensitySlider) rainIntensitySlider.value = clamp(st.rainPrecipitation * 100, 10, 100);
      if (rainIntensityLabel) rainIntensityLabel.textContent = `${clamp(st.rainPrecipitation * 100, 0, 100)}%`;
      if (cloudCoverSlider) cloudCoverSlider.value = clamp(st.cloudCover * 100, 20, 100);
      if (cloudCoverLabel) cloudCoverLabel.textContent = `${clamp(st.cloudCover * 100, 0, 100)}%`;
    } catch (err) {
      if (req !== weatherRequest) return;
      console.warn("Could not fetch live weather:", err);
      if (weatherBadge) {
        weatherBadge.kind = "inverse";
        weatherBadge.textContent = "Sem ligação";
      }
      window.dispatchEvent(new CustomEvent("live-weather-error"));
    } finally {
      if (req === weatherRequest) syncWeatherBtn?.removeAttribute("disabled");
    }
  };

  syncWeatherBtn?.addEventListener("click", syncLiveWeather);
  providerSelect?.addEventListener("calciteSegmentedControlChange", syncLiveWeather);

  // Auto-sync live weather on startup e de 30 em 30 minutos (quiosque ligado o dia todo)
  syncLiveWeather();
  window.setInterval(syncLiveWeather, 30 * 60_000);

  // Wind Elevation Mode & Altitude Offset
  const updateElevation = () => {
    const mode = windElevMode?.value || "relative-to-ground";
    const offset = Number(windOffsetSlider?.value || 1400);
    if (windOffsetLabel) windOffsetLabel.textContent = `${offset.toLocaleString("pt-PT")} m`;
    manager.setWindElevation(mode, offset);
  };

  windElevMode?.addEventListener("calciteSelectChange", updateElevation);
  windOffsetSlider?.addEventListener("calciteSliderInput", updateElevation);

  // Wind Speed & Density
  windSpeedSlider?.addEventListener("calciteSliderInput", () => {
    const spd = Number(windSpeedSlider.value);
    if (windSpeedLabel) windSpeedLabel.textContent = `${spd}`;
    manager.setWindSpeed(spd);
  });

  windDensitySlider?.addEventListener("calciteSliderInput", () => {
    const den = Number(windDensitySlider.value);
    manager.setWindDensity(den);
  });

  // Wind Toggle (FlowRenderer On/Off - Opcional)
  const windToggleOlha = document.getElementById("wind-toggle-olha") as any;
  const setWind = (val: boolean) => {
    manager.setWindVisible(val);
    if (windToggle && windToggle.checked !== val) windToggle.checked = val;
    if (windToggleOlha && windToggleOlha.checked !== val) windToggleOlha.checked = val;
  };
  windToggle?.addEventListener("calciteSwitchChange", () => setWind(Boolean(windToggle.checked)));
  windToggleOlha?.addEventListener("calciteSwitchChange", () => setWind(Boolean(windToggleOlha.checked)));

  // Rain Toggle & Intensity
  rainToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setRainEnabled(rainToggle.checked);
  });

  rainIntensitySlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(rainIntensitySlider.value);
    if (rainIntensityLabel) rainIntensityLabel.textContent = `${val}%`;
    manager.setRainPrecipitation(val / 100);
  });

  cloudCoverSlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(cloudCoverSlider.value);
    if (cloudCoverLabel) cloudCoverLabel.textContent = `${val}%`;
    manager.setCloudCover(val / 100);
  });

  // DouroRisk Wildfire Risk Layer Controls
  const douroriskToggle = document.getElementById("dourorisk-toggle") as any;
  const douroriskModelSelect = document.getElementById("dourorisk-model-select") as any;
  const douroriskOpacitySlider = document.getElementById("dourorisk-opacity-slider") as any;
  const douroriskOpacityLabel = document.getElementById("dourorisk-opacity-label");

  // Legenda acessível da camada escolhida: cor + número + palavra (nunca só a cor)
  const updateDouroRiskStats = (modelKey: string) => {
    renderLegend(document.getElementById("dourorisk-stats-items"), modelKey);
  };
  updateDouroRiskStats(douroriskModelSelect?.value || "risco_2025");

  // O Modo Visita guarda o estado da camada (pistas, "onde ardeu", legendas): avisá-lo
  const announceLayer = () =>
    window.dispatchEvent(
      new CustomEvent("risk-layer", { detail: { key: douroriskModelSelect?.value, visible: !!douroriskToggle?.checked } }),
    );

  douroriskToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setDouroRiskVisible(douroriskToggle.checked);
    announceLayer();
  });

  douroriskModelSelect?.addEventListener("calciteSelectChange", () => {
    const val = douroriskModelSelect.value;
    manager.setDouroRiskModel(val);
    updateDouroRiskStats(val);
    announceLayer();
  });

  douroriskOpacitySlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(douroriskOpacitySlider.value);
    if (douroriskOpacityLabel) douroriskOpacityLabel.textContent = `${val}%`;
    manager.setDouroRiskOpacity(val / 100);
  });

  // Territorial Boundaries Toggles
  const parishesToggle = document.getElementById("parishes-toggle") as any;
  parishesToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setParishesVisible(parishesToggle.checked);
  });

  const concelhoToggle = document.getElementById("concelho-toggle") as any;
  concelhoToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setConcelhoVisible(concelhoToggle.checked);
  });

  // 3D Buildings & Trees Toggles
  const buildingsToggle = document.getElementById("buildings-toggle") as any;
  buildingsToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setSanfinsBuildingsVisible(buildingsToggle.checked);
  });

  const treesToggle = document.getElementById("trees-toggle") as any;
  treesToggle?.addEventListener("calciteSwitchChange", () => {
    manager.setSanfinsTreesVisible(treesToggle.checked);
  });

  // Solar Time & Cast Shadows Slider
  const sunTimeSlider = document.getElementById("sun-time-slider") as any;
  const sunTimeLabel = document.getElementById("sun-time-label");
  sunTimeSlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(sunTimeSlider.value);
    const h = Math.floor(val);
    const m = Math.round((val - h) * 60);
    const mStr = m < 10 ? `0${m}` : `${m}`;
    const desc = val >= 18 ? "Pôr do Sol" : val >= 16.5 ? "Fim de Tarde Dourado" : val >= 12 ? "Meio-Dia" : "Manhã";
    if (sunTimeLabel) sunTimeLabel.textContent = `${h}:${mStr} (${desc})`;
    manager.setSolarHour(val);
  });

  // Camera Rotation & Perspective Angle Controls
  const camHeadingSlider = document.getElementById("cam-heading-slider") as any;
  const camHeadingLabel = document.getElementById("cam-heading-label");
  const camTiltSlider = document.getElementById("cam-tilt-slider") as any;
  const camTiltLabel = document.getElementById("cam-tilt-label");
  const orbitBtn = document.getElementById("btn-toggle-orbit") as any;

  const getCompassDirection = (deg: number): string => {
    const d = ((deg % 360) + 360) % 360;
    if (d >= 337.5 || d < 22.5) return "Norte";
    if (d >= 22.5 && d < 67.5) return "Nordeste";
    if (d >= 67.5 && d < 112.5) return "Este";
    if (d >= 112.5 && d < 157.5) return "Sudeste";
    if (d >= 157.5 && d < 202.5) return "Sul";
    if (d >= 202.5 && d < 247.5) return "Sudoeste";
    if (d >= 247.5 && d < 292.5) return "Oeste";
    return "Noroeste";
  };

  const updateCamLabels = (heading: number, tilt: number) => {
    if (camHeadingSlider && Math.abs(Number(camHeadingSlider.value) - heading) > 1) {
      camHeadingSlider.value = heading;
    }
    if (camHeadingLabel) camHeadingLabel.textContent = `${heading}° (${getCompassDirection(heading)})`;

    if (camTiltSlider && Math.abs(Number(camTiltSlider.value) - tilt) > 1) {
      camTiltSlider.value = tilt;
    }
    const tiltDesc = tilt <= 10 ? "Vista Aérea 2D" : tilt >= 75 ? "Rasante / Horizonte" : "Perspetiva 3D";
    if (camTiltLabel) camTiltLabel.textContent = `${tilt}° (${tiltDesc})`;
  };

  manager.onCameraChange((heading, tilt) => {
    updateCamLabels(heading, tilt);
  });

  // Heading slider manual adjustment
  camHeadingSlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(camHeadingSlider.value);
    if (camHeadingLabel) camHeadingLabel.textContent = `${val}° (${getCompassDirection(val)})`;
    manager.setHeading(val, false);
  });

  // Tilt slider manual adjustment
  camTiltSlider?.addEventListener("calciteSliderInput", () => {
    const val = Number(camTiltSlider.value);
    const tiltDesc = val <= 10 ? "Vista Aérea 2D" : val >= 75 ? "Rasante / Horizonte" : "Perspetiva 3D";
    if (camTiltLabel) camTiltLabel.textContent = `${val}° (${tiltDesc})`;
    manager.setTilt(val, false);
  });

  // Cardinal direction buttons
  // texto fixo ("Dar a volta"); o estado vai só em aria-pressed
  const resetOrbitBtn = () => {
    if (orbitBtn) {
      orbitBtn.setAttribute("aria-pressed", "false");
    }
  };

  document.getElementById("btn-cardinal-north")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.setHeading(0);
  });
  document.getElementById("btn-cardinal-east")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.setHeading(90);
  });
  document.getElementById("btn-cardinal-south")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.setHeading(180);
  });
  document.getElementById("btn-cardinal-west")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.setHeading(270);
  });

  // Relative rotation buttons
  document.getElementById("btn-rotate-left")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.rotateBy(-45);
  });
  document.getElementById("btn-rotate-right")?.addEventListener("click", () => {
    resetOrbitBtn();
    manager.rotateBy(45);
  });

  // Continuous 360 Orbit Mode
  orbitBtn?.addEventListener("click", () => {
    if (manager.state.isOrbiting) {
      manager.stopOrbit();
      resetOrbitBtn();
    } else {
      manager.startOrbit(0.3);
      orbitBtn.setAttribute("aria-pressed", "true");
    }
  });

  // Scenic Presets Navigation
  // outros passos (ex.: "Ver Sanfins de perto", quiosque) também param a volta
  window.addEventListener("orbit-stopped", resetOrbitBtn);

  const handlePreset = (preset: "santuario" | "sanfins" | "pinhao" | "favaios" | "tua" | "general") => {
    resetOrbitBtn();
    manager.goToPreset(preset);
  };

  // Connect both Header and Panel Preset buttons
  document.getElementById("header-preset-santuario")?.addEventListener("click", () => handlePreset("santuario"));
  document.getElementById("header-preset-sanfins")?.addEventListener("click", () => handlePreset("sanfins"));
  document.getElementById("header-preset-pinhao")?.addEventListener("click", () => handlePreset("pinhao"));
  document.getElementById("header-preset-favaios")?.addEventListener("click", () => handlePreset("favaios"));
  document.getElementById("header-preset-tua")?.addEventListener("click", () => handlePreset("tua"));
  document.getElementById("header-preset-general")?.addEventListener("click", () => handlePreset("general"));
  document.getElementById("btn-focus-church")?.addEventListener("click", () => handlePreset("santuario"));
}

// Start application
window.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});
