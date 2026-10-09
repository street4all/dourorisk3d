import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

// Rotate building polygons into screen space (heading 42)
const headingRad = 42 * Math.PI / 180;
const cosH = Math.cos(headingRad);
const sinH = Math.sin(headingRad);

const testIds = [801, 2265, 1094, 2005, 467, 1286, 224, 729, 961, 1467, 1106, 732, 1683, 1241, 1423];

let html = `<!DOCTYPE html><html><body style="background:#222;color:#fff;font-family:sans-serif;"><h2>Silhuetas de Edifícios (Orientados na Vista da Foto)</h2><div style="display:flex;flex-wrap:wrap;gap:20px;">`;

for (const id of testIds) {
  const f = data.features.find(x => x.properties.id === id);
  if (!f) continue;
  const coords = f.geometry.coordinates[0];
  
  // Transform to screen space:
  // Xscreen (right) = dx * cosH - dy * sinH
  // Yscreen (up) = dx * sinH + dy * cosH
  // Note: in SVG, y goes down, so Ysvg = -Yscreen
  const pts = coords.map(pt => {
    const dx = (pt[0] - (-7.518)) * 83000;
    const dy = (pt[1] - 41.293) * 111000;
    const sx = dx * cosH - dy * sinH;
    const sy = -(dx * sinH + dy * cosH);
    return [sx, sy];
  });
  
  const minX = Math.min(...pts.map(p => p[0]));
  const maxX = Math.max(...pts.map(p => p[0]));
  const minY = Math.min(...pts.map(p => p[1]));
  const maxY = Math.max(...pts.map(p => p[1]));
  
  const w = maxX - minX + 20;
  const h = maxY - minY + 20;
  
  const svgPts = pts.map(p => `${(p[0] - minX + 10).toFixed(1)},${(p[1] - minY + 10).toFixed(1)}`).join(" ");
  
  html += `<div style="border:1px solid #555;padding:10px;text-align:center;">
    <h3>ID: ${id} (${f.properties.area_m2} m²)</h3>
    <p>Lat: ${coords[0][1].toFixed(5)}, Lon: ${coords[0][0].toFixed(5)}</p>
    <svg width="${Math.max(w, 80)}" height="${Math.max(h, 80)}" style="background:#333;">
      <polygon points="${svgPts}" fill="#00d2ff" stroke="#fff" stroke-width="1.5" />
    </svg>
  </div>`;
}

html += `</div></body></html>`;
fs.writeFileSync("building_silhouettes.html", html);
console.log("Written building_silhouettes.html");
