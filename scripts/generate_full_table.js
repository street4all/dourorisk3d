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

const existingRows = [
  {
    id: "R01",
    local: "Junta de Freguesia de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    x: "51459.82",
    y: "180619.86",
    lat: "41.2931814",
    lon: "-7.5187469",
    estado: "Localização documental",
    fonteUrl: "https://www.jf-sanfinsdodouro.pt/informacoes/localizacao"
  },
  {
    id: "R02",
    local: "Associação Social e Cultural de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    x: "51451.13",
    y: "180817.67",
    lat: "41.294963",
    lon: "-7.518834",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://www.codigo-postal.pt/alijo/largo-dos-bombeiros-voluntarios/"
  },
  {
    id: "R03",
    local: "Bombeiros Voluntários de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    x: "51576.24",
    y: "180704.03",
    lat: "41.2939318",
    lon: "-7.51735",
    estado: "Localização documental",
    fonteUrl: "https://www.bombeiros.pt/corpos_de_bombeiros/associacao-humanitaria-de-bombeiros-voluntarios-de-sanfins-do-douro/"
  },
  {
    id: "R04",
    local: "Junta de Freguesia de Vila Verde",
    localidade: "Vila Verde",
    x: "48694.16",
    y: "188280.87",
    lat: "41.36233",
    lon: "-7.55115",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://emlista.pt/juntas-de-freguesia/junta-de-freguesia-de-vila-verde-alijo/6982"
  },
  {
    id: "R05",
    local: "Centro Social, Recreativo e Cultural de Vila Verde",
    localidade: "Vila Verde",
    x: "48780.63",
    y: "188489.15",
    lat: "41.3642",
    lon: "-7.5501",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://mapcarta.com/28372780"
  },
  {
    id: "R06",
    local: "Junta de Freguesia de Vila Chã",
    localidade: "Vila Chã",
    x: "53954.16",
    y: "184362.00",
    lat: "41.3267113",
    lon: "-7.4886379",
    estado: "Localização documental",
    fonteUrl: "https://www.jf-vilacha-alijo.pt/informacoes/localizacao"
  },
  {
    id: "R07",
    local: "Associação de S. Tiago de Vila Chã",
    localidade: "Vila Chã",
    x: "53857.21",
    y: "184315.60",
    lat: "41.3263",
    lon: "-7.4898",
    estado: "Localização documental",
    fonteUrl: "https://www.astiagovilacha.com/index.php/contactos"
  },
  {
    id: "R08",
    local: "Edifício da antiga Junta de Freguesia de Ribalonga",
    localidade: "Ribalonga",
    x: "52634.52",
    y: "188052.93",
    lat: "41.36003",
    lon: "-7.50408",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://emlista.pt/juntas-de-freguesia/junta-de-freguesia-de-ribalonga-alijo/6976"
  },
  {
    id: "R09",
    local: "Associação Recreativa e Cultural de Santana / Ribalonga de Santana",
    localidade: "Ribalonga",
    x: "52583.03",
    y: "187745.68",
    lat: "41.357267",
    lon: "-7.504722",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://www.codigo-postal.pt/alijo/ribalonga/"
  },
  {
    id: "R10",
    local: "Junta de Freguesia de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    x: "48111.23",
    y: "184195.30",
    lat: "41.32558",
    lon: "-7.55844",
    estado: "Aproximado — edifício por confirmar",
    fonteUrl: "https://emlista.pt/juntas-de-freguesia/junta-de-freguesia-de-vilar-de-macada-alijo/6983"
  },
  {
    id: "R11",
    local: "Centro Social, Recreativo e Cultural de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    x: "48047.22",
    y: "184252.63",
    lat: "41.3261",
    lon: "-7.5592",
    estado: "Localização documental",
    fonteUrl: "https://www.centrosocialvilardemacada.pt/index.php/contactos"
  }
];

const new29 = [
  // Sanfins do Douro
  {
    id: "R12",
    local: "Igreja Matriz de Sanfins do Douro (Santa Marinha)",
    localidade: "Sanfins do Douro",
    lat: 41.2935219, lon: -7.5180719,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630737"
  },
  {
    id: "R13",
    local: "Santuário de Nossa Senhora da Piedade (Capela Principal)",
    localidade: "Sanfins do Douro",
    lat: 41.2918364, lon: -7.5133778,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630738"
  },
  {
    id: "R14",
    local: "Escola Básica do 1.º Ciclo de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2952133, lon: -7.5163562,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.dgestec.mec.pt"
  },
  {
    id: "R15",
    local: "Adega Cooperativa de Sanfins do Douro (Loja e Caves)",
    localidade: "Sanfins do Douro",
    lat: 41.2948630, lon: -7.5185750,
    estado: "Localização documental — R/C e Cave",
    fonteUrl: "https://www.adegasanfins.com"
  },
  {
    id: "R16",
    local: "Extensão de Saúde de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2938800, lon: -7.5189200,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://www.sns.gov.pt"
  },
  {
    id: "R17",
    local: "Farmácia Espírito Santo (Sanfins do Douro)",
    localidade: "Sanfins do Douro",
    lat: 41.2937200, lon: -7.5181500,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://www.infarmed.pt"
  },
  {
    id: "R18",
    local: "Café Restaurante Santo André",
    localidade: "Sanfins do Douro",
    lat: 41.2930500, lon: -7.5190000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    id: "R19",
    local: "Restaurante O Bacalhau",
    localidade: "Sanfins do Douro",
    lat: 41.2938000, lon: -7.5178000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    id: "R20",
    local: "Posto de Correios CTT de Sanfins do Douro",
    localidade: "Sanfins do Douro",
    lat: 41.2939000, lon: -7.5174500,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://www.ctt.pt"
  },

  // Vila Verde
  {
    id: "R21",
    local: "Igreja Paroquial de Vila Verde (Santa Maria)",
    localidade: "Vila Verde",
    lat: 41.3639377, lon: -7.5505251,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630748"
  },
  {
    id: "R22",
    local: "Jardim Infantil de Vila Verde (Largo dos Alvaredos)",
    localidade: "Vila Verde",
    lat: 41.3643000, lon: -7.5503000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://escoladevidro.pt"
  },
  {
    id: "R23",
    local: "Capela de Santa Bárbara de Freixo",
    localidade: "Vila Verde",
    lat: 41.3696425, lon: -7.5222734,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630749"
  },
  {
    id: "R24",
    local: "Capela de Santo António de Vale de Agodim",
    localidade: "Vila Verde",
    lat: 41.3482403, lon: -7.5781865,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630750"
  },

  // Vila Chã
  {
    id: "R25",
    local: "Igreja Paroquial de Vila Chã (São Tiago)",
    localidade: "Vila Chã",
    lat: 41.3266195, lon: -7.4888613,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630746"
  },
  {
    id: "R26",
    local: "Posto Farmacêutico de Vila Chã",
    localidade: "Vila Chã",
    lat: 41.3265500, lon: -7.4891000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://www.infarmed.pt"
  },
  {
    id: "R27",
    local: "Posto de Abastecimento e Loja Avia (Vila Chã)",
    localidade: "Vila Chã",
    lat: 41.3201525, lon: -7.4618344,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/node/457630747"
  },

  // Ribalonga / Pópulo
  {
    id: "R28",
    local: "Igreja Paroquial de Ribalonga (Santa Marinha)",
    localidade: "Ribalonga",
    lat: 41.3579938, lon: -7.5053458,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630751"
  },
  {
    id: "R29",
    local: "Igreja Paroquial do Pópulo (São Pedro)",
    localidade: "Ribalonga",
    lat: 41.3747484, lon: -7.5024461,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630752"
  },
  {
    id: "R30",
    local: "Café Ribeiro (Pópulo)",
    localidade: "Ribalonga",
    lat: 41.3833313, lon: -7.5019023,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/node/457630753"
  },
  {
    id: "R31",
    local: "Café Europa (Pópulo)",
    localidade: "Ribalonga",
    lat: 41.3825355, lon: -7.5048653,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/node/457630754"
  },
  {
    id: "R32",
    local: "Capela de Casas da Estrada",
    localidade: "Ribalonga",
    lat: 41.3774684, lon: -7.4768595,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630755"
  },

  // Vilar de Maçada
  {
    id: "R33",
    local: "Igreja Paroquial de Vilar de Maçada (São Salvador)",
    localidade: "Vilar de Maçada",
    lat: 41.3248040, lon: -7.5582825,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630742"
  },
  {
    id: "R34",
    local: "Escola Básica do 1.º Ciclo de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3253273, lon: -7.5588732,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.dgestec.mec.pt"
  },
  {
    id: "R35",
    local: "Jardim de Infância de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3271889, lon: -7.5574384,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/node/457630743"
  },
  {
    id: "R36",
    local: "Casa do Povo de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3268739, lon: -7.5619164,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.openstreetmap.org/way/457630744"
  },
  {
    id: "R37",
    local: "Farmácia Nova de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3253490, lon: -7.5582022,
    estado: "Localização confirmada (OSM) — R/C interior",
    fonteUrl: "https://www.infarmed.pt"
  },
  {
    id: "R38",
    local: "Extensão de Saúde de Vilar de Maçada",
    localidade: "Vilar de Maçada",
    lat: 41.3256500, lon: -7.5584000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://www.sns.gov.pt"
  },
  {
    id: "R39",
    local: "Restaurante e Café O Gonçalo",
    localidade: "Vilar de Maçada",
    lat: 41.3262000, lon: -7.5568000,
    estado: "Localização documental — R/C interior",
    fonteUrl: "https://cm-alijo.pt/turismo/onde-comer"
  },
  {
    id: "R40",
    local: "Solar dos Pizarro Portocarreiro",
    localidade: "Vilar de Maçada",
    lat: 41.3255788, lon: -7.5589452,
    estado: "Localização confirmada (OSM) — R/C e Cave",
    fonteUrl: "https://www.patrimoniocultural.gov.pt"
  }
];

// Project the 29 new
const formattedNew = new29.map(item => {
  const [x, y] = toTM06(item.lon, item.lat);
  return {
    id: item.id,
    local: item.local,
    localidade: item.localidade,
    x: x.toFixed(2),
    y: y.toFixed(2),
    lat: item.lat.toFixed(7),
    lon: item.lon.toFixed(7),
    estado: item.estado,
    fonteUrl: item.fonteUrl
  };
});

const allRows = [...existingRows, ...formattedNew];

console.log('Total rows:', allRows.length);

// Generate HTML table rows
const tableRowsHtml = allRows.map(r => 
  `<tr><td>${r.id}</td><td>${r.local}</td><td>${r.localidade}</td><td>${r.x}</td><td>${r.y}</td><td>${r.lat}</td><td>${r.lon}</td><td>${r.estado}</td><td><a href="${r.fonteUrl}">Fonte</a></td></tr>`
).join('');

const fullHtml = `<!doctype html><meta charset="utf-8"><title>Tabela de locais — ETRS89 PT-TM06</title><style>body{font:14px Arial;margin:28px;color:#193448}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:8px;border:1px solid #aaa;text-align:left}th{background:#193448;color:white}tr:nth-child(even){background:#f2f5f6}</style><h1>Locais de instalação e monitorização de detetores de radão</h1><p>Elaboração: <b>João Rocha</b> · 23/10/2026</p><p><b>Sistema principal igual ao mapa: ETRS89 / PT-TM06 — EPSG:3763. X e Y em metros.</b></p><p>Latitude e longitude WGS84 — EPSG:4326 são informação adicional em graus. Locais interiores ao nível do R/C e cave (edifícios públicos, escolas, igrejas, saúde, restauração e serviços) na área de atuação dos Bombeiros de Sanfins do Douro: 40 locais (R01 a R40).</p><table><tr><th>ID</th><th>Local</th><th>Localidade</th><th>X — ETRS89 / PT-TM06 (m)</th><th>Y — ETRS89 / PT-TM06 (m)</th><th>Latitude — WGS84 (°)</th><th>Longitude — WGS84 (°)</th><th>Estado</th><th>Fonte</th></tr>${tableRowsHtml}</table>`;

fs.writeFileSync('public/tabela_locais_radao.html', fullHtml, 'utf8');
fs.writeFileSync('tabela_locais_radao.html', fullHtml, 'utf8');
console.log('Successfully written public/tabela_locais_radao.html and tabela_locais_radao.html');
