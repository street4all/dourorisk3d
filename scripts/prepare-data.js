import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "public", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Function to round coordinates to 4 decimals (~11m precision)
function roundCoords(coords) {
  if (typeof coords[0] === "number") {
    return [Math.round(coords[0] * 10000) / 10000, Math.round(coords[1] * 10000) / 10000];
  }
  return coords.map(roundCoords);
}

// Deterministic pseudo-random generator based on a string seed
function seedRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

async function prepareMunicipalities() {
  console.log("Fetching Portugal Municipalities...");
  const res = await fetch("https://raw.githubusercontent.com/nmota/caop_GeoJSON/master/Portugal_Municipalities.geojson");
  const data = await res.json();

  console.log(`Processing ${data.features.length} municipalities...`);

  // Key Portuguese economic hubs profiles
  const topServices = ["LISBOA", "PORTO", "OEIRAS", "CASCAIS", "COIMBRA", "BRAGA", "AVEIRO", "FARO", "FUNCHAL"];
  const topIndustrial = ["GUIMARÃES", "VILA NOVA DE FAMALICÃO", "SANTO TIRSO", "MARINHA GRANDE", "LEIRIA", "OVAR", "ÁGUEDA", "SÃO JOÃO DA MADEIRA", "SETÚBAL"];

  data.features.forEach((feat) => {
    feat.geometry.coordinates = roundCoords(feat.geometry.coordinates);

    const name = (feat.properties.Concelho || feat.properties.MUNICIPIO || "Desconhecido").trim();
    const district = (feat.properties.Distrito || feat.properties.ILHA || feat.properties.Ilha_1 || "OUTRO").trim();
    const id = (feat.properties.DICO || feat.properties.Codigo || "0000").toString().padStart(4, "0");

    const rng = seedRandom(id + name);

    const isTopService = topServices.some((s) => name.toUpperCase().includes(s));
    const isTopInd = topIndustrial.some((s) => name.toUpperCase().includes(s));

    let pop = Math.round(15000 + rng() * 65000);
    if (name.toUpperCase() === "LISBOA") pop = 545000;
    else if (name.toUpperCase() === "PORTO") pop = 231000;
    else if (name.toUpperCase() === "VILA NOVA DE GAIA") pop = 304000;
    else if (name.toUpperCase() === "SINTRA") pop = 385000;
    else if (name.toUpperCase() === "BRAGA") pop = 193000;

    let densidadeEmp = 60 + Math.round(rng() * 45); // base 60 - 105
    let poderCompra = 75 + Math.round(rng() * 30);
    let taxaNasc = 8.5 + Math.round(rng() * 40) / 10;

    if (isTopService) {
      densidadeEmp = Math.round(115 + rng() * 45); // 115 - 160
      poderCompra = Math.round(120 + rng() * 65);
      taxaNasc = Math.round((12.5 + rng() * 4) * 10) / 10;
    } else if (isTopInd) {
      densidadeEmp = Math.round(95 + rng() * 35);
      poderCompra = Math.round(95 + rng() * 25);
      taxaNasc = Math.round((9.8 + rng() * 3) * 10) / 10;
    }

    const totalEmpresas = Math.round((pop * densidadeEmp) / 1000);

    feat.properties = {
      id_municipio: id,
      nome_municipio: name,
      distrito: district,
      densidade_empresas: densidadeEmp,
      taxa_nascimento: taxaNasc,
      poder_compra: poderCompra,
      total_empresas: totalEmpresas,
      populacao: pop,
    };
  });

  const outPath = path.join(DATA_DIR, "portugal-municipios.geojson");
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`Saved municipalities to ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

async function prepareParishes() {
  console.log("Fetching Continente Freguesias...");
  const res = await fetch("https://raw.githubusercontent.com/nmota/caop_GeoJSON/master/ContinenteFreguesias.geojson");
  const data = await res.json();

  console.log(`Processing ${data.features.length} parishes...`);

  const topServices = ["LISBOA", "PORTO", "OEIRAS", "CASCAIS", "COIMBRA", "BRAGA", "AVEIRO", "FARO"];
  const topIndustrial = ["GUIMARÃES", "FAMALICÃO", "SANTO TIRSO", "MARINHA GRANDE", "LEIRIA", "OVAR", "ÁGUEDA"];

  data.features.forEach((feat) => {
    feat.geometry.coordinates = roundCoords(feat.geometry.coordinates);

    const id = (feat.properties.Dicofre || "000000").toString().padStart(6, "0");
    const name = (feat.properties.Freguesia || feat.properties.Des_Simpli || "Freguesia").trim();
    const concelho = (feat.properties.Concelho || "Concelho").trim();
    const distrito = (feat.properties.Distrito || "Distrito").trim();
    const munId = id.slice(0, 4);

    const rng = seedRandom(id + name);

    const isTopService = topServices.some((s) => concelho.toUpperCase().includes(s));
    const isTopInd = topIndustrial.some((s) => concelho.toUpperCase().includes(s));

    let pctServicos = 40 + Math.round(rng() * 25);
    let pctIndustria = 20 + Math.round(rng() * 20);
    let pctEmpregadores = Math.round((3.5 + rng() * 4.5) * 10) / 10;
    let pctIndependentes = Math.round((9 + rng() * 9) * 10) / 10;
    let taxaAtividade = Math.round((45 + rng() * 12) * 10) / 10;
    let popAtiva = Math.round(800 + rng() * 8500);

    if (isTopService) {
      pctServicos = Math.round(68 + rng() * 24); // 68 - 92%
      pctIndustria = Math.round(5 + rng() * 12);
      pctEmpregadores = Math.round((7.5 + rng() * 6.5) * 10) / 10;
      taxaAtividade = Math.round((52 + rng() * 9) * 10) / 10;
      popAtiva = Math.round(2500 + rng() * 22000);
    } else if (isTopInd) {
      pctIndustria = Math.round(38 + rng() * 24); // 38 - 62%
      pctServicos = Math.round(30 + rng() * 18);
      pctEmpregadores = Math.round((5.0 + rng() * 5.0) * 10) / 10;
    }

    feat.properties = {
      id_freguesia: id,
      nome_freguesia: name,
      id_municipio: munId,
      nome_municipio: concelho,
      distrito: distrito,
      pct_empregadores: pctEmpregadores,
      pct_trabalhadores_independentes: pctIndependentes,
      pct_servicos: pctServicos,
      pct_industria: pctIndustria,
      pop_ativa: popAtiva,
      taxa_atividade: taxaAtividade,
    };
  });

  const outPath = path.join(DATA_DIR, "portugal-freguesias.geojson");
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`Saved parishes to ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

async function run() {
  await prepareMunicipalities();
  await prepareParishes();
  console.log("Data preparation complete!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
