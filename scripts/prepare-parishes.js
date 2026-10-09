import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "public", "data");

function simplifyRing(points, tolerance = 35) {
  if (points.length <= 4) return points;
  function getSqSegDist(p, p1, p2) {
    let x = p1[0], y = p1[1], dx = p2[0] - x, dy = p2[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2[0]; y = p2[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  }
  function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    let maxSqDist = sqTolerance, index;
    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
    }
    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }
  const sqTolerance = tolerance * tolerance;
  const last = points.length - 1;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);
  return simplified.length >= 4 ? simplified : points;
}

function seedRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

async function run() {
  console.log("Loading ArcGIS projectOperator...");
  await projectOperator.load();

  console.log("Fetching ContinenteFreguesias.geojson...");
  const res = await fetch("https://raw.githubusercontent.com/nmota/caop_GeoJSON/master/ContinenteFreguesias.geojson");
  const data = await res.json();
  console.log(`Processing & projecting ${data.features.length} parishes...`);

  const topServices = ["LISBOA", "PORTO", "OEIRAS", "CASCAIS", "COIMBRA", "BRAGA", "AVEIRO", "FARO"];
  const topIndustrial = ["GUIMARÃES", "FAMALICÃO", "SANTO TIRSO", "MARINHA GRANDE", "LEIRIA", "OVAR", "ÁGUEDA"];

  let processedCount = 0;
  const features = [];

  for (const feat of data.features) {
    const id = (feat.properties.Dicofre || "000000").toString().padStart(6, "0");
    const name = (feat.properties.Freguesia || feat.properties.Des_Simpli || "Freguesia").trim();
    const concelho = (feat.properties.Concelho || "Concelho").trim();
    const distrito = (feat.properties.Distrito || "Distrito").trim();
    const munId = id.slice(0, 4);

    const rng = seedRandom(id + name);
    const isTopService = topServices.some((s) => concelho.toUpperCase().includes(s));
    const isTopInd = topIndustrial.some((s) => concelho.toUpperCase().includes(s));

    let pctServicos = 40 + Math.round(rng() * 25);
    let pctIndustria = 20 + Math.round(rng() * 20);
    let pctEmpregadores = Math.round((3.5 + rng() * 4.5) * 10) / 10;
    let pctIndependentes = Math.round((9 + rng() * 9) * 10) / 10;
    let taxaAtividade = Math.round((45 + rng() * 12) * 10) / 10;
    let popAtiva = Math.round(800 + rng() * 8500);

    if (isTopService) {
      pctServicos = Math.round(68 + rng() * 24);
      pctIndustria = Math.round(5 + rng() * 12);
      pctEmpregadores = Math.round((7.5 + rng() * 6.5) * 10) / 10;
      taxaAtividade = Math.round((52 + rng() * 9) * 10) / 10;
      popAtiva = Math.round(2500 + rng() * 22000);
    } else if (isTopInd) {
      pctIndustria = Math.round(38 + rng() * 24);
      pctServicos = Math.round(30 + rng() * 18);
      pctEmpregadores = Math.round((5.0 + rng() * 5.0) * 10) / 10;
    }

    // Simplify and Project
    let geom = feat.geometry;
    let rings = [];
    if (geom.type === "Polygon") {
      rings = geom.coordinates.map((r) => simplifyRing(r, 35));
    } else if (geom.type === "MultiPolygon") {
      // Flatten or keep largest
      geom.coordinates.forEach((poly) => {
        poly.forEach((r) => {
          rings.push(simplifyRing(r, 35));
        });
      });
    }

    if (rings.length === 0) continue;

    try {
      const poly3763 = new Polygon({
        rings: rings,
        spatialReference: { wkid: 3763 },
      });
      const poly4326 = projectOperator.execute(poly3763, { wkid: 4326 });
      const projectedRings = poly4326.rings.map((ring) =>
        ring.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000])
      );

      features.push({
        type: "Feature",
        properties: {
          id_freguesia: id,
          nome_freguesia: name,
          id_municipio: munId,
          nome_municipio: concelho,
          distrito: distrito,
          pct_empregadores: pctEmpregadores,
          pct_trabalhadores_independentes: pctIndependentes,
          pct_servicos: pctServicos,
          pct_industria: pctIndustria,
          pop_ativa: popAtiva,
          taxa_atividade: taxaAtividade,
        },
        geometry: {
          type: "Polygon",
          coordinates: projectedRings,
        },
      });
    } catch {
      // Skip degenerate geometry if any
    }

    processedCount++;
    if (processedCount % 500 === 0) {
      console.log(`Processed ${processedCount}/${data.features.length}...`);
    }
  }

  const outGeoJson = {
    type: "FeatureCollection",
    features,
  };

  const outPath = path.join(DATA_DIR, "portugal-freguesias.geojson");
  fs.writeFileSync(outPath, JSON.stringify(outGeoJson));
  console.log(`Saved ${features.length} parishes to ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
