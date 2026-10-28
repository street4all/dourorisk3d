import fs from 'fs';

// PTTM06 conversion
const a = 6378137;
const f = 1 / 298.257222101;
const lat0 = 39.66825833333333;
const lon0 = -8.133108333333334;
const k0 = 1;
const fe = 0;
const fn = 0;
const DEG = Math.PI / 180;

const n = f / (2 - f);
const e2 = f * (2 - f);
const e = Math.sqrt(e2);
const e2m = 1 - e2;
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

const ALPHA = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];

function taup(tau) {
  const tau1 = Math.hypot(1, tau);
  const sig = Math.sinh(e * Math.atanh((e * tau) / tau1));
  return Math.hypot(1, sig) * tau - sig * tau1;
}

function krueger(xi, eta, c, sign) {
  const s1 = Math.sin(2 * xi), c1 = Math.cos(2 * xi);
  const sh1 = Math.sinh(2 * eta), ch1 = Math.cosh(2 * eta);
  let sPrev = 0, sCur = s1, cPrev = 1, cCur = c1;
  let shPrev = 0, shCur = sh1, chPrev = 1, chCur = ch1;
  let dx = 0, de = 0;
  for (let j = 1; j <= 6; j++) {
    dx += c[j] * sCur * chCur;
    de += c[j] * cCur * shCur;
    const sN = 2 * c1 * sCur - sPrev, cN = 2 * c1 * cCur - cPrev;
    const shN = 2 * ch1 * shCur - shPrev, chN = 2 * ch1 * chCur - chPrev;
    sPrev = sCur; sCur = sN; cPrev = cCur; cCur = cN;
    shPrev = shCur; shCur = shN; chPrev = chCur; chCur = chN;
  }
  return [xi + sign * dx, eta + sign * de];
}

const XI0 = krueger(Math.atan(taup(Math.tan(lat0 * DEG))), 0, ALPHA, 1)[0];

function toTM06(lon, lat) {
  const lam = (lon - lon0) * DEG;
  const tp = taup(Math.tan(lat * DEG));
  const cl = Math.cos(lam);
  const xip = Math.atan2(tp, cl);
  const etap = Math.asinh(Math.sin(lam) / Math.hypot(tp, cl));
  const [xi, eta] = krueger(xip, etap, ALPHA, 1);
  return [fe + k0 * A * eta, fn + k0 * A * (xi - XI0)];
}

function pointInPoly(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const fregs = JSON.parse(fs.readFileSync('public/data/alijo-freguesias.geojson', 'utf8')).features;
const pois = JSON.parse(fs.readFileSync('scripts/osm_all_pois.json', 'utf8'));

function findFreguesia(lon, lat) {
  for (const f of fregs) {
    const geom = f.geometry;
    if (geom.type === 'Polygon') {
      if (pointInPoly([lon, lat], geom.coordinates[0])) return f.properties.nome_freguesia;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (pointInPoly([lon, lat], poly[0])) return f.properties.nome_freguesia;
      }
    }
  }
  return null;
}

const targetFregs = new Set([
  'Sanfins do Douro',
  'Vila Verde',
  'Vila Chã',
  'Vilar de Maçada',
  'União das freguesias de Pópulo e Ribalonga'
]);

// Exclude outdoor-only features
const outdoorTypes = new Set([
  'drinking_water', 'fountain', 'watering_place', 'wayside_cross', 'wayside_shrine',
  'archaeological_site', 'viewpoint', 'picnic_site', 'bench', 'parking', 'waste_basket',
  'hunting_blind', 'cross', 'memorial'
]);

const existingIds = new Set(['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11']);
const existingNames = [
  "junta de freguesia de sanfins do douro",
  "associação social e cultural de sanfins do douro",
  "bombeiros voluntários de sanfins do douro",
  "junta de freguesia de vila verde",
  "centro social, recreativo e cultural de vila verde",
  "junta de freguesia de vila chã",
  "associação de s. tiago de vila chã",
  "edifício da antiga junta de freguesia de ribalonga",
  "associação recreativa e cultural de santana / ribalonga de santana",
  "junta de freguesia de vilar de maçada",
  "centro social, recreativo e cultural de vilar de maçada"
];

const indoorCandidates = [];

for (const p of pois) {
  if (!p.lat || !p.lon) continue;
  const freg = findFreguesia(p.lon, p.lat);
  if (!freg || !targetFregs.has(freg)) continue;

  const t = p.tags || {};
  // If explicitly outdoor
  if (outdoorTypes.has(t.amenity) || outdoorTypes.has(t.historic) || outdoorTypes.has(t.tourism)) {
    continue;
  }
  // Check if name matches any existing
  const pName = (p.name || '').trim();
  const lowerName = pName.toLowerCase();
  if (existingNames.some(en => lowerName.includes(en) || en.includes(lowerName))) {
    continue;
  }

  const [x, y] = toTM06(p.lon, p.lat);
  indoorCandidates.push({
    name: pName || (t.building === 'church' ? 'Igreja' : t.amenity || 'Edifício público'),
    freguesia: freg === 'União das freguesias de Pópulo e Ribalonga' ? 'Ribalonga' : freg,
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    lat: Number(p.lat.toFixed(7)),
    lon: Number(p.lon.toFixed(7)),
    amenity: t.amenity,
    shop: t.shop,
    tourism: t.tourism,
    historic: t.historic,
    building: t.building,
    tags: t,
    osmId: p.id,
    osmType: p.type
  });
}

console.log('Indoor candidates inside target freguesias:', indoorCandidates.length);
fs.writeFileSync('scripts/indoor_candidates.json', JSON.stringify(indoorCandidates, null, 2));

indoorCandidates.forEach((c, i) => {
  console.log(`${i+1}. [${c.name}] (${c.freguesia}) - amenity: ${c.amenity}, shop: ${c.shop}, building: ${c.building}, historic: ${c.historic}`);
});
