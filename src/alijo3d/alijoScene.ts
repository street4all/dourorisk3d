import Map from "@arcgis/core/Map.js";
import SceneView from "@arcgis/core/views/SceneView.js";
import Camera from "@arcgis/core/Camera.js";
import Point from "@arcgis/core/geometry/Point.js";
import ImageryTileLayer from "@arcgis/core/layers/ImageryTileLayer.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import ObjectSymbol3DLayer from "@arcgis/core/symbols/ObjectSymbol3DLayer.js";
import LineCallout3D from "@arcgis/core/symbols/callouts/LineCallout3D.js";
import PolygonSymbol3D from "@arcgis/core/symbols/PolygonSymbol3D.js";
import ExtrudeSymbol3DLayer from "@arcgis/core/symbols/ExtrudeSymbol3DLayer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import FlowRenderer from "@arcgis/core/renderers/FlowRenderer.js";
import RainyWeather from "@arcgis/core/views/3d/environment/RainyWeather.js";
import SunnyWeather from "@arcgis/core/views/3d/environment/SunnyWeather.js";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import SolidEdges3D from "@arcgis/core/symbols/edges/SolidEdges3D.js";
import Compass from "@arcgis/core/widgets/Compass.js";
import NavigationToggle from "@arcgis/core/widgets/NavigationToggle.js";
import MediaLayer from "@arcgis/core/layers/MediaLayer.js";
import type ImageElement from "@arcgis/core/layers/support/ImageElement.js";
import LabelClass from "@arcgis/core/layers/support/LabelClass.js";
import LabelSymbol3D from "@arcgis/core/symbols/LabelSymbol3D.js";
import TextSymbol3DLayer from "@arcgis/core/symbols/TextSymbol3DLayer.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import type { LiveWeatherReport } from "./weatherService";
import { gridFromManifest, type GridGeo } from "../geo/grid";
import { loadGridImageElements } from "../geo/gridMedia";

export interface DouroRiskModelInfo {
  id: string;
  title: string;
  image: string;
  /** grelha PT-TM06 da imagem (uma célula por píxel): o desenho usa os cantos reais, em blocos */
  grid: GridGeo;
}

// grelhas nativas dos rasters (src/data/dourorisk-grids.json, gerado por scripts/pro_to_web.py)
const G10_RISCO = gridFromManifest("g10_risco");
const G10_PERIGOSIDADE = gridFromManifest("g10_perigosidade");
const G25 = gridFromManifest("g25");

export const DOURORISK_MODELS: Record<string, DouroRiskModelInfo> = {
  risco_2025: {
    id: "risco_2025",
    title: "Risco de Incêndio (Cenário 2025 — 10m)",
    image: "/data/dourorisk/a11y/risco_2025.png",
    grid: G10_RISCO,
  },
  perigosidade_2025: {
    id: "perigosidade_2025",
    title: "Perigosidade de Incêndio (Modelo Tese — 10m)",
    image: "/data/dourorisk/a11y/perigosidade_2025.png",
    grid: G10_PERIGOSIDADE,
  },
  icnf_conjuntural: {
    id: "icnf_conjuntural",
    title: "Perigosidade Conjuntural ICNF (Oficial 2025)",
    image: "/data/dourorisk/a11y/icnf_conjuntural.png",
    grid: G25,
  },
  icnf_estrutural: {
    id: "icnf_estrutural",
    title: "Perigosidade Estrutural ICNF (2020–2030)",
    image: "/data/dourorisk/a11y/icnf_estrutural.png",
    grid: G25,
  },
  biomassa_2025: {
    id: "biomassa_2025",
    title: "Biomassa Vegetal Estimada (2025)",
    image: "/data/dourorisk/a11y/biomassa.png",
    grid: G25,
  },
};

export interface AlijoState {
  isRainActive: boolean;
  rainPrecipitation: number;
  cloudCover: number;
  windSpeed: number;
  windDensity: number;
  windTrailLength: number;
  elevationMode: "relative-to-ground" | "absolute-height";
  elevationOffset: number;
  showBuildings: boolean;
  showTrees: boolean;
  solarHour: number;
  heading: number;
  tilt: number;
  isOrbiting: boolean;
}

export class Alijo3DManager {
  private containerId: string;
  public view: SceneView | null = null;
  public windLayer: ImageryTileLayer | null = null;
  public concelhoBoundaryLayer: GeoJSONLayer | null = null;
  public alijoParishesLayer: GeoJSONLayer | null = null;
  public stationLayer: GraphicsLayer | null = null;
  public stationGraphic: Graphic | null = null;
  public sanfinsBuildingsLayer: GeoJSONLayer | null = null;
  public sanfinsRoofsLayer: GeoJSONLayer | null = null;
  public sanfinsTreesLayer: GeoJSONLayer | null = null;
  public churchLayer: GraphicsLayer | null = null;
  public douroRiskLayer: MediaLayer | null = null;
  private orbitAnimationId: number | null = null;
  /** pedidos de setDouroRiskModel: só o último troca a imagem (a leitura é assíncrona) */
  private douroRiskSeq = 0;
  private onCameraChangeCallback: ((heading: number, tilt: number) => void) | null = null;

  public state: AlijoState = {
    isRainActive: true,
    rainPrecipitation: 0.65,
    cloudCover: 0.85,
    windSpeed: 18,
    windDensity: 1.2,
    windTrailLength: 65,
    elevationMode: "relative-to-ground",
    elevationOffset: 1400,
    showBuildings: true,
    showTrees: false,
    solarHour: 17.33, // 17:20 golden hour
    heading: 42,
    tilt: 64,
    isOrbiting: false,
  };

  constructor(containerId: string) {
    this.containerId = containerId;
  }

  public async initialize(): Promise<void> {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // 1. Create 3D Map with Topographic Relief
    const map = new Map({
      basemap: "satellite",
      ground: "world-elevation",
    });

    // 2. Configure FlowRenderer for Wind Streams
    const flowRenderer = new FlowRenderer({
      flowRepresentation: "flow-to",
      density: this.state.windDensity,
      flowSpeed: this.state.windSpeed,
      trailLength: this.state.windTrailLength,
      trailWidth: 2.5,
      color: [255, 255, 255, 0.95],
      visualVariables: [
        {
          type: "color",
          field: "Magnitude",
          stops: [
            { value: 0, color: [210, 240, 255, 0.4] },
            { value: 8, color: [130, 215, 255, 0.85] },
            { value: 18, color: [255, 220, 100, 0.95] },
            { value: 28, color: [255, 80, 50, 1.0] },
          ],
        },
      ],
    });

    // 3. ImageryTileLayer with Global Wind Data and 3D Elevation (Opcional)
    this.windLayer = new ImageryTileLayer({
      url: "https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Global_Average_Wind_Speeds_Month_Altitude/ImageServer",
      renderer: flowRenderer,
      title: "Correntes de Vento sobre Alijó (FlowRenderer)",
      opacity: 0.95,
      visible: false, // FlowRenderer opcional: desligado por defeito
      elevationInfo: {
        mode: this.state.elevationMode,
        offset: this.state.elevationOffset,
      },
    });

    // 4. Concelho de Alijó Boundary Layer (3D Glowing Gold Border)
    this.concelhoBoundaryLayer = new GeoJSONLayer({
      url: "/data/alijo-concelho.geojson",
      title: "Limite Municipal de Alijó",
      renderer: new SimpleRenderer({
        symbol: new SimpleFillSymbol({
          color: [0, 0, 0, 0],
          outline: new SimpleLineSymbol({
            color: [255, 200, 40, 0.9],
            width: 2.5,
          }),
        }),
      }),
    });

    // 5. Parishes of Alijó with 3D floating labels
    const parishLabel = new LabelClass({
      labelExpressionInfo: { expression: "$feature.nome_freguesia" },
      symbol: new LabelSymbol3D({
        symbolLayers: [
          new TextSymbol3DLayer({
            material: { color: [255, 255, 255, 0.95] },
            halo: { color: [10, 20, 35, 0.85], size: 1.5 },
            size: 11,
            font: { weight: "bold", family: "system-ui, sans-serif" },
          }),
        ],
      }),
      minScale: 250000,
    });

    this.alijoParishesLayer = new GeoJSONLayer({
      url: "/data/alijo-freguesias.geojson",
      title: "Freguesias do Concelho de Alijó",
      labelingInfo: [parishLabel],
      renderer: new SimpleRenderer({
        symbol: new SimpleFillSymbol({
          color: [0, 198, 255, 0.05],
          outline: new SimpleLineSymbol({
            color: [0, 220, 255, 0.75],
            width: 1.5,
          }),
        }),
      }),
      popupTemplate: {
        title: "📍 {nome_freguesia} (Alijó)",
        content: `
          <div style="font-size: 13px; line-height: 1.6;">
            <p><strong>Freguesia:</strong> {nome_freguesia}</p>
            <p><strong>População Ativa:</strong> {pop_ativa} habitantes</p>
            <p><strong>Taxa de Atividade:</strong> {taxa_atividade}%</p>
            <p><strong>Setor Serviços:</strong> {pct_servicos}% | <strong>Indústria/Vinho:</strong> {pct_industria}%</p>
          </div>
        `,
      },
    });

    // 6. Official IPMA Meteorological Station 3D Marker at Pinhão, Santa Bárbara (Alijó)
    this.stationLayer = new GraphicsLayer({
      title: "Estação Meteorológica IPMA (Pinhão)",
      elevationInfo: {
        mode: "relative-to-ground",
        offset: 15,
      },
    });

    this.stationGraphic = new Graphic({
      geometry: new Point({
        longitude: -7.548972,
        latitude: 41.172775,
      }),
      symbol: new PointSymbol3D({
        symbolLayers: [
          new IconSymbol3DLayer({
            resource: { primitive: "circle" },
            size: 20,
            material: { color: [255, 140, 0, 0.95] },
            outline: { color: [255, 255, 255, 1], size: 2.5 },
          }),
        ],
        verticalOffset: {
          screenLength: 50,
          maxWorldLength: 200,
          minWorldLength: 25,
        },
        callout: new LineCallout3D({
          size: 2,
          color: [255, 255, 255, 0.9],
          border: { color: [0, 0, 0, 0.6] },
        }),
      }),
      attributes: {
        nome: "Estação Meteorológica Oficial IPMA",
        local: "Pinhão, Santa Bárbara (Alijó)",
        idEstacao: "1210655",
        temp: "A carregar...",
        vento: "A carregar...",
        chuva: "A carregar...",
        humidade: "A carregar...",
        atualizacao: "Em sincronização",
      },
      popupTemplate: {
        title: "📡 {nome}",
        content: `
          <div style="font-size: 13px; line-height: 1.6;">
            <p><strong>Local:</strong> {local} (ID: {idEstacao})</p>
            <p><strong>Temperatura:</strong> <span style="color: #ff9800; font-weight: bold;">{temp} °C</span></p>
            <p><strong>Vento:</strong> {vento}</p>
            <p><strong>Precipitação:</strong> {chuva}</p>
            <p><strong>Humidade Relativa:</strong> {humidade}%</p>
            <p style="font-size: 11px; color: #888; margin-top: 6px;">Última leitura: {atualizacao}</p>
          </div>
        `,
      },
    });

    this.stationLayer.add(this.stationGraphic);

    // 6. Realistic Douro Vernacular Architecture: Building Walls
    const createWallSymbol = (color: number[]) =>
      new PolygonSymbol3D({
        symbolLayers: [
          new ExtrudeSymbol3DLayer({
            size: 6,
            material: { color },
            edges: new SolidEdges3D({
              color: [80, 70, 60, 0.6],
              size: 1,
            }),
          }),
        ],
      });

    const wallsRenderer = new UniqueValueRenderer({
      field: "building_type",
      defaultSymbol: createWallSymbol([245, 240, 232, 0.98]), // Reboco caiado duriense tradicional
      defaultLabel: "Habitação Tradicional Duriense (Caiada)",
      uniqueValueInfos: [
        {
          value: "Monumento Religioso",
          symbol: createWallSymbol([230, 212, 185, 1.0]), // Cantaria nobre de granito
          label: "Igreja Matriz de São Miguel (Granito e Cantaria)",
        },
        {
          value: "Santuário Histórico",
          symbol: createWallSymbol([238, 222, 195, 1.0]), // Santuário de Nossa Senhora da Piedade
          label: "Santuário de N. Sra. da Piedade (Cantaria)",
        },
        {
          value: "Quinta / Adega Vinícola",
          symbol: createWallSymbol([218, 208, 196, 0.98]), // Adegas e xisto
          label: "Adega Cooperativa e Caves do Douro",
        },
        {
          value: "Solar Histórico",
          symbol: createWallSymbol([236, 224, 204, 1.0]),
          label: "Solar Nobre Duriense (Séc. XVIII)",
        },
        {
          value: "Serviços Públicos",
          symbol: createWallSymbol([244, 238, 230, 1.0]),
          label: "Edifício da Junta de Freguesia",
        },
      ],
      visualVariables: [
        {
          type: "size",
          field: "wall_height",
          valueUnit: "meters",
        },
      ],
    });

    this.sanfinsBuildingsLayer = new GeoJSONLayer({
      url: "/data/alijo-all-buildings.geojson",
      title: "Casas e Edifícios 3D do Concelho de Alijó (14.531 edifícios)",
      renderer: wallsRenderer,
      elevationInfo: {
        mode: "on-the-ground",
      },
      popupTemplate: {
        title: "🏠 {building_type}",
        content: `
          <div style="font-size: 13px; line-height: 1.6;">
            <p><strong>Tipo:</strong> {building_type}</p>
            <p><strong>Freguesia:</strong> {freguesia}</p>
            <p><strong>Concelho:</strong> Alijó</p>
            <p><strong>Área Implantação:</strong> <span style="color: #00d2ff; font-weight: bold;">{area_m2} m²</span></p>
            <p><strong>Altura Estimada:</strong> {wall_height} metros ({levels} pisos)</p>
          </div>
        `,
      },
    });

    // 7. Traditional Ceramic Tile Roofs Layer (Telha Cerâmica Lusa Tradicional)
    const createRoofSymbol = (color: number[]) =>
      new PolygonSymbol3D({
        symbolLayers: [
          new ExtrudeSymbol3DLayer({
            size: 0.9, // espessura do beiral e cumeeira
            material: { color },
            edges: new SolidEdges3D({
              color: [110, 42, 22, 0.85], // beiral cerâmico vincado
              size: 1.2,
            }),
          }),
        ],
      });

    const roofsRenderer = new UniqueValueRenderer({
      field: "building_type",
      defaultSymbol: createRoofSymbol([184, 72, 40, 1.0]), // Telha cerâmica terracota de barro cozido
      defaultLabel: "Telhado de Telha Lusa Tradicional",
      uniqueValueInfos: [
        {
          value: "Monumento Religioso",
          symbol: createRoofSymbol([175, 65, 35, 1.0]),
          label: "Telhado Monumental da Igreja Matriz",
        },
        {
          value: "Santuário Histórico",
          symbol: createRoofSymbol([170, 60, 32, 1.0]),
          label: "Telhado do Santuário de N. Sra. da Piedade",
        },
        {
          value: "Quinta / Adega Vinícola",
          symbol: createRoofSymbol([192, 78, 45, 1.0]),
          label: "Telhado Amplo de Adega / Quinta",
        },
      ],
    });

    this.sanfinsRoofsLayer = new GeoJSONLayer({
      url: "/data/alijo-all-roofs.geojson",
      title: "Telhados Cerâmicos 3D do Concelho de Alijó (14.531 telhados)",
      renderer: roofsRenderer,
      elevationInfo: {
        mode: "relative-to-ground",
        featureExpressionInfo: { expression: "$feature.base_height" },
      },
    });

    // 8. Dedicated Monument Layer for the 3D Architectural Church Model
    this.churchLayer = new GraphicsLayer({
      title: "Património & Monumentos 3D (Sanfins do Douro)",
      elevationInfo: {
        mode: "on-the-ground",
      },
    });

    // 9. DouroRisk Wildfire Risk MediaLayer (Draped on 3D Terrain)
    // a imagem é a grelha PT-TM06, desenhada em blocos com os cantos reais em WGS84 (rodada ~0,43°),
    // não uma extensão lon/lat; os blocos entram quando a imagem estiver lida (setDouroRiskModel)
    this.douroRiskLayer = new MediaLayer({
      title: "DouroRisk — Risco de Incêndio Alijó",
      source: [],
      opacity: 0.75,
      visible: true,
    });
    this.setDouroRiskModel("risco_2025");

    // Add layers to map
    if (this.concelhoBoundaryLayer) map.add(this.concelhoBoundaryLayer);
    map.add(this.alijoParishesLayer);
    map.add(this.douroRiskLayer);
    map.add(this.sanfinsBuildingsLayer);
    map.add(this.sanfinsRoofsLayer);
    map.add(this.windLayer);
    map.add(this.stationLayer);
    map.add(this.churchLayer);

    // 10. Igreja Matriz de Sanfins do Douro (Santa Marinha) - Real 3D Architectural GLB Model
    const matrizGraphic = new Graphic({
      geometry: new Point({
        longitude: -7.51810,
        latitude: 41.29352,
      }),
      symbol: new PointSymbol3D({
        symbolLayers: [
          new ObjectSymbol3DLayer({
            resource: { href: "/models/santuario_sanfins.glb?v=matriz3" },
            height: 25, // Escala arquitetónica completa (escadaria até à cruz)
            heading: 90, // Fachada e escadaria viradas diretamente de frente para a câmara e Largo da Igreja (Este, 90°)
            anchor: "bottom",
          }),
        ],
      }),
      attributes: {
        name: "Igreja Matriz de Sanfins do Douro (Santa Marinha)",
        tipo: "Igreja Paroquial e Património Religioso Monumental (Vila de Sanfins)",
        epoca: "Século XVIII (Barroco Duriense)",
        detalhes:
          "Igreja Paroquial de Santa Marinha, no centro da vila de Sanfins do Douro. Apresenta imponente escadaria de cantaria, fachada nobre barroca com medalhões de azulejos e nicho, torre sineira central com sino de bronze e coruchéu, e solar seiscentista adjacente.",
        imagem: "/images/santuario_sanfins.jpg",
      },
      popupTemplate: {
        title: "🏛️ {name}",
        content: `
          <div style="font-size: 13px; line-height: 1.6;">
            <img src="{imagem}" alt="{name}" style="width: 100%; border-radius: 6px; margin-bottom: 8px; box-shadow: 0 3px 10px rgba(0,0,0,0.5);" />
            <p><strong>Classificação:</strong> {tipo}</p>
            <p><strong>Época:</strong> {epoca}</p>
            <p><strong>Descrição Arquitetónica:</strong> {detalhes}</p>
            <hr style="border: 0; border-top: 1px solid #444; margin: 8px 0;" />
            <p style="color: #4caf50; font-weight: 500; font-size: 11px;">✓ Modelo 3D posicionado na pegada real do edifício com fachada virada ao Largo da Igreja.</p>
          </div>
        `,
      },
    });

    // 10b. Santuário de Nossa Senhora da Piedade (Modelo 3D Arquitetónico Real no Cimo do Monte - 737m)
    const santuario3DGraphic = new Graphic({
      geometry: new Point({
        longitude: -7.51352,
        latitude: 41.29182,
      }),
      symbol: new PointSymbol3D({
        symbolLayers: [
          new ObjectSymbol3DLayer({
            resource: { href: "/models/santuario_monte.glb?v=real4" },
            height: 18, // Altura monumental completa (adro até à cruz cónica)
            heading: 225, // Fachada, porta e escadaria viradas diretamente de frente nesta perspetiva da vila (Sudoeste, 225°)
            anchor: "bottom",
          }),
        ],
      }),
      attributes: {
        name: "Santuário de Nossa Senhora da Piedade",
        local: "Cimo do Monte da Senhora da Piedade (737 m de altitude)",
        tipo: "Santuário Mariano, Promontório e Miradouro Panorâmico",
        epoca: "Século XVIII / XIX (Neobarroco Duriense)",
        detalhes:
          "Emblemático santuário implantado no cimo do Monte da Senhora da Piedade sobranceiro à vila de Sanfins do Douro. O monumento é caracterizado pela sua capela de planta octogonal com cúpula cónica escalonada em cantaria de granito aparelhada, portal barroco com nicho e sineira, as capelinhas da Via-Sacra ao longo das curvas em ziguezague da subida, e miradouro 360° sobre a paisagem duriense.",
        imagem: "/images/santuario_piedade_fachada.jpg",
      },
      popupTemplate: {
        title: "⛰️ {name}",
        content: `
          <div style="font-size: 13px; line-height: 1.6;">
            <img src="{imagem}" alt="{name}" style="width: 100%; border-radius: 6px; margin-bottom: 8px; box-shadow: 0 3px 10px rgba(0,0,0,0.5);" />
            <p><strong>Localização:</strong> {local}</p>
            <p><strong>Classificação:</strong> {tipo}</p>
            <p><strong>Época:</strong> {epoca}</p>
            <p><strong>Descrição Arquitetónica:</strong> {detalhes}</p>
            <hr style="border: 0; border-top: 1px solid #444; margin: 8px 0;" />
            <p style="color: #ff9800; font-weight: 500; font-size: 11px;">✓ Modelo 3D octogonal com cúpula escalonada posicionado no cimo do monte e virado de frente para as casas da vila.</p>
          </div>
        `,
      },
    });

    this.churchLayer.addMany([matrizGraphic, santuario3DGraphic]);

    // 10. SceneView focused on Sanfins do Douro with Physical Sun Shadows
    this.view = new SceneView({
      container: container as HTMLDivElement,
      map: map,
      qualityProfile: "high",
      environment: {
        atmosphereEnabled: true,
        lighting: {
          directShadowsEnabled: true, // Real cast shadows on terrain relief
          date: new Date("2026-10-08T17:20:00"), // Douro Golden Hour
        },
      },
      camera: new Camera({
        position: new Point({
          longitude: -7.527,
          latitude: 41.284,
          z: 1250,
        }),
        tilt: 64,
        heading: 42,
      }),
    });

    // 10. Add Compass and Navigation Mode Toggle Widgets
    const compass = new Compass({ view: this.view });
    const navToggle = new NavigationToggle({ view: this.view });
    this.view.ui.add(compass, "top-left");
    this.view.ui.add(navToggle, "top-left");

    // Sync camera changes (heading & tilt) with UI listeners
    reactiveUtils.watch(
      () => [this.view?.camera?.heading, this.view?.camera?.tilt],
      ([heading, tilt]) => {
        if (heading !== undefined) this.state.heading = Math.round(heading);
        if (tilt !== undefined) this.state.tilt = Math.round(tilt);
        if (this.onCameraChangeCallback && heading !== undefined && tilt !== undefined) {
          this.onCameraChangeCallback(Math.round(heading), Math.round(tilt));
        }
      }
    );

    // 11. Apply initial Weather
    this.applyWeather();
  }

  public applyWeather(): void {
    if (!this.view) return;

    if (this.state.isRainActive) {
      this.view.environment.weather = new RainyWeather({
        precipitation: this.state.rainPrecipitation,
        cloudCover: this.state.cloudCover,
      });
    } else {
      this.view.environment.weather = new SunnyWeather({
        cloudCover: 0.15,
      });
    }
  }

  public setRainEnabled(enabled: boolean): void {
    this.state.isRainActive = enabled;
    this.applyWeather();
  }

  public setRainPrecipitation(precip: number): void {
    this.state.rainPrecipitation = precip;
    if (this.state.isRainActive) this.applyWeather();
  }

  public setCloudCover(clouds: number): void {
    this.state.cloudCover = clouds;
    if (this.state.isRainActive) this.applyWeather();
  }

  public setWindElevation(mode: "relative-to-ground" | "absolute-height", offset: number): void {
    this.state.elevationMode = mode;
    this.state.elevationOffset = offset;
    if (this.windLayer) {
      this.windLayer.elevationInfo = {
        mode,
        offset,
      };
    }
  }

  public setWindSpeed(speed: number): void {
    this.state.windSpeed = speed;
    if (this.windLayer && this.windLayer.renderer) {
      const r = (this.windLayer.renderer as FlowRenderer).clone();
      r.flowSpeed = speed;
      this.windLayer.renderer = r;
    }
  }

  public setWindDensity(density: number): void {
    this.state.windDensity = density;
    if (this.windLayer && this.windLayer.renderer) {
      const r = (this.windLayer.renderer as FlowRenderer).clone();
      r.density = density;
      this.windLayer.renderer = r;
    }
  }

  public setWindVisible(visible: boolean): void {
    if (this.windLayer) {
      this.windLayer.visible = visible;
    }
  }

  public setDouroRiskVisible(visible: boolean): void {
    if (this.douroRiskLayer) {
      this.douroRiskLayer.visible = visible;
    }
  }

  public setDouroRiskOpacity(opacity: number): void {
    if (this.douroRiskLayer) {
      this.douroRiskLayer.opacity = opacity;
    }
  }

  public setDouroRiskModel(modelKey: keyof typeof DOURORISK_MODELS): void {
    const model = DOURORISK_MODELS[modelKey];
    const layer = this.douroRiskLayer;
    if (!model || !layer) return;

    // a imagem entra em blocos, cada um com os seus 4 cantos reais (desvio de desenho ~1 m em vez de
    // ~19 m, ver MEDIA_TILES); troca quando os blocos estão prontos, se entretanto não se pediu outro mapa
    const seq = ++this.douroRiskSeq;
    const swap = (elements: ImageElement[]) => {
      if (seq !== this.douroRiskSeq) return;
      const src = layer.source as any;
      if (src && src.elements) {
        src.elements.removeAll();
        src.elements.addMany(elements);
      } else {
        layer.source = elements as any;
      }
    };
    void loadGridImageElements(model.image, model.grid).then(swap, () => swap([]));
  }

  public setParishesVisible(visible: boolean): void {
    if (this.alijoParishesLayer) this.alijoParishesLayer.visible = visible;
  }

  public setConcelhoVisible(visible: boolean): void {
    if (this.concelhoBoundaryLayer) this.concelhoBoundaryLayer.visible = visible;
  }

  public setSanfinsBuildingsVisible(visible: boolean): void {
    this.state.showBuildings = visible;
    if (this.sanfinsBuildingsLayer) this.sanfinsBuildingsLayer.visible = visible;
    if (this.sanfinsRoofsLayer) this.sanfinsRoofsLayer.visible = visible;
  }

  public setSanfinsTreesVisible(visible: boolean): void {
    this.state.showTrees = visible;
    if (this.sanfinsTreesLayer) this.sanfinsTreesLayer.visible = visible;
  }

  public setSolarHour(hourDecimal: number): void {
    this.state.solarHour = hourDecimal;
    if (!this.view || !this.view.environment?.lighting) return;
    const date = new Date("2026-10-08T00:00:00");
    const h = Math.floor(hourDecimal);
    const m = Math.floor((hourDecimal - h) * 60);
    date.setHours(h, m, 0, 0);
    (this.view.environment.lighting as any).date = date;
  }

  public updateStationGraphic(report: LiveWeatherReport): void {
    if (!this.stationGraphic) return;
    this.stationGraphic.attributes = {
      ...this.stationGraphic.attributes,
      temp: report.temperature.toFixed(1),
      vento: `${report.windSpeed.toFixed(1)} km/h (${report.windDirectionText})`,
      chuva: `${report.precipitation.toFixed(1)} mm`,
      humidade: String(report.humidity),
      atualizacao: report.time,
    };
  }

  public updateFromLiveTelemetry(report: LiveWeatherReport): void {
    this.updateStationGraphic(report);
    this.applyLiveWeatherReport(report);
  }

  public applyLiveWeatherReport(report: LiveWeatherReport): void {
    this.state.isRainActive = report.isRaining;
    this.state.rainPrecipitation = report.isRaining
      ? Math.min(Math.max((report.precipitation || 0.2) / 4, 0.25), 1.0)
      : 0;
    this.state.cloudCover = Math.min(Math.max(report.cloudCover / 100, 0.1), 1.0);
    this.state.windSpeed = Math.min(Math.max(report.windSpeed, 6), 35);

    this.applyWeather();

    if (this.windLayer && this.windLayer.renderer) {
      const r = (this.windLayer.renderer as FlowRenderer).clone();
      r.flowSpeed = this.state.windSpeed;
      this.windLayer.renderer = r;
    }

    this.updateStationGraphic(report);
  }

  // Scenic Presets in Alijó / Douro
  public goToPreset(preset: "santuario" | "igreja" | "sanfins" | "pinhao" | "favaios" | "tua" | "general"): void {
    if (!this.view) return;
    this.stopOrbit();

    let cam: Camera;
    switch (preset) {
      case "santuario":
        // Santuário de Nossa Senhora da Piedade no cimo do monte (737m), virado de frente para a vila
        cam = new Camera({
          position: new Point({
            longitude: -7.5162,
            latitude: 41.2905,
            z: 870,
          }),
          tilt: 64,
          heading: 58,
        });
        break;
      case "igreja":
        // Igreja Matriz de Sanfins do Douro no centro da vila (Largo da Igreja)
        cam = new Camera({
          position: new Point({
            longitude: -7.5168,
            latitude: 41.2935,
            z: 660,
          }),
          tilt: 66,
          heading: 268,
        });
        break;
      case "sanfins":
        cam = new Camera({
          position: new Point({
            longitude: -7.527,
            latitude: 41.284,
            z: 1250,
          }),
          tilt: 64,
          heading: 42,
        });
        break;
      case "pinhao":
        cam = new Camera({
          position: new Point({ longitude: -7.545, latitude: 41.175, z: 2100 }),
          tilt: 74,
          heading: 25,
        });
        break;
      case "favaios":
        cam = new Camera({
          position: new Point({ longitude: -7.498, latitude: 41.235, z: 2600 }),
          tilt: 66,
          heading: 10,
        });
        break;
      case "tua":
        cam = new Camera({
          position: new Point({ longitude: -7.41, latitude: 41.22, z: 2300 }),
          tilt: 75,
          heading: 335,
        });
        break;
      case "general":
        cam = new Camera({
          position: new Point({ longitude: -7.475, latitude: 41.275, z: 6200 }),
          tilt: 55,
          heading: 15,
        });
        break;
    }

    // respeita "reduzir movimento" do sistema: salta sem voo
    const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.view.goTo(cam, { animate, duration: 1500 });
  }

  // Camera Rotation & Perspective Angle Controls
  public onCameraChange(callback: (heading: number, tilt: number) => void): void {
    this.onCameraChangeCallback = callback;
  }

  public setHeading(heading: number, animate = true): void {
    if (!this.view) return;
    const cam = this.view.camera.clone();
    cam.heading = ((heading % 360) + 360) % 360;
    this.state.heading = Math.round(cam.heading);
    if (animate) {
      this.view.goTo(cam, { duration: 400 });
    } else {
      this.view.camera = cam;
    }
  }

  public setTilt(tilt: number, animate = true): void {
    if (!this.view) return;
    const cam = this.view.camera.clone();
    cam.tilt = Math.min(Math.max(tilt, 0), 85);
    this.state.tilt = Math.round(cam.tilt);
    if (animate) {
      this.view.goTo(cam, { duration: 400 });
    } else {
      this.view.camera = cam;
    }
  }

  public rotateBy(deltaHeading: number): void {
    if (!this.view) return;
    const cam = this.view.camera.clone();
    cam.heading = (((cam.heading + deltaHeading) % 360) + 360) % 360;
    this.state.heading = Math.round(cam.heading);
    this.view.goTo(cam, { animate: !matchMedia("(prefers-reduced-motion: reduce)").matches, duration: 400 });
  }

  public toggleContinuousOrbit(speed = 0.22): boolean {
    if (this.state.isOrbiting) {
      this.stopOrbit();
      return false;
    } else {
      this.startOrbit(speed);
      return true;
    }
  }

  public startOrbit(speed = 0.22): void {
    if (this.state.isOrbiting) return;
    this.state.isOrbiting = true;

    const step = () => {
      if (!this.state.isOrbiting || !this.view) return;
      const cam = this.view.camera.clone();
      cam.heading = (cam.heading + speed) % 360;
      this.state.heading = Math.round(cam.heading);
      this.view.camera = cam;
      if (this.onCameraChangeCallback) {
        this.onCameraChangeCallback(Math.round(cam.heading), Math.round(cam.tilt));
      }
      this.orbitAnimationId = requestAnimationFrame(step);
    };
    this.orbitAnimationId = requestAnimationFrame(step);
  }

  public stopOrbit(): void {
    this.state.isOrbiting = false;
    if (this.orbitAnimationId !== null) {
      cancelAnimationFrame(this.orbitAnimationId);
      this.orbitAnimationId = null;
    }
  }
}
