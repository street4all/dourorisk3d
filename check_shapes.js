import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

// Check buildings near football field (Lat ~ 41.292 to 41.295, Lon ~ -7.519 to -7.517)
const candidates = [801, 2265, 1094, 2005, 467, 1286, 224, 729, 961, 1467, 1361, 81, 1073, 55];

for (const id of candidates) {
  const f = data.features.find(x => x.properties.id === id);
  if (!f) continue;
  const coords = f.geometry.coordinates[0];
  let sumLon = 0, sumLat = 0;
  for (const pt of coords) { sumLon += pt[0]; sumLat += pt[1]; }
  const cLon = sumLon / coords.length;
  const cLat = sumLat / coords.length;
  
  console.log(`=== ID ${id} (Area: ${f.properties.area_m2}m², Pts: ${coords.length}) ===`);
  console.log(`Center: [${cLon.toFixed(6)}, ${cLat.toFixed(6)}]`);
  console.log("Coords (relative to min in meters):");
  const minX = Math.min(...coords.map(c => c[0]));
  const minY = Math.min(...coords.map(c => c[1]));
  const rel = coords.map(c => [
    Math.round((c[0] - minX) * 83000),
    Math.round((c[1] - minY) * 111000)
  ]);
  console.log(JSON.stringify(rel));
}
