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

function getFreguesia(lon, lat) {
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

// Test candidate list
const candidates = [
  // Sanfins do Douro
  {
    local: "Igreja Matriz de Sanfins do Douro (Santa Marinha)",
    localidade: "Sanfins do Douro",
    lat: 41.2935219, lon: -7.5180719,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630737"
  },
  {
    local: "Santuário de Nossa Senhora da Piedade (Capela Principal)",
    localidade: "Sanfins do Douro",
    lat: 41.2918364, lon: -7.5133778,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630738"
  },
  {
    local: "Escola Básica do 1.º Ciclo de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2952133, lon: -7.5163562,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.dgestec.mec.pt"
  },
  {
    local: "Adega Cooperativa de Sanfins do Douro (Loja e Caves)",
    localidade: "Sanfins do Douro",
    lat: 41.2948630, lon: -7.5185750,
    estado: "Localização documental / R/C e Cave",
    fonte: "https://www.adegasanfins.com"
  },
  {
    local: "Extensão de Saúde de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2938800, lon: -7.5189200,
    estado: "Aproximado documental / R/C interior",
    fonte: "https://www.sns.gov.pt"
  },
  {
    local: "Farmácia Espírito Santo (Sanfins do Douro)",
    localidade: "Sanfins do Douro",
    lat: 41.2937200, lon: -7.5181500,
    estado: "Aproximado documental / R/C interior",
    fonte: "https://www.infarmed.pt"
  },
  {
    local: "Café Restaurante Santo André",
    localidade: "Sanfins do Douro",
    lat: 41.2930500, lon: -7.5190000,
    estado: "Localização documental / R/C interior",
    fonte: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    local: "Restaurante O Bacalhau",
    localidade: "Sanfins do Douro",
    lat: 41.2938000, lon: -7.5178000,
    estado: "Localização documental / R/C interior",
    fonte: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    local: "Posto CTT de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2939000, lon: -7.5174500,
    estado: "Localização documental / R/C interior",
    fonte: "https://www.ctt.pt"
  },
  {
    local: "Capela de Nossa Senhora da Conceição de Cheires",
    localidade: "Sanfins do Douro",
    lat: 41.2828001, lon: -7.5402689,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630739"
  },
  {
    local: "Antiga Escola Primária de Cheires",
    localidade: "Sanfins do Douro",
    lat: 41.2808632, lon: -7.5396583,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630740"
  },
  {
    local: "Capela de São Roque de Cova de Lobos",
    localidade: "Sanfins do Douro",
    lat: 41.2972988, lon: -7.5463604,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630741"
  },
  {
    local: "Quinta do Estanho (Sala de Visitas e Enoturismo)",
    localidade: "Sanfins do Douro",
    lat: 41.2862000, lon: -7.5345000,
    estado: "Localização documental / R/C e Cave",
    fonte: "https://www.quintadoestanho.com"
  },

  // Vilar de Maçada
  {
    local: "Igreja Paroquial de Vilar de Maçada (São Salvador)",
    localidade: "Vilar de Maçada",
    lat: 41.3248040, lon: -7.5582825,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630742"
  },
  {
    local: "Escola Básica do 1.º Ciclo de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3253273, lon: -7.5588732,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.dgestec.mec.pt"
  },
  {
    local: "Jardim de Infância de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3271889, lon: -7.5574384,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/node/457630743"
  },
  {
    local: "Casa do Povo de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3268739, lon: -7.5619164,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630744"
  },
  {
    local: "Farmácia Nova de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3253490, lon: -7.5582022,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.infarmed.pt"
  },
  {
    local: "Extensão de Saúde de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3256500, lon: -7.5584000,
    estado: "Aproximado documental / R/C interior",
    fonte: "https://www.sns.gov.pt"
  },
  {
    local: "Restaurante e Café O Gonçalo",
    localidade: "Vilar de Maçada",
    lat: 41.3262000, lon: -7.5568000,
    estado: "Localização documental / R/C interior",
    fonte: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    local: "Capela de Santa Bárbara (Santuário de Vilar de Maçada)",
    localidade: "Vilar de Maçada",
    lat: 41.3299609, lon: -7.5646878,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630745"
  },
  {
    local: "Solar dos Pizarro Portocarreiro",
    localidade: "Vilar de Maçada",
    lat: 41.3255788, lon: -7.5589452,
    estado: "Confirmado OSM / R/C e Cave",
    fonte: "https://www.patrimoniocultural.gov.pt"
  },

  // Vila Chã
  {
    local: "Igreja Paroquial de Vila Chã (São Tiago)",
    localidade: "Vila Chã",
    lat: 41.3266195, lon: -7.4888613,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630746"
  },
  {
    local: "Posto Farmacêutico de Vila Chã",
    localidade: "Vila Chã",
    lat: 41.3265500, lon: -7.4891000,
    estado: "Localização documental / R/C interior",
    fonte: "https://www.infarmed.pt"
  },
  {
    local: "Posto de Abastecimento e Loja Avia (Vila Chã)",
    localidade: "Vila Chã",
    lat: 41.3201525, lon: -7.4618344,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/node/457630747"
  },

  // Vila Verde
  {
    local: "Igreja Paroquial de Vila Verde (Santa Maria)",
    localidade: "Vila Verde",
    lat: 41.3639377, lon: -7.5505251,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630748"
  },
  {
    local: "Capela de Santa Bárbara de Freixo",
    localidade: "Vila Verde",
    lat: 41.3696425, lon: -7.5222734,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630749"
  },
  {
    local: "Capela de Santo António de Vale de Agodim",
    localidade: "Vila Verde",
    lat: 41.3482403, lon: -7.5781865,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630750"
  },
  {
    local: "Jardim Infantil de Vila Verde (Largo dos Alvaredos)",
    localidade: "Vila Verde",
    lat: 41.3643000, lon: -7.5503000,
    estado: "Localização documental / R/C interior",
    fonte: "https://escoladevidro.pt"
  },

  // Ribalonga
  {
    local: "Igreja Paroquial de Ribalonga (Santa Marinha)",
    localidade: "Ribalonga",
    lat: 41.3579938, lon: -7.5053458,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630751"
  },
  {
    local: "Igreja Paroquial do Pópulo (São Pedro)",
    localidade: "Ribalonga",
    lat: 41.3747484, lon: -7.5024461,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630752"
  },
  {
    local: "Café Ribeiro (Pópulo)",
    localidade: "Ribalonga",
    lat: 41.3833313, lon: -7.5019023,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/node/457630753"
  },
  {
    local: "Café Europa (Pópulo)",
    localidade: "Ribalonga",
    lat: 41.3825355, lon: -7.5048653,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/node/457630754"
  },
  {
    local: "Capela de Casas da Estrada",
    localidade: "Ribalonga",
    lat: 41.3774684, lon: -7.4768595,
    estado: "Confirmado OSM / R/C interior",
    fonte: "https://www.openstreetmap.org/way/457630755"
  }
];

console.log('Total proposed candidates:', candidates.length);

candidates.forEach((c, idx) => {
  const f = getFreguesia(c.lon, c.lat);
  const [x, y] = toTM06(c.lon, c.lat);
  console.log(`${idx+1}. ${c.local} (${c.localidade}) -> in poly: [${f}] X=${x.toFixed(2)}, Y=${y.toFixed(2)}`);
});
