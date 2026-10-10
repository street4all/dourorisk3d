import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../public/data/alijo-estradas.geojson");
const CONCELHO_FILE = path.resolve(__dirname, "../public/data/alijo-concelho.geojson");

function pointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyHighway(hw) {
  switch (hw) {
    case "motorway":
    case "trunk":
    case "primary":
      return "Estrada Nacional / Principal";
    case "secondary":
      return "Estrada Regional";
    case "tertiary":
      return "Estrada Municipal";
    case "residential":
    case "living_street":
      return "Arruamento Local";
    case "track":
      return "Caminho Florestal / Rural";
    default:
      return "Via de Acesso Local";
  }
}

function classifySurface(surface, hw) {
  if (surface) {
    const s = surface.toLowerCase();
    if (s.includes("asphalt") || s.includes("paved") || s.includes("concrete") || s.includes("sett") || s.includes("cobblestone")) {
      return "Pavimentada";
    }
    if (s.includes("ground") || s.includes("dirt") || s.includes("earth") || s.includes("unpaved") || s.includes("gravel")) {
      return "Terra batida";
    }
  }
  return hw === "track" ? "Terra batida" : "Pavimentada";
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchOverpassData(query) {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter"
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const ep of endpoints) {
      try {
        console.log(`[Tentativa ${attempt}] A contactar ${ep}...`);
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "DouroRisk3D/1.0 (hugovilela81@gmail.com)"
          },
          body: "data=" + encodeURIComponent(query)
        });

        if (res.ok) {
          console.log(`-> Sucesso em ${ep}!`);
          return await res.json();
        }
        console.warn(`-> ${ep} devolveu status ${res.status}.`);
      } catch (e) {
        console.warn(`-> ${ep} erro de rede: ${e.message}`);
      }
      await sleep(1500);
    }
    console.log("A aguardar 5 segundos antes de tentar novamente...");
    await sleep(5000);
  }
  throw new Error("Não foi possível contactar os servidores do Overpass após várias tentativas.");
}

async function extractRoads() {
  console.log("1. A ler limites do concelho de Alijó...");
  const concelhoData = JSON.parse(fs.readFileSync(CONCELHO_FILE, "utf-8"));
  const polygonCoords = concelhoData.features[0].geometry.coordinates[0];

  console.log("2. A descarregar rede viária e caminhos florestais do OpenStreetMap...");
  const bbox = "41.16,-7.58,41.38,-7.39";
  const query = `[out:json][timeout:180];
(way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|track"](${bbox}););
out geom qt;`;

  const data = await fetchOverpassData(query);
  const elements = data.elements || [];
  console.log(`Recebidas ${elements.length} vias do OpenStreetMap.`);

  const features = [];
  let insideCount = 0;

  for (const el of elements) {
    if (!el.geometry || el.geometry.length < 2) continue;

    const coords = el.geometry.map(pt => [Number(pt.lon.toFixed(6)), Number(pt.lat.toFixed(6))]);
    
    const midPt = coords[Math.floor(coords.length / 2)];
    const isInside = pointInPolygon(midPt, polygonCoords) || 
                     pointInPolygon(coords[0], polygonCoords) || 
                     pointInPolygon(coords[coords.length - 1], polygonCoords);

    if (!isInside) continue;
    insideCount++;

    const tags = el.tags || {};
    const highway = tags.highway || "unclassified";
    const ref = tags.ref || "";
    let name = tags.name || ref;

    if (!name) {
      name = classifyHighway(highway);
    } else if (ref && tags.name && !tags.name.includes(ref)) {
      name = `${ref} - ${tags.name}`;
    }

    const surface = classifySurface(tags.surface, highway);
    const tipo = classifyHighway(highway);

    features.push({
      type: "Feature",
      id: el.id,
      properties: {
        id: el.id,
        name,
        highway,
        tipo,
        ref,
        surface,
        tracktype: tags.tracktype || ""
      },
      geometry: {
        type: "LineString",
        coordinates: coords
      }
    });
  }

  const geojson = {
    type: "FeatureCollection",
    name: "Rede Viária e Caminhos Florestais de Alijó",
    features
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(geojson), "utf-8");
  const sizeMB = (fs.statSync(OUT_FILE).size / (1024 * 1024)).toFixed(2);
  console.log(`3. SUCESSO! Guardado em: ${OUT_FILE}`);
  console.log(`   - Vias dentro de Alijó: ${features.length}`);
  console.log(`   - Tamanho: ${sizeMB} MB`);
}

extractRoads().catch(err => {
  console.error("Erro na extração:", err);
  process.exit(1);
});
