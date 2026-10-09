const query = `[out:json];
(
  way["amenity"="place_of_worship"](41.285,-7.530,41.305,-7.510);
  way["building"="church"](41.285,-7.530,41.305,-7.510);
  node["amenity"="place_of_worship"](41.285,-7.530,41.305,-7.510);
);
out center;`;

fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query))
  .then(res => res.json())
  .then(data => {
    console.log("OSM Churches in Sanfins area:");
    data.elements.forEach(el => {
      const lat = el.lat || el.center?.lat;
      const lon = el.lon || el.center?.lon;
      console.log(`- ${el.tags?.name || "Sem nome"} (${el.tags?.religion || "N/A"}) at Lat: ${lat}, Lon: ${lon}, ID: ${el.id}`);
    });
  })
  .catch(err => console.error(err));
