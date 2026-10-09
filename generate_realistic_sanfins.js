import fs from "fs";

// Sanfins do Douro Core coordinates
const centerLat = 41.2915;
const centerLon = -7.5215;

// 1. Defined landmark buildings of Sanfins do Douro
const landmarks = [
  {
    id: "igreja-matriz",
    name: "Igreja Matriz de São Miguel de Sanfins do Douro",
    type: "Monumento Religioso",
    lat: 41.2912,
    lon: -7.5218,
    width: 18,
    length: 32,
    wallHeight: 12.0,
    roofHeight: 15.5,
    wallColor: [232, 215, 185, 1.0], // Granito e cantaria regional
    roofColor: [180, 68, 38, 1.0],   // Telha cerâmica antiga
    levels: 3,
    material: "Granito Regional com Cantaria Lavrada e Torre Sineira"
  },
  {
    id: "santuario-piedade",
    name: "Santuário de Nossa Senhora da Piedade (Monte de Sanfins)",
    type: "Santuário Histórico",
    lat: 41.2965,
    lon: -7.5185,
    width: 22,
    length: 38,
    wallHeight: 13.5,
    roofHeight: 17.0,
    wallColor: [240, 225, 195, 1.0], // Cantaria nobre
    roofColor: [175, 65, 35, 1.0],
    levels: 4,
    material: "Conjunto Monumental do Santuário com Escadaria e Capelas"
  },
  {
    id: "adega-cooperativa",
    name: "Adega Cooperativa e Caves de Sanfins do Douro",
    type: "Quinta / Adega Vinícola",
    lat: 41.2902,
    lon: -7.5230,
    width: 28,
    length: 46,
    wallHeight: 8.5,
    roofHeight: 10.2,
    wallColor: [215, 205, 195, 1.0], // Reboco com xisto
    roofColor: [192, 78, 45, 1.0],   // Telha lusa tradicional
    levels: 2,
    material: "Instalações de Vinificação e Envelhecimento de Vinho do Porto"
  },
  {
    id: "junta-freguesia",
    name: "Edifício da Junta de Freguesia e Centro Comunitário",
    type: "Serviços Públicos",
    lat: 41.2919,
    lon: -7.5208,
    width: 16,
    length: 22,
    wallHeight: 7.2,
    roofHeight: 9.0,
    wallColor: [245, 240, 232, 1.0], // Reboco caiado de branco
    roofColor: [188, 72, 40, 1.0],
    levels: 2,
    material: "Alvenaria Caiada e Guarnições de Granito"
  },
  {
    id: "solar-quinta-douro",
    name: "Solar e Casa Senhorial Duriense (Séc. XVIII)",
    type: "Solar Histórico",
    lat: 41.2928,
    lon: -7.5222,
    width: 18,
    length: 26,
    wallHeight: 9.0,
    roofHeight: 11.5,
    wallColor: [238, 226, 205, 1.0],
    roofColor: [185, 70, 38, 1.0],
    levels: 3,
    material: "Solar Nobre com Brasão em Cantaria e Beiral à Portuguesa"
  }
];

const buildingFeatures = [];
const roofFeatures = [];

// Convert meters to lat/lon offsets
function toLatOffset(meters) { return (meters / 111000); }
function toLonOffset(meters) { return (meters / 83000); }

// Add landmarks
for (const lm of landmarks) {
  const dLat = toLatOffset(lm.length) / 2;
  const dLon = toLonOffset(lm.width) / 2;

  const polyCoords = [
    [lm.lon - dLon, lm.lat - dLat],
    [lm.lon + dLon, lm.lat - dLat],
    [lm.lon + dLon, lm.lat + dLat],
    [lm.lon - dLon, lm.lat + dLat],
    [lm.lon - dLon, lm.lat - dLat]
  ];

  // Base building walls
  buildingFeatures.push({
    type: "Feature",
    id: lm.id,
    geometry: { type: "Polygon", coordinates: [polyCoords] },
    properties: {
      id: lm.id,
      name: lm.name,
      building_type: lm.type,
      wall_height: lm.wallHeight,
      height: lm.wallHeight,
      levels: lm.levels,
      material: lm.material,
      is_landmark: true,
      address: "Sanfins do Douro, Alijó"
    }
  });

  // Roof polygon with realistic eaves offset (+0.4m overhang)
  const eLat = toLatOffset(lm.length + 0.8) / 2;
  const eLon = toLonOffset(lm.width + 0.8) / 2;
  roofFeatures.push({
    type: "Feature",
    id: `${lm.id}-roof`,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lm.lon - eLon, lm.lat - eLat],
        [lm.lon + eLon, lm.lat - eLat],
        [lm.lon + eLon, lm.lat + eLat],
        [lm.lon - eLon, lm.lat + eLat],
        [lm.lon - eLon, lm.lat - eLat]
      ]]
    },
    properties: {
      id: `${lm.id}-roof`,
      name: `Telhado de Telha Lusa: ${lm.name}`,
      building_type: lm.type,
      base_height: lm.wallHeight,
      roof_thickness: 1.2,
      roof_type: "Telha Cerâmica Regional",
      is_landmark: true
    }
  });
}

// Generate organic traditional village cluster
const gridSize = 16;
let bCount = 0;

for (let i = -gridSize; i <= gridSize; i++) {
  for (let j = -gridSize; j <= gridSize; j++) {
    const dist = Math.sqrt(i * i + j * j);
    if (dist > gridSize) continue;
    if (Math.random() > 0.40) continue; // organic alleys & vineyard courtyards

    const bLat = centerLat + (i * 0.00038) + ((Math.random() - 0.5) * 0.00012);
    const bLon = centerLon + (j * 0.00050) + ((Math.random() - 0.5) * 0.00014);

    // Skip if too close to landmarks
    const nearLandmark = landmarks.some(lm => {
      const d = Math.hypot(bLat - lm.lat, bLon - lm.lon);
      return d < 0.00035;
    });
    if (nearLandmark) continue;

    bCount++;
    const width = 8 + Math.random() * 7;   // 8m - 15m
    const length = 7 + Math.random() * 8;  // 7m - 15m
    const dLat = toLatOffset(length) / 2;
    const dLon = toLonOffset(width) / 2;

    const levels = Math.random() > 0.6 ? 2 : (Math.random() > 0.3 ? 2 : 1);
    const wallHeight = parseFloat((levels * 3.1 + Math.random() * 0.8).toFixed(1));

    const isWinery = Math.random() > 0.82;
    const type = isWinery ? "Adega / Lagar de Vinho" : "Habitação Tradicional Duriense";

    const polyCoords = [
      [bLon - dLon, bLat - dLat],
      [bLon + dLon, bLat - dLat],
      [bLon + dLon, bLat + dLat],
      [bLon - dLon, bLat + dLat],
      [bLon - dLon, bLat - dLat]
    ];

    buildingFeatures.push({
      type: "Feature",
      id: `house-${bCount}`,
      geometry: { type: "Polygon", coordinates: [polyCoords] },
      properties: {
        id: `house-${bCount}`,
        name: isWinery ? "Adega Tradicional do Douro" : "Casa Duriense Caiada com Beiral",
        building_type: type,
        wall_height: wallHeight,
        height: wallHeight,
        levels,
        material: "Alvenaria e Xisto com Cantarias de Granito",
        is_landmark: false,
        address: "Sanfins do Douro"
      }
    });

    // Overhanging ceramic roof
    const eLat = toLatOffset(length + 0.6) / 2;
    const eLon = toLonOffset(width + 0.6) / 2;
    roofFeatures.push({
      type: "Feature",
      id: `roof-${bCount}`,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [bLon - eLon, bLat - eLat],
          [bLon + eLon, bLat - eLat],
          [bLon + eLon, bLat + eLat],
          [bLon - eLon, bLat + eLat],
          [bLon - eLon, bLat - eLat]
        ]]
      },
      properties: {
        id: `roof-${bCount}`,
        name: "Telhado de Telha Lusa Tradicional",
        building_type: type,
        base_height: wallHeight,
        roof_thickness: 0.9,
        roof_type: "Telha de Barro Vermelho Cozido",
        is_landmark: false
      }
    });
  }
}

// 2. Generate 3D Trees & Vegetation (Oliveiras & Ciprestes)
const treeFeatures = [];
let treeCount = 0;

// Cypress alley leading to Santuário de Nossa Senhora da Piedade
const sanctuaryLat = 41.2965;
const sanctuaryLon = -7.5185;
for (let step = 0; step < 14; step++) {
  const tLat = sanctuaryLat - (step * 0.00030);
  const tLonLeft = sanctuaryLon - 0.00016;
  const tLonRight = sanctuaryLon + 0.00016;

  // Left & Right cypress trees (Ciprestes dos Santuários)
  treeFeatures.push({
    type: "Feature",
    id: `cypress-${++treeCount}`,
    geometry: { type: "Point", coordinates: [tLonLeft, tLat] },
    properties: {
      type: "Cipreste Monumental (Cupressus)",
      species: "Cupressus sempervirens",
      height: 9.5 + Math.random() * 2.0,
      width: 2.2,
      style: "cypress"
    }
  });

  treeFeatures.push({
    type: "Feature",
    id: `cypress-${++treeCount}`,
    geometry: { type: "Point", coordinates: [tLonRight, tLat] },
    properties: {
      type: "Cipreste Monumental (Cupressus)",
      species: "Cupressus sempervirens",
      height: 9.5 + Math.random() * 2.0,
      width: 2.2,
      style: "cypress"
    }
  });
}

// Olive trees (Oliveiras) around the vineyards and parish terraces
for (let i = -18; i <= 18; i += 2) {
  for (let j = -18; j <= 18; j += 2) {
    const dist = Math.sqrt(i * i + j * j);
    if (dist < 4 || dist > 18) continue;
    if (Math.random() > 0.55) continue; // dispersed orchard terraces

    const oLat = centerLat + (i * 0.00045) + ((Math.random() - 0.5) * 0.0002);
    const oLon = centerLon + (j * 0.00055) + ((Math.random() - 0.5) * 0.0002);

    treeFeatures.push({
      type: "Feature",
      id: `olive-${++treeCount}`,
      geometry: { type: "Point", coordinates: [oLon, oLat] },
      properties: {
        type: "Oliveira Centenária Duriense (Olea)",
        species: "Olea europaea",
        height: 5.2 + Math.random() * 1.8,
        width: 4.8 + Math.random() * 1.5,
        style: "olive"
      }
    });
  }
}

// Write GeoJSON files
fs.writeFileSync("public/data/sanfins-buildings.geojson", JSON.stringify({
  type: "FeatureCollection",
  name: "Edificios_Sanfins_do_Douro",
  features: buildingFeatures
}, null, 2));

fs.writeFileSync("public/data/sanfins-roofs.geojson", JSON.stringify({
  type: "FeatureCollection",
  name: "Telhados_Ceramicos_Sanfins",
  features: roofFeatures
}, null, 2));

fs.writeFileSync("public/data/sanfins-trees.geojson", JSON.stringify({
  type: "FeatureCollection",
  name: "Vegetacao_3D_Sanfins_do_Douro",
  features: treeFeatures
}, null, 2));

console.log(`Gerados com sucesso:
- ${buildingFeatures.length} Paredes de Edifícios (public/data/sanfins-buildings.geojson)
- ${roofFeatures.length} Telhados Cerâmicos Tradicionais (public/data/sanfins-roofs.geojson)
- ${treeFeatures.length} Árvores 3D: Ciprestes e Oliveiras Durienses (public/data/sanfins-trees.geojson)`);
