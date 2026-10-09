import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

const results = [];
for (const f of data.features) {
  const coords = f.geometry.coordinates[0];
  let sumLon = 0, sumLat = 0;
  for (const pt of coords) {
    sumLon += pt[0];
    sumLat += pt[1];
  }
  const cLon = sumLon / coords.length;
  const cLat = sumLat / coords.length;
  
  if (cLat > 41.2915 && cLat < 41.2965 && cLon > -7.521 && cLon < -7.516) {
    const lons = coords.map(p => p[0]);
    const lats = coords.map(p => p[1]);
    const minX = Math.min(...lons), maxX = Math.max(...lons);
    const minY = Math.min(...lats), maxY = Math.max(...lats);
    const widthMeters = (maxX - minX) * 83000;
    const heightMeters = (maxY - minY) * 111000;
    
    if (f.properties.area_m2 > 250) {
      results.push({
        id: f.properties.id,
        area: f.properties.area_m2,
        pts: coords.length,
        lat: cLat,
        lon: cLon,
        w: widthMeters,
        h: heightMeters,
        coords
      });
    }
  }
}

results.sort((a,b) => b.area - a.area);
for (const r of results) {
  console.log(`ID: ${r.id} | Area: ${r.area}m² | Pts: ${r.pts} | Lat: ${r.lat.toFixed(6)}, Lon: ${r.lon.toFixed(6)} | W: ${r.w.toFixed(1)}m, H: ${r.h.toFixed(1)}m`);
}
