import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

// Let's generate an SVG map of buildings in Sanfins center so we can inspect every building ID clearly
const minLon = -7.525, maxLon = -7.515;
const minLat = 41.290, maxLat = 41.297;

const width = 1200, height = 1000;
const scaleX = width / (maxLon - minLon);
const scaleY = height / (maxLat - minLat);

function toSvg(lon, lat) {
  const x = (lon - minLon) * scaleX;
  const y = height - (lat - minLat) * scaleY;
  return [x, y];
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:#111;">\n`;

for (const f of data.features) {
  const coords = f.geometry.coordinates[0];
  let sumLon = 0, sumLat = 0;
  for (const pt of coords) { sumLon += pt[0]; sumLat += pt[1]; }
  const cLon = sumLon / coords.length;
  const cLat = sumLat / coords.length;

  if (cLon >= minLon && cLon <= maxLon && cLat >= minLat && cLat <= maxLat) {
    const ptsStr = coords.map(pt => toSvg(pt[0], pt[1]).map(v => v.toFixed(1)).join(",")).join(" ");
    const [cx, cy] = toSvg(cLon, cLat);
    svg += `<polygon points="${ptsStr}" fill="#c45" stroke="#fff" stroke-width="0.5" />\n`;
    if (f.properties.area_m2 > 300) {
      svg += `<text x="${cx}" y="${cy}" font-size="9" fill="#0ff" text-anchor="middle">${f.properties.id}</text>\n`;
    }
  }
}

svg += "</svg>";
fs.writeFileSync("sanfins_buildings_map.svg", svg);
console.log("SVG written successfully to sanfins_buildings_map.svg");
