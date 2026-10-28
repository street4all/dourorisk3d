// Painel de Reanálise Climática (Copernicus CERRA / ERA5) e Precipitação Extrema (#climate-card)
// Permite escolher intervalo temporal e localização (freguesia de Alijó, pesquisa de cidade, coordenadas ou clique no mapa 3D),
// visualizar mapas sobrepostos (Heatmap, Isóbaras e Setas de Vento), comparar séries temporais para 7 variáveis
// meteorológicas e consultar impactos e boas práticas para territórios de baixa densidade (Douro).

import type { Alijo3DManager } from "../alijo3d/alijoScene";
import {
  ALIJO_LOCATIONS,
  CLIMATE_VARIABLES,
  EXTREME_EVENTS,
  degreesToCompass,
  fetchReanalysisDataset,
  searchLocation,
  type ClimateVarKey,
  type ReanalysisDataset,
} from "../alijo3d/cerraService";
import { ClimateMapOverlay } from "./climateMapOverlay";
import { esc } from "./words";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function formatDateTimePt(iso: string): string {
  if (!iso) return "";
  const [datePart, timePart = "00:00"] = iso.split("T");
  const [y, m, d] = datePart.split("-");
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const mLabel = months[Math.max(0, Math.min(11, Number(m) - 1))] || m;
  return `${d} ${mLabel} ${y} · ${timePart.slice(0, 5)}`;
}

export interface ClimatePanelHooks {
  opened(): void;
  say(msg: string): void;
}

export class ClimatePanel {
  private overlay: ClimateMapOverlay | null = null;
  private dataset: ReanalysisDataset | null = null;
  private isOpen = false;
  private isPickingPoint = false;

  private currentLat = ALIJO_LOCATIONS[2].lat; // Sanfins do Douro por omissão (Nevão Jan 2026)
  private currentLon = ALIJO_LOCATIONS[2].lon;
  private currentLocationName = ALIJO_LOCATIONS[2].name;
  private startDate = EXTREME_EVENTS[0].startDate;
  private endDate = EXTREME_EVENTS[0].endDate;

  private primaryVar: ClimateVarKey = EXTREME_EVENTS[0].defaultVar;
  private compareVar: ClimateVarKey = EXTREME_EVENTS[0].compareVar;
  private currentStepIdx = 0;
  private sync3DEnvironment = true;

  private playTimer: number | null = null;
  private requestSeq = 0;

  constructor(
    private manager: Alijo3DManager,
    private hooks: ClimatePanelHooks
  ) {}

  public get open(): boolean {
    return this.isOpen;
  }

  public get pickingPoint(): boolean {
    return this.isOpen && this.isPickingPoint;
  }

  public init(): void {
    const map = this.manager.view?.map;
    if (!map) return;
    this.overlay = new ClimateMapOverlay(map);

    this.populateControls();
    this.wireEvents();
  }

  public setOpen(next: boolean): void {
    if (this.isOpen === next) return;
    this.isOpen = next;
    const card = $("climate-card");
    const btn = $("btn-climate");
    if (card) card.hidden = !next;
    btn?.setAttribute("aria-pressed", String(next));
    document.body.classList.toggle("climate-open", next);

    if (next) {
      this.hooks.opened();
      $("climate-title")?.focus();
      if (!this.dataset) {
        void this.loadReanalysis();
      } else {
        this.renderCurrentStep();
      }
    } else {
      this.stopPlayback();
      this.setPickMode(false);
      this.overlay?.clear();
      this.manager.applyWeather();
      btn?.focus();
    }
  }

  public handleMapClick(lon: number, lat: number): void {
    if (!this.pickingPoint) return;
    this.setPickMode(false);
    this.currentLat = +lat.toFixed(4);
    this.currentLon = +lon.toFixed(4);
    this.currentLocationName = `Ponto no Mapa (${this.currentLat.toFixed(3)}° N, ${Math.abs(this.currentLon).toFixed(3)}° W)`;

    const parishSel = $("climate-parish-select") as HTMLSelectElement | null;
    if (parishSel) parishSel.value = "custom";

    this.hooks.say(`Localização escolhida no mapa: ${this.currentLocationName}. A carregar reanálise CERRA.`);
    void this.loadReanalysis();
  }

  private setPickMode(active: boolean): void {
    this.isPickingPoint = active;
    const pickBtn = $("climate-pick-map");
    pickBtn?.setAttribute("aria-pressed", String(active));
    if (pickBtn) {
      pickBtn.textContent = active ? "Toca num ponto do mapa 3D…" : "Escolher ponto no mapa 3D";
    }
    document.body.classList.toggle("probing", active);
  }

  private populateControls(): void {
    // 1. Eventos históricos
    const eventSel = $("climate-event-select") as HTMLSelectElement | null;
    if (eventSel) {
      eventSel.innerHTML =
        EXTREME_EVENTS.map(
          (ev) => `<option value="${esc(ev.id)}">${esc(ev.title)}</option>`
        ).join("") + `<option value="custom">Intervalo personalizado…</option>`;
    }

    // 2. Freguesias de Alijó
    const parishSel = $("climate-parish-select") as HTMLSelectElement | null;
    if (parishSel) {
      parishSel.innerHTML =
        ALIJO_LOCATIONS.map(
          (p) => `<option value="${esc(p.id)}" ${p.id === "sanfins" ? "selected" : ""}>${esc(p.name)}</option>`
        ).join("") + `<option value="custom">Outro local / Coordenadas</option>`;
    }

    // 3. Seletores das 7 variáveis meteorológicas
    const varKeys = Object.keys(CLIMATE_VARIABLES) as ClimateVarKey[];
    const primarySel = $("climate-var-primary") as HTMLSelectElement | null;
    const compareSel = $("climate-var-compare") as HTMLSelectElement | null;

    if (primarySel) {
      primarySel.innerHTML = varKeys
        .map(
          (k) =>
            `<option value="${k}" ${k === this.primaryVar ? "selected" : ""}>${esc(
              CLIMATE_VARIABLES[k].label
            )} (${esc(CLIMATE_VARIABLES[k].unit)})</option>`
        )
        .join("");
    }

    if (compareSel) {
      compareSel.innerHTML = varKeys
        .map(
          (k) =>
            `<option value="${k}" ${k === this.compareVar ? "selected" : ""}>${esc(
              CLIMATE_VARIABLES[k].label
            )} (${esc(CLIMATE_VARIABLES[k].unit)})</option>`
        )
        .join("");
    }

    // 4. Datas iniciais
    const startInput = $("climate-start-date") as HTMLInputElement | null;
    const endInput = $("climate-end-date") as HTMLInputElement | null;
    if (startInput) startInput.value = this.startDate;
    if (endInput) endInput.value = this.endDate;
  }

  private wireEvents(): void {
    $("btn-climate")?.addEventListener("click", () => this.setOpen(!this.isOpen));
    $("climate-close")?.addEventListener("click", () => this.setOpen(false));

    // Escolha de evento histórico pré-definido
    $("climate-event-select")?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value;
      const preset = EXTREME_EVENTS.find((ev) => ev.id === val);
      if (!preset) return;

      this.startDate = preset.startDate;
      this.endDate = preset.endDate;
      this.primaryVar = preset.defaultVar;
      this.compareVar = preset.compareVar;

      const startInput = $("climate-start-date") as HTMLInputElement | null;
      const endInput = $("climate-end-date") as HTMLInputElement | null;
      if (startInput) startInput.value = this.startDate;
      if (endInput) endInput.value = this.endDate;

      const primarySel = $("climate-var-primary") as HTMLSelectElement | null;
      const compareSel = $("climate-var-compare") as HTMLSelectElement | null;
      if (primarySel) primarySel.value = this.primaryVar;
      if (compareSel) compareSel.value = this.compareVar;

      const loc = ALIJO_LOCATIONS.find((l) => l.id === preset.locationId);
      if (loc) {
        this.currentLat = loc.lat;
        this.currentLon = loc.lon;
        this.currentLocationName = loc.name;
        const parishSel = $("climate-parish-select") as HTMLSelectElement | null;
        if (parishSel) parishSel.value = loc.id;
      }

      void this.loadReanalysis();
    });

    // Escolha de freguesia de Alijó
    $("climate-parish-select")?.addEventListener("change", (e) => {
      const id = (e.target as HTMLSelectElement).value;
      const loc = ALIJO_LOCATIONS.find((l) => l.id === id);
      if (!loc) return;
      this.currentLat = loc.lat;
      this.currentLon = loc.lon;
      this.currentLocationName = loc.name;
      this.flyToLocation(loc.lon, loc.lat);
      void this.loadReanalysis();
    });

    // Botão de clicar no mapa 3D
    $("climate-pick-map")?.addEventListener("click", () => {
      this.setPickMode(!this.isPickingPoint);
    });

    // Pesquisa de cidade / país / coordenadas
    const runSearch = async () => {
      const input = $("climate-search-input") as HTMLInputElement | null;
      const list = $("climate-search-results");
      if (!input || !list) return;
      const q = input.value.trim();
      if (!q) {
        list.hidden = true;
        return;
      }
      list.hidden = false;
      list.innerHTML = `<li class="climate-search-item">A procurar "${esc(q)}"…</li>`;
      const results = await searchLocation(q);
      if (results.length === 0) {
        list.innerHTML = `<li class="climate-search-item">Nenhum resultado para "${esc(q)}".</li>`;
        return;
      }
      list.innerHTML = results
        .map(
          (r, idx) =>
            `<li><button type="button" class="climate-search-btn" data-idx="${idx}">${esc(r.name)} <small>(${r.lat.toFixed(
              2
            )}°, ${r.lon.toFixed(2)}°)</small></button></li>`
        )
        .join("");

      list.querySelectorAll<HTMLButtonElement>(".climate-search-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const picked = results[Number(b.dataset.idx)];
          if (!picked) return;
          list.hidden = true;
          this.currentLat = picked.lat;
          this.currentLon = picked.lon;
          this.currentLocationName = picked.name;
          const parishSel = $("climate-parish-select") as HTMLSelectElement | null;
          if (parishSel) parishSel.value = "custom";
          this.flyToLocation(picked.lon, picked.lat);
          void this.loadReanalysis();
        });
      });
    };

    $("climate-search-btn")?.addEventListener("click", () => void runSearch());
    $("climate-search-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void runSearch();
      }
    });

    // Aplicar intervalo de datas personalizado
    $("climate-apply-dates")?.addEventListener("click", () => {
      const startInput = $("climate-start-date") as HTMLInputElement | null;
      const endInput = $("climate-end-date") as HTMLInputElement | null;
      if (!startInput || !endInput) return;

      let s = startInput.value;
      let e = endInput.value;
      if (!s || !e) return;
      if (s > e) [s, e] = [e, s];

      // Limitar a 31 dias por consulta horária para manter fluidez no gráfico e grelha
      const d0 = new Date(s).getTime();
      const d1 = new Date(e).getTime();
      if (d1 - d0 > 31 * 86400_000) {
        const clampedEnd = new Date(d0 + 31 * 86400_000).toISOString().slice(0, 10);
        e = clampedEnd;
        endInput.value = e;
        this.hooks.say("Intervalo ajustado para 31 dias (máximo recomendado para resolução horária).");
      }

      this.startDate = s;
      this.endDate = e;
      const eventSel = $("climate-event-select") as HTMLSelectElement | null;
      if (eventSel) eventSel.value = "custom";
      void this.loadReanalysis();
    });

    // Variável principal e de comparação
    $("climate-var-primary")?.addEventListener("change", (e) => {
      this.primaryVar = (e.target as HTMLSelectElement).value as ClimateVarKey;
      this.renderCurrentStep();
      this.renderTimeSeriesChart();
    });

    $("climate-var-compare")?.addEventListener("change", (e) => {
      this.compareVar = (e.target as HTMLSelectElement).value as ClimateVarKey;
      this.renderTimeSeriesChart();
    });

    // Checkboxes das camadas espaciais sobrepostas
    $("climate-chk-heatmap")?.addEventListener("change", (e) => {
      if (!this.overlay) return;
      this.overlay.showHeatmap = (e.target as HTMLInputElement).checked;
      this.renderCurrentStep();
    });

    $("climate-chk-isobars")?.addEventListener("change", (e) => {
      if (!this.overlay) return;
      this.overlay.showIsobars = (e.target as HTMLInputElement).checked;
      this.renderCurrentStep();
    });

    $("climate-chk-wind")?.addEventListener("change", (e) => {
      if (!this.overlay) return;
      this.overlay.showWindArrows = (e.target as HTMLInputElement).checked;
      this.renderCurrentStep();
    });

    $("climate-chk-3denv")?.addEventListener("change", (e) => {
      this.sync3DEnvironment = (e.target as HTMLInputElement).checked;
      this.renderCurrentStep();
    });

    // Slider temporal e botão Play/Pause
    $("climate-time-slider")?.addEventListener("input", (e) => {
      this.stopPlayback();
      this.currentStepIdx = Number((e.target as HTMLInputElement).value) || 0;
      this.renderCurrentStep();
      this.updateChartCursor();
    });

    $("climate-play-btn")?.addEventListener("click", () => {
      if (this.playTimer !== null) {
        this.stopPlayback();
      } else {
        this.startPlayback();
      }
    });
  }

  private flyToLocation(lon: number, lat: number): void {
    const view = this.manager.view;
    if (!view) return;
    void view
      .goTo(
        {
          target: [lon, lat],
          zoom: 12,
          tilt: 55,
        },
        { duration: 900 }
      )
      .catch(() => undefined);
  }

  private startPlayback(): void {
    if (!this.dataset || this.playTimer !== null) return;
    const playBtn = $("climate-play-btn");
    if (playBtn) {
      playBtn.textContent = "⏸ Parar";
      playBtn.setAttribute("aria-pressed", "true");
    }
    this.playTimer = window.setInterval(() => {
      if (!this.dataset) return;
      this.currentStepIdx = (this.currentStepIdx + 1) % this.dataset.times.length;
      const slider = $("climate-time-slider") as HTMLInputElement | null;
      if (slider) slider.value = String(this.currentStepIdx);
      this.renderCurrentStep();
      this.updateChartCursor();
    }, 650);
  }

  private stopPlayback(): void {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    const playBtn = $("climate-play-btn");
    if (playBtn) {
      playBtn.textContent = "▶ Animar horas";
      playBtn.setAttribute("aria-pressed", "false");
    }
  }

  private async loadReanalysis(): Promise<void> {
    const seq = ++this.requestSeq;
    this.stopPlayback();

    const statusEl = $("climate-status");
    if (statusEl) {
      statusEl.textContent = `A carregar reanálise Copernicus CERRA para ${this.currentLocationName}…`;
    }

    const data = await fetchReanalysisDataset({
      locationName: this.currentLocationName,
      lat: this.currentLat,
      lon: this.currentLon,
      startDate: this.startDate,
      endDate: this.endDate,
    });

    if (seq !== this.requestSeq) return;
    this.dataset = data;

    // Posicionar automaticamente no pico de precipitação (ou a meio do intervalo se não houver chuva)
    let bestIdx = Math.floor(data.times.length / 2);
    if (data.summary.maxHourlyPrecipitationMm > 0) {
      const found = data.times.indexOf(data.summary.maxHourlyPrecipitationTime);
      if (found >= 0) bestIdx = found;
    }
    this.currentStepIdx = bestIdx;

    const slider = $("climate-time-slider") as HTMLInputElement | null;
    if (slider) {
      slider.max = String(Math.max(0, data.times.length - 1));
      slider.value = String(this.currentStepIdx);
    }

    if (statusEl) {
      statusEl.textContent = `${data.locationName} · ${data.times.length} horas analisadas (${data.source})`;
    }

    this.renderCurrentStep();
    this.renderTimeSeriesChart();
    this.renderImpactAndBestPractices();
  }

  private renderCurrentStep(): void {
    if (!this.dataset || !this.overlay || !this.isOpen) return;
    const d = this.dataset;
    const idx = Math.max(0, Math.min(d.times.length - 1, this.currentStepIdx));

    // 1. Atualizar camadas sobrepostas no mapa 3D (Heatmap, Isóbaras e Setas de Vento)
    const { minVal, maxVal } = this.overlay.renderStep(d, this.primaryVar, idx);

    // 2. Atualizar etiqueta da hora ativa
    const timeLabel = $("climate-time-label");
    if (timeLabel) {
      timeLabel.textContent = formatDateTimePt(d.times[idx]);
    }

    // 3. Atualizar legenda do Heatmap
    this.renderHeatmapLegend(this.primaryVar, minVal, maxVal);

    // 4. Atualizar cartões das 7 variáveis no instante selecionado
    this.renderInstantMetrics(d, idx);

    // 5. Sincronizar ambiente 3D da cena (neve, chuva e vento 3D) se ativo
    if (this.sync3DEnvironment) {
      const rainMm = d.centerSeries.precipitation[idx] ?? 0;
      const tempC = d.centerSeries.temperature_2m[idx] ?? 10;
      const humPct = d.centerSeries.relative_humidity_2m[idx] ?? 70;
      const windKmh = d.centerSeries.wind_speed_10m[idx] ?? 10;
      const cloudPct = d.centerCloudCover[idx] ?? 50;
      const snowfallCm = d.centerSnowfallCm?.[idx] ?? 0;
      const snowDepthCm = d.centerSnowDepthCm?.[idx] ?? 0;
      const wmo = d.centerWeatherCode?.[idx] ?? 0;

      const isSnowingNow =
        snowfallCm > 0 ||
        (wmo >= 71 && wmo <= 77) ||
        wmo === 85 ||
        wmo === 86 ||
        (tempC <= 1.8 && (rainMm > 0 || humPct >= 94));
      const hasGroundSnow = snowDepthCm > 0 || isSnowingNow || (d.summary.maxSnowDepthCm > 0 && tempC <= 2.5);

      if (isSnowingNow || hasGroundSnow) {
        const snowPrecip = isSnowingNow
          ? Math.min(1, Math.max(0.35, snowfallCm / 1.5 + rainMm / 4))
          : 0.15;
        this.manager.setSnowWeather({
          precipitation: snowPrecip,
          cloudCover: Math.min(1, Math.max(0.65, cloudPct / 100)),
          snowCover: true,
        });
      } else if (rainMm > 0.2) {
        this.manager.setRainEnabled(true);
        this.manager.setRainPrecipitation(Math.min(1, 0.25 + rainMm / 15));
        this.manager.setCloudCover(Math.min(1, Math.max(0.5, cloudPct / 100)));
      } else {
        this.manager.setRainEnabled(false);
      }
      this.manager.setWindSpeed(Math.min(45, Math.max(5, windKmh)));
    }
  }

  private renderHeatmapLegend(varKey: ClimateVarKey, minVal: number, maxVal: number): void {
    const el = $("climate-heatmap-legend");
    if (!el) return;
    const meta = CLIMATE_VARIABLES[varKey];
    const stops = meta.palette.join(", ");
    const midVal = (minVal + maxVal) / 2;

    el.innerHTML = `
      <div class="climate-legend-head">
        <strong>Heatmap: ${esc(meta.shortLabel)} (${esc(meta.unit)})</strong>
        <span>Isóbaras (hPa) + Vento (km/h)</span>
      </div>
      <div class="climate-gradient-bar" style="background: linear-gradient(90deg, ${stops});"></div>
      <div class="climate-legend-ticks">
        <span>${minVal.toFixed(meta.decimals)} ${esc(meta.unit)}</span>
        <span>${midVal.toFixed(meta.decimals)} ${esc(meta.unit)}</span>
        <span>${maxVal.toFixed(meta.decimals)} ${esc(meta.unit)}</span>
      </div>
    `;
  }

  private renderInstantMetrics(d: ReanalysisDataset, idx: number): void {
    const box = $("climate-instant-grid");
    if (!box) return;

    const windDeg = d.centerWindDirection[idx] ?? 0;
    const compass = degreesToCompass(windDeg);
    const snowfallCm = d.centerSnowfallCm?.[idx] ?? 0;
    const snowDepthCm = d.centerSnowDepthCm?.[idx] ?? 0;
    const tempC = d.centerSeries.temperature_2m[idx] ?? 10;

    const precipExtra =
      snowfallCm > 0 || snowDepthCm > 0 || tempC <= 1.5
        ? `❄ Neve: ${snowfallCm.toFixed(2)} cm/h · Solo: ${snowDepthCm.toFixed(0)} cm`
        : undefined;

    const items: { key: ClimateVarKey; extra?: string }[] = [
      { key: "precipitation", extra: precipExtra },
      { key: "temperature_2m", extra: tempC <= 0 ? "❄ Congelação / Gelo" : undefined },
      { key: "relative_humidity_2m" },
      { key: "wind_speed_10m", extra: `${compass} (${windDeg}°)` },
      { key: "wind_gusts_10m" },
      { key: "pressure_msl" },
      { key: "shortwave_radiation" },
    ];

    box.innerHTML = items
      .map(({ key, extra }) => {
        const meta = CLIMATE_VARIABLES[key];
        const val = d.centerSeries[key]?.[idx] ?? 0;
        const isExtreme = meta.extremeThreshold !== undefined && val >= meta.extremeThreshold;
        const isActive = key === this.primaryVar || key === this.compareVar;
        return `
          <div class="climate-metric ${isActive ? "active" : ""} ${isExtreme ? "extreme" : ""}" style="--m-color: ${meta.color}">
            <span class="cm-label">${esc(meta.shortLabel)}</span>
            <strong class="cm-val">${val.toFixed(meta.decimals)} <small>${esc(meta.unit)}</small></strong>
            ${extra ? `<span class="cm-extra">${esc(extra)}</span>` : ""}
          </div>
        `;
      })
      .join("");
  }

  /**
   * Desenha o gráfico SVG interativo de séries temporais comparáveis (duplo eixo Y).
   */
  private renderTimeSeriesChart(): void {
    const container = $("climate-chart-box");
    if (!container || !this.dataset) return;

    const d = this.dataset;
    const n = d.times.length;
    if (n === 0) return;

    const meta1 = CLIMATE_VARIABLES[this.primaryVar];
    const meta2 = CLIMATE_VARIABLES[this.compareVar];
    const s1 = d.centerSeries[this.primaryVar];
    const s2 = d.centerSeries[this.compareVar];

    const W = 360;
    const H = 165;
    const padL = 34;
    const padR = 34;
    const padT = 16;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let min1 = Math.min(...s1);
    let max1 = Math.max(...s1);
    if (this.primaryVar === "precipitation") {
      min1 = 0;
      max1 = Math.max(max1, 5);
    } else if (Math.abs(max1 - min1) < 1) {
      min1 -= 1;
      max1 += 1;
    }

    let min2 = Math.min(...s2);
    let max2 = Math.max(...s2);
    if (this.compareVar === "precipitation") {
      min2 = 0;
      max2 = Math.max(max2, 5);
    } else if (Math.abs(max2 - min2) < 1) {
      min2 -= 1;
      max2 += 1;
    }

    const xOf = (i: number) => padL + (i / Math.max(1, n - 1)) * plotW;
    const y1Of = (v: number) => padT + plotH - ((v - min1) / Math.max(1e-5, max1 - min1)) * plotH;
    const y2Of = (v: number) => padT + plotH - ((v - min2) / Math.max(1e-5, max2 - min2)) * plotH;

    // Série 1: Barras se for precipitação (com cor branca/gelo para horas de neve), ou linha caso contrário
    let series1Svg = "";
    if (this.primaryVar === "precipitation") {
      const barW = Math.max(1.5, plotW / n - 0.6);
      series1Svg = s1
        .map((v, i) => {
          const x = xOf(i) - barW / 2;
          const y = y1Of(v);
          const h = Math.max(0, padT + plotH - y);
          const isSnowHour = (d.centerSnowfallCm?.[i] ?? 0) > 0 || (d.centerSeries.temperature_2m[i] ?? 10) <= 1.8;
          const fill = v >= 10 ? "#ef4444" : isSnowHour ? "#e0f2fe" : meta1.color;
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(
            1
          )}" fill="${fill}" opacity="0.92" />`;
        })
        .join("");
    } else {
      const pts = s1.map((v, i) => `${xOf(i).toFixed(1)},${y1Of(v).toFixed(1)}`).join(" ");
      series1Svg = `<polyline fill="none" stroke="${meta1.color}" stroke-width="2.2" points="${pts}" />`;
    }

    // Série 2 (Comparação): Linha tracejada ou contínua no eixo secundário
    let series2Svg = "";
    if (this.compareVar !== this.primaryVar) {
      const pts2 = s2.map((v, i) => `${xOf(i).toFixed(1)},${y2Of(v).toFixed(1)}`).join(" ");
      series2Svg = `<polyline fill="none" stroke="${meta2.color}" stroke-width="2" stroke-dasharray="4 2" points="${pts2}" />`;
    }

    // Linha de limiar extremo se aplicável à variável principal
    let thresholdSvg = "";
    if (meta1.extremeThreshold !== undefined && meta1.extremeThreshold >= min1 && meta1.extremeThreshold <= max1) {
      const ty = y1Of(meta1.extremeThreshold);
      thresholdSvg = `
        <line x1="${padL}" y1="${ty.toFixed(1)}" x2="${W - padR}" y2="${ty.toFixed(1)}" stroke="#ef4444" stroke-width="1.2" stroke-dasharray="3 3" />
        <text x="${padL + 4}" y="${(ty - 3).toFixed(1)}" fill="#fca5a5" font-size="8.5" font-weight="700">${esc(
        meta1.extremeLabel || "Limiar extremo"
      )}</text>
      `;
    }

    // Rótulos de data no eixo X (início, meio e fim)
    const midIdx = Math.floor(n / 2);
    const fmtDay = (iso: string) => (iso ? iso.slice(5, 10).split("-").reverse().join("/") : "");
    const cursorX = xOf(this.currentStepIdx);

    container.innerHTML = `
      <div class="climate-chart-legend">
        <span style="color:${meta1.color}">■ ${esc(meta1.shortLabel)} (${esc(meta1.unit)})</span>
        ${
          this.compareVar !== this.primaryVar
            ? `<span style="color:${meta2.color}">┄ ${esc(meta2.shortLabel)} (${esc(meta2.unit)})</span>`
            : ""
        }
      </div>
      <svg id="climate-timeseries-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de séries temporais comparáveis">
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.14)" rx="4" />
        ${thresholdSvg}
        ${series1Svg}
        ${series2Svg}
        <line id="climate-chart-cursor" x1="${cursorX.toFixed(1)}" y1="${padT}" x2="${cursorX.toFixed(
      1
    )}" y2="${padT + plotH}" stroke="#ffffff" stroke-width="1.8" />
        <!-- Eixo Y Esquerdo (Variável 1) -->
        <text x="${padL - 4}" y="${padT + 8}" text-anchor="end" fill="${meta1.color}" font-size="9" font-weight="700">${max1.toFixed(
      0
    )}</text>
        <text x="${padL - 4}" y="${padT + plotH}" text-anchor="end" fill="${meta1.color}" font-size="9">${min1.toFixed(0)}</text>
        <!-- Eixo Y Direito (Variável 2) -->
        <text x="${W - padR + 4}" y="${padT + 8}" text-anchor="start" fill="${meta2.color}" font-size="9" font-weight="700">${max2.toFixed(
      0
    )}</text>
        <text x="${W - padR + 4}" y="${padT + plotH}" text-anchor="start" fill="${meta2.color}" font-size="9">${min2.toFixed(
      0
    )}</text>
        <!-- Eixo X (Datas) -->
        <text x="${padL}" y="${H - 6}" text-anchor="start" fill="currentColor" font-size="9">${fmtDay(d.times[0])}</text>
        <text x="${xOf(midIdx).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="currentColor" font-size="9">${fmtDay(
      d.times[midIdx]
    )}</text>
        <text x="${W - padR}" y="${H - 6}" text-anchor="end" fill="currentColor" font-size="9">${fmtDay(
      d.times[n - 1]
    )}</text>
      </svg>
      <p class="climate-chart-hint">Toca num ponto do gráfico para ver o mapa nessa hora.</p>
    `;

    const svgEl = $("climate-timeseries-svg");
    svgEl?.addEventListener("click", (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const relX = ((ev.clientX - rect.left) / rect.width) * W;
      const frac = Math.max(0, Math.min(1, (relX - padL) / plotW));
      this.stopPlayback();
      this.currentStepIdx = Math.round(frac * (n - 1));
      const slider = $("climate-time-slider") as HTMLInputElement | null;
      if (slider) slider.value = String(this.currentStepIdx);
      this.renderCurrentStep();
      this.updateChartCursor();
    });
  }

  private updateChartCursor(): void {
    if (!this.dataset) return;
    const cursor = $("climate-chart-cursor");
    if (!cursor) return;
    const n = this.dataset.times.length;
    const W = 360;
    const padL = 34;
    const padR = 34;
    const plotW = W - padL - padR;
    const x = padL + (this.currentStepIdx / Math.max(1, n - 1)) * plotW;
    cursor.setAttribute("x1", x.toFixed(1));
    cursor.setAttribute("x2", x.toFixed(1));
  }

  /**
   * Renderiza o diagnóstico de Precipitação Extrema / Neve, impactos em territórios de baixa densidade (Douro/Alijó)
   * e boas práticas de resposta.
   */
  private renderImpactAndBestPractices(): void {
    const box = $("climate-impact-box");
    if (!box || !this.dataset) return;

    const s = this.dataset.summary;
    const badgeLabels: Record<typeof s.severityLevel, string> = {
      baixo: "Severidade Baixa",
      moderado: "Severidade Moderada",
      elevado: "Alerta Elevado",
      extremo: "Evento Extremo",
    };

    const hasSnow = s.totalSnowfallCm > 0 || s.maxSnowDepthCm > 0 || s.snowHoursCount > 0;

    const practices = hasSnow
      ? [
          "<strong>Nevão e gelo nas terras altas de Alijó (Sanfins, Vila Chã, Vila Verde, Santa Eugénia):</strong> Acumulação de neve no solo e formação de gelo negro (<i>black ice</i>) com temperaturas negativas condicionam gravemente a circulação na EN212, EM533 e acessos às aldeias serranas.",
          "<strong>Degelo e escorrentia:</strong> A fusão rápida do manto de neve satura os solos de encosta e aumenta o caudal das linhas de água e ribeiras afluentes do Tua e do Pinhão.",
          "<strong>Boas práticas de resposta:</strong> Evitar deslocações noturnas/matinais com T ≤ 0 °C; garantir reserva de aquecimento e comunicações em povoações isoladas; sinalizar troços com gelo junto dos Bombeiros Voluntários (BVSD).",
        ]
      : s.maxHourlyPrecipitationMm >= 10 || s.totalPrecipitationMm >= 40
        ? [
            "<strong>Encostas e muros de socalco (Douro):</strong> Precipitação horária ≥ 10 mm/h satura rapidamente os solos xistosos e aumenta o risco de derrocada de muros de suporte e deslizamentos nas estradas municipais (EN212 / EN322).",
            "<strong>Áreas recentemente ardidas:</strong> Sem coberto vegetal, a escorrentia superficial multiplica-se, arrastando cinzas e solos para as linhas de água (Ribeira da Vilariça, Rio Tua e Rio Pinhão).",
            "<strong>Boas práticas de autoproteção:</strong> Desobstruir valetas e bueiros antes do pico da frente; evitar atravessar zonas submersas ou pontões rurais; vigiar taludes sobranceiros a habitações isoladas.",
          ]
        : [
            "<strong>Monitorização preventiva em territórios de baixa densidade:</strong> Mesmo sem precipitação horária extrema neste período, acompanhar a relação entre humidade, vento e biomassa acumulada.",
            "<strong>Gestão hídrica e florestal:</strong> Aproveitar períodos de estabilidade para limpeza de linhas de drenagem agrícola e manutenção das faixas de gestão de combustível.",
          ];

    box.innerHTML = `
      <div class="climate-severity-banner sev-${s.severityLevel}">
        <strong>${badgeLabels[s.severityLevel]}${hasSnow ? " · ❄ Episódio de Neve e Gelo" : ""}</strong>
        <span>Acumulado: <b>${s.totalPrecipitationMm} mm</b> · Pico horário: <b>${s.maxHourlyPrecipitationMm} mm/h</b>${
      hasSnow ? ` · Neve máx. solo: <b>${s.maxSnowDepthCm} cm</b>` : ""
    }</span>
      </div>
      <dl class="climate-summary-dl">
        <div><dt>Dia mais chuvoso</dt><dd>${s.maxDailyPrecipitationMm} mm (${esc(s.maxDailyPrecipitationDate)})</dd></div>
        <div><dt>${hasSnow ? "Queda / Horas de neve" : "Horas de chuva forte"}</dt><dd>${
      hasSnow ? `${s.totalSnowfallCm} cm (${s.snowHoursCount} h)` : `${s.extremeHoursCount} h (≥ 10 mm/h)`
    }</dd></div>
        <div><dt>Rajada máx. / Pressão mín.</dt><dd>${s.maxWindGustKmh} km/h · ${s.minPressureHpa} hPa</dd></div>
        <div><dt>Amplitude térmica</dt><dd>${s.minTempC} °C a ${s.maxTempC} °C</dd></div>
      </dl>
      <details class="probe-how" open>
        <summary>Impactos no Douro e Boas Práticas de Resposta</summary>
        <ul class="plain climate-practices">
          ${practices.map((p) => `<li>${p}</li>`).join("")}
        </ul>
      </details>
    `;
  }
}
