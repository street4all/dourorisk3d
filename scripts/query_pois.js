import fs from 'fs';

async function main() {
  const query = `[out:json][timeout:90];
(
  node["amenity"](41.275,-7.585,41.385,-7.460);
  way["amenity"](41.275,-7.585,41.385,-7.460);
  node["shop"](41.275,-7.585,41.385,-7.460);
  way["shop"](41.275,-7.585,41.385,-7.460);
  node["tourism"](41.275,-7.585,41.385,-7.460);
  way["tourism"](41.275,-7.585,41.385,-7.460);
  node["leisure"](41.275,-7.585,41.385,-7.460);
  way["leisure"](41.275,-7.585,41.385,-7.460);
  node["healthcare"](41.275,-7.585,41.385,-7.460);
  way["healthcare"](41.275,-7.585,41.385,-7.460);
  node["office"](41.275,-7.585,41.385,-7.460);
  way["office"](41.275,-7.585,41.385,-7.460);
  node["historic"](41.275,-7.585,41.385,-7.460);
  way["historic"](41.275,-7.585,41.385,-7.460);
  node["building"](41.275,-7.585,41.385,-7.460);
  way["building"](41.275,-7.585,41.385,-7.460);
);
out center;`;

  console.log("Fetching from Overpass kumi...");
  const endpoint = 'https://overpass.kumi.systems/api/interpreter';
  const res = await fetch(endpoint, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'DouroRiskResearcher/1.0 (contact@dourorisk.pt)'
    }
  });
  console.log('Status:', res.status);
  const text = await res.text();
  if (!res.ok) {
    console.error('Error body:', text.slice(0, 500));
    return;
  }
  const data = JSON.parse(text);
  console.log('Total elements:', data.elements.length);

  const named = data.elements.filter(e => e.tags && (e.tags.name || e.tags.amenity || e.tags.shop || e.tags.tourism || e.tags.historic || e.tags.office)).map(e => ({
    id: e.id,
    type: e.type,
    name: e.tags.name,
    amenity: e.tags.amenity,
    historic: e.tags.historic,
    tourism: e.tags.tourism,
    shop: e.tags.shop,
    leisure: e.tags.leisure,
    healthcare: e.tags.healthcare,
    office: e.tags.office,
    building: e.tags.building,
    lat: e.lat || e.center?.lat,
    lon: e.lon || e.center?.lon,
    tags: e.tags
  }));

  fs.writeFileSync('scripts/osm_all_pois.json', JSON.stringify(named, null, 2));
  console.log('Saved to scripts/osm_all_pois.json. Count:', named.length, 'Named:', named.filter(x => x.name).length);
}

main().catch(console.error);
