import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

// The camera in the screenshot is:
// position: [-7.527, 41.284, 1250], heading: 42, tilt: 64
// Looking at heading 42°:
// Let's project geographic coordinates to screen coordinates from this camera!
const camLon = -7.527, camLat = 41.284, camZ = 1250;
const headingRad = 42 * Math.PI / 180;
const tiltRad = 64 * Math.PI / 180;

// Current church position:
console.log("Current church model position: lon -7.5185, lat 41.2965");

// Distance from camera:
// dx (East) = (lon - camLon) * 83000
// dy (North) = (lat - camLat) * 111000
// From heading 42°:
// forward = dx * sin(42) + dy * cos(42)
// right = dx * cos(42) - dy * sin(42)

for (const f of data.features) {
  const coords = f.geometry.coordinates[0];
  let sumLon = 0, sumLat = 0;
  for (const pt of coords) { sumLon += pt[0]; sumLat += pt[1]; }
  const cLon = sumLon / coords.length;
  const cLat = sumLat / coords.length;

  const dx = (cLon - camLon) * 83000;
  const dy = (cLat - camLat) * 111000;
  
  const forward = dx * Math.sin(headingRad) + dy * Math.cos(headingRad);
  const right = dx * Math.cos(headingRad) - dy * Math.sin(headingRad);

  // In the screenshot:
  // Church model is at bottom right: forward is smaller, right is positive.
  // Football field is in lower center.
  // The blue building is further forward and to the right of center!
  if (f.properties.area_m2 > 300 && forward > 700 && forward < 1600 && Math.abs(right) < 400) {
    console.log(`ID: ${f.properties.id} | Area: ${f.properties.area_m2} | Pts: ${coords.length} | Lat: ${cLat.toFixed(6)}, Lon: ${cLon.toFixed(6)} | Forward: ${forward.toFixed(0)}m, Right: ${right.toFixed(0)}m`);
  }
}
