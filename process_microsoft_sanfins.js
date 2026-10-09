import fs from "fs";
import zlib from "zlib";
import https from "https";

const url = "https://bfppub.z5.web.core.windows.net/2026-08-13/global-buildings.geojsonl/RegionName=Portugal/quadkey=031332323/part-00060-110f5303-ff85-4c71-a2bf-c6070024fec8.c000.csv.gz";

// Geographic bounds of Sanfins do Douro parish
const minLat = 41.270, maxLat = 41.312;
const minLon = -7.560, maxLon = -7.490;

// Landmark coordinates to identify notable structures
const landmarks = [
  { name: "Igreja Matriz de São Miguel", lat: 41.2912, lon: -7.5218, type: "Monumento Religioso", height: 13.5 },
  { name: "Santuário de Nossa Senhora da Piedade", lat: 41.2965, lon: -7.5185, type: "Santuário Monumental", height: 16.0 },
  { name: "Adega Cooperativa de Sanfins do Douro", lat: 41.2902, lon: -7.5230, type: "Adega Vinícola do Douro", height: 10.0 },
  { name: "Junta de Freguesia de Sanfins do Douro", lat: 41.2919, lon: -7.5208, type: "Serviços Públicos", height: 7.5 }
];

function calculateAreaM2(coords) {
  // Approximate Shoelace formula in square meters
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    const x1 = coords[i][0] * 83000;
    const y1 = coords[i][1] * 111000;
    const x2 = coords[i + 1][0] * 83000;
    const y2 = coords[i + 1][1] * 111000;
    area += (x1 * y2 - x2 * y1);
  }
  return Math.abs(area / 2);
}

function processFeatures() {
  console.log("A iniciar download e processamento de contornos de satélite da Microsoft...");

  const buildings = [];
  const roofs = [];

  https.get(url, (res) => {
    const gunzip = zlib.createGunzip();
    let buffer = "";
    let count = 0;

    res.pipe(gunzip).on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const feat = JSON.parse(line);
          const ring = feat.geometry?.coordinates?.[0];
          if (!ring || ring.length < 3) continue;

          // Check centroid
          let sumLon = 0, sumLat = 0;
          for (const pt of ring) {
            sumLon += pt[0];
            sumLat += pt[1];
          }
          const cLon = sumLon / ring.length;
          const cLat = sumLat / ring.length;

          if (cLat >= minLat && cLat <= maxLat && cLon >= minLon && cLon <= maxLon) {
            count++;
            const areaM2 = calculateAreaM2(ring);

            // Check if near known landmark
            let matchedLandmark = null;
            for (const lm of landmarks) {
              const d = Math.hypot((cLat - lm.lat) * 111000, (cLon - lm.lon) * 83000);
              if (d < 45) { // within 45m
                matchedLandmark = lm;
                break;
              }
            }

            let height = 6.0;
            let levels = 2;
            let buildingType = "Habitação Tradicional Duriense";
            let name = `Edifício Satélite IA #${count}`;
            let material = "Alvenaria e Xisto com Cantarias de Granito";

            if (matchedLandmark) {
              name = matchedLandmark.name;
              buildingType = matchedLandmark.type;
              height = matchedLandmark.height;
              levels = Math.round(height / 3.2);
              material = "Granito Nobre Regional e Cantaria Lavrada";
            } else if (areaM2 > 260) {
              buildingType = "Quinta / Adega Vinícola do Douro";
              name = `Quinta / Adega Vinícola (#${count})`;
              height = 8.5;
              levels = 2;
              material = "Instalações de Produção e Envelhecimento Duriense";
            } else if (areaM2 > 120) {
              buildingType = "Habitação Duriense Ampla";
              name = `Casa Senhorial Duriense (#${count})`;
              height = 6.8;
              levels = 2;
              material = "Alvenaria Caiada e Guarnições de Granito";
            } else if (areaM2 < 50) {
              buildingType = "Anexo / Lagar Agrícola";
              name = `Anexo Tradicional (#${count})`;
              height = 3.4;
              levels = 1;
              material = "Muro de Xisto com Telhado de Telha";
            }

            // Building feature (walls)
            buildings.push({
              type: "Feature",
              id: count,
              geometry: feat.geometry,
              properties: {
                id: count,
                name,
                building_type: buildingType,
                area_m2: Math.round(areaM2),
                wall_height: height,
                height,
                levels,
                material,
                source: "Microsoft AI Satellite Detection (Bing Maps)",
                address: "Freguesia de Sanfins do Douro, Alijó"
              }
            });

            // Matching roof feature (elevated on top)
            roofs.push({
              type: "Feature",
              id: `roof-${count}`,
              geometry: feat.geometry,
              properties: {
                id: `roof-${count}`,
                name: `Telhado de Telha Cerâmica (${name})`,
                building_type: buildingType,
                base_height: height,
                roof_thickness: 0.8,
                source: "Microsoft AI Satellite Footprint"
              }
            });
          }
        } catch (err) {}
      }
    }).on("end", () => {
      console.log(`Processamento concluído com sucesso!`);
      console.log(`Total de edifícios reais de satélite extraídos: ${buildings.length}`);

      const bGeo = {
        type: "FeatureCollection",
        name: "Microsoft_AI_Edificios_Sanfins_do_Douro",
        features: buildings
      };

      const rGeo = {
        type: "FeatureCollection",
        name: "Microsoft_AI_Telhados_Sanfins_do_Douro",
        features: roofs
      };

      fs.writeFileSync("public/data/sanfins-ms-buildings.geojson", JSON.stringify(bGeo, null, 2));
      fs.writeFileSync("public/data/sanfins-ms-roofs.geojson", JSON.stringify(rGeo, null, 2));

      console.log("Ficheiros guardados em:");
      console.log("- public/data/sanfins-ms-buildings.geojson");
      console.log("- public/data/sanfins-ms-roofs.geojson");
    });
  }).on("error", console.error);
}

processFeatures();
