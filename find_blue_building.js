import fs from "fs";

const data = JSON.parse(fs.readFileSync("public/data/sanfins-ms-buildings.geojson", "utf8"));

// The camera is at lon -7.527, lat 41.284, z 1250, heading 42, tilt 64
// In this camera view, what direction is "Right in the image"?
// Camera heading is 42° (NE).
// Straight ahead in the image is 42° (North-East).
// Right in the image is 42° + 90° = 132° (South-East)!
// Left in the image is 42° - 90° = -48° = 312° (North-West)!
// Top in the image is further along 42° (North-East).
// Bottom in the image is closer to the camera (South-West).

// So:
// - The football field is in the lower center.
// - The blue building is above the football field and slightly right.
// - In the image, the front of the church faces RIGHT (which is approx heading 132° / South-East)!

console.log("Searching for buildings near the football field...");

// Let's filter buildings that are above the football field
for (const f of data.features) {
  const coords = f.geometry.coordinates[0];
  let sumLon = 0, sumLat = 0;
  for (const pt of coords) { sumLon += pt[0]; sumLat += pt[1]; }
  const cLon = sumLon / coords.length;
  const cLat = sumLat / coords.length;

  // Let's look in the bounding box around Sanfins center:
  // Lat: 41.2925 to 41.2960, Lon: -7.5210 to -7.5160
  if (cLat >= 41.2920 && cLat <= 41.2955 && cLon >= -7.5200 && cLon <= -7.5165) {
    if (f.properties.area_m2 >= 300) {
      console.log(`ID: ${f.properties.id} | Area: ${f.properties.area_m2}m² | Pts: ${coords.length} | Lat: ${cLat.toFixed(6)}, Lon: ${cLon.toFixed(6)}`);
    }
  }
}
