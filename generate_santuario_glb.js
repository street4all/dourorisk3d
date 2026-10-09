import fs from "fs";

// Helper to build boxes / roofs / pyramids with normals and vertex colors / materials
class GLBBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.materials = [];
    this.primitives = [];
  }

  addMaterial(name, baseColor) {
    const id = this.materials.length;
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: baseColor,
        metallicFactor: 0.05,
        roughnessFactor: 0.85,
      },
    });
    return id;
  }

  // Add box mesh
  addBox(cx, cy, cz, sx, sy, sz, matId) {
    const startIndex = this.positions.length / 3;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;

    // 24 vertices for 6 distinct faces (for sharp normals)
    const faces = [
      // Front (+Z)
      { normal: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      // Back (-Z)
      { normal: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
      // Top (+Y)
      { normal: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      // Bottom (-Y)
      { normal: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      // Right (+X)
      { normal: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      // Left (-X)
      { normal: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    ];

    const primIndices = [];
    let vertCount = 0;

    for (const f of faces) {
      const baseV = startIndex + vertCount;
      for (const c of f.corners) {
        this.positions.push(cx + c[0], cy + c[1], cz + c[2]);
        this.normals.push(f.normal[0], f.normal[1], f.normal[2]);
        vertCount++;
      }
      // Two triangles per face
      primIndices.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
    }

    this.primitives.push({
      material: matId,
      indexStart: this.indices.length,
      indexCount: primIndices.length,
    });
    this.indices.push(...primIndices);
  }

  // Add 2-pitch triangular gabled roof
  addGabledRoof(cx, cy, cz, sx, sy, sz, matId) {
    const startIndex = this.positions.length / 3;
    const hx = sx / 2, hz = sz / 2;

    // Triangular prism along Z axis
    // Base at cy - sy/2, ridge at cy + sy/2 along Z
    const primIndices = [];
    let vertCount = 0;

    // Sloped Left (+X to center)
    const addTriFace = (p0, p1, p2, p3, norm) => {
      const baseV = startIndex + vertCount;
      this.positions.push(...p0, ...p1, ...p2, ...p3);
      this.normals.push(...norm, ...norm, ...norm, ...norm);
      vertCount += 4;
      primIndices.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
    };

    const yBase = cy - sy / 2;
    const yTop = cy + sy / 2;

    // Left slope (-X)
    addTriFace(
      [cx - hx, yBase, cz + hz],
      [cx, yTop, cz + hz],
      [cx, yTop, cz - hz],
      [cx - hx, yBase, cz - hz],
      [-0.7, 0.7, 0]
    );

    // Right slope (+X)
    addTriFace(
      [cx, yTop, cz + hz],
      [cx + hx, yBase, cz + hz],
      [cx + hx, yBase, cz - hz],
      [cx, yTop, cz - hz],
      [0.7, 0.7, 0]
    );

    // Front gable triangle (+Z)
    const baseVFront = startIndex + vertCount;
    this.positions.push(cx - hx, yBase, cz + hz, cx + hx, yBase, cz + hz, cx, yTop, cz + hz);
    this.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    vertCount += 3;
    primIndices.push(baseVFront, baseVFront + 1, baseVFront + 2);

    // Back gable triangle (-Z)
    const baseVBack = startIndex + vertCount;
    this.positions.push(cx + hx, yBase, cz - hz, cx - hx, yBase, cz - hz, cx, yTop, cz - hz);
    this.normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
    vertCount += 3;
    primIndices.push(baseVBack, baseVBack + 1, baseVBack + 2);

    this.primitives.push({
      material: matId,
      indexStart: this.indices.length,
      indexCount: primIndices.length,
    });
    this.indices.push(...primIndices);
  }

  // Add 4-sided pyramid (spire / coruchéu)
  addPyramid(cx, cy, cz, baseSize, height, matId) {
    const startIndex = this.positions.length / 3;
    const hs = baseSize / 2;
    const yBase = cy;
    const yApex = cy + height;

    const primIndices = [];
    let vertCount = 0;

    const addSide = (p0, p1, norm) => {
      const baseV = startIndex + vertCount;
      this.positions.push(p0[0], yBase, p0[1], p1[0], yBase, p1[1], cx, yApex, cz);
      this.normals.push(...norm, ...norm, ...norm);
      vertCount += 3;
      primIndices.push(baseV, baseV + 1, baseV + 2);
    };

    // 4 sides
    addSide([cx - hs, cz + hs], [cx + hs, cz + hs], [0, 0.5, 0.8]);
    addSide([cx + hs, cz + hs], [cx + hs, cz - hs], [0.8, 0.5, 0]);
    addSide([cx + hs, cz - hs], [cx - hs, cz - hs], [0, 0.5, -0.8]);
    addSide([cx - hs, cz - hs], [cx - hs, cz + hs], [-0.8, 0.5, 0]);

    this.primitives.push({
      material: matId,
      indexStart: this.indices.length,
      indexCount: primIndices.length,
    });
    this.indices.push(...primIndices);
  }

  buildGLB() {
    const posF32 = new Float32Array(this.positions);
    const normF32 = new Float32Array(this.normals);
    const indU16 = new Uint16Array(this.indices);

    // Compute bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.positions.length; i += 3) {
      minX = Math.min(minX, this.positions[i]);
      maxX = Math.max(maxX, this.positions[i]);
      minY = Math.min(minY, this.positions[i + 1]);
      maxY = Math.max(maxY, this.positions[i + 1]);
      minZ = Math.min(minZ, this.positions[i + 2]);
      maxZ = Math.max(maxZ, this.positions[i + 2]);
    }

    const posBytes = Buffer.from(posF32.buffer);
    const normBytes = Buffer.from(normF32.buffer);
    const indBytes = Buffer.from(indU16.buffer);

    const binBuffer = Buffer.concat([posBytes, normBytes, indBytes]);
    const padLen = (4 - (binBuffer.length % 4)) % 4;
    const binPadded = Buffer.concat([binBuffer, Buffer.alloc(padLen)]);

    const posOffset = 0;
    const normOffset = posBytes.length;
    const indOffset = posBytes.length + normBytes.length;

    const gltfPrimitives = this.primitives.map((p, idx) => ({
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2 + idx,
      material: p.material,
      mode: 4,
    }));

    const accessors = [
      // 0: POSITION
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: posF32.length / 3,
        type: "VEC3",
        max: [maxX, maxY, maxZ],
        min: [minX, minY, minZ],
      },
      // 1: NORMAL
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: normF32.length / 3,
        type: "VEC3",
      },
      // 2+: INDICES for each primitive
      ...this.primitives.map((p) => ({
        bufferView: 2,
        byteOffset: p.indexStart * 2,
        componentType: 5123,
        count: p.indexCount,
        type: "SCALAR",
      })),
    ];

    const gltf = {
      asset: { version: "2.0", generator: "SanfinsDoDouroArchitecturalModel" },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: gltfPrimitives }],
      materials: this.materials,
      buffers: [{ byteLength: binPadded.length }],
      bufferViews: [
        { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
        { buffer: 0, byteOffset: normOffset, byteLength: normBytes.length, target: 34962 },
        { buffer: 0, byteOffset: indOffset, byteLength: indBytes.length, target: 34963 },
      ],
      accessors,
    };

    const jsonStr = JSON.stringify(gltf);
    const jsonBuf = Buffer.from(jsonStr);
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

    const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);          // version 2
    header.writeUInt32LE(totalLen, 8);

    const c0 = Buffer.alloc(8);
    c0.writeUInt32LE(jsonPadded.length, 0);
    c0.writeUInt32LE(0x4E4F534A, 4);     // 'JSON'

    const c1 = Buffer.alloc(8);
    c1.writeUInt32LE(binPadded.length, 0);
    c1.writeUInt32LE(0x004E4942, 4);     // 'BIN\0'

    return Buffer.concat([header, c0, jsonPadded, c1, binPadded]);
  }
}

function buildSantuarioModel() {
  const b = new GLBBuilder();

  // Authentic Portuguese regional materials based on user's photo
  const matGranito = b.addMaterial("CantariaGranito", [0.82, 0.77, 0.70, 1.0]);    // Escadarias e pilastras
  const matFachada = b.addMaterial("FachadaCaiada", [0.96, 0.94, 0.91, 1.0]);      // Fachada branca com azulejos
  const matTelha = b.addMaterial("TelhaCeramica", [0.72, 0.28, 0.16, 1.0]);        // Telha lusa tradicional duriense
  const matPorta = b.addMaterial("PortaVerdeDouro", [0.08, 0.22, 0.12, 1.0]);      // Portão verde clássico
  const matSino = b.addMaterial("SinoBronze", [0.65, 0.55, 0.35, 1.0]);             // Sino de bronze
  const matSolar = b.addMaterial("SolarGranitoRustico", [0.68, 0.62, 0.55, 1.0]);  // Casa senhorial esquerda
  const matPedestal = b.addMaterial("PedestaisPinaculos", [0.75, 0.70, 0.62, 1.0]);// Pináculos e relógio

  // 1. ESCADARIA MONUMENTAL FRONTAL (como na foto)
  // Três grandes patamares de escadas de cantaria
  b.addBox(0, 0.4, 18, 28, 0.8, 14, matGranito);
  b.addBox(0, 1.1, 14, 24, 0.8, 10, matGranito);
  b.addBox(0, 1.8, 10, 20, 0.8, 6, matGranito);
  // Adro superior em frente à igreja
  b.addBox(0, 2.3, 5, 26, 0.4, 8, matGranito);

  // 2. CORPO PRINCIPAL DA IGREJA (Nave)
  const churchZ = -6; // center of nave
  const naveW = 11, naveL = 18, naveH = 9.5;
  const churchFloorY = 2.5;
  const naveCenterY = churchFloorY + naveH / 2;

  // Nave lateral walls
  b.addBox(0, naveCenterY, churchZ, naveW, naveH, naveL, matFachada);

  // Telhado cerâmico de 2 águas da nave
  const roofRidgeH = 3.8;
  const roofCenterY = churchFloorY + naveH + roofRidgeH / 2;
  b.addGabledRoof(0, roofCenterY, churchZ, naveW + 0.8, roofRidgeH, naveL + 0.6, matTelha);

  // 3. FACHADA PRINCIPAL BARROCA (Virada para +Z / escadaria)
  const facadeZ = churchZ + naveL / 2 + 0.2;

  // Frontão triangular barroco no topo da fachada
  const pedimentY = churchFloorY + naveH + 1.6;
  b.addBox(0, pedimentY, facadeZ, naveW, 3.2, 0.5, matFachada);
  // Moldura de cantaria do frontão
  b.addBox(0, pedimentY + 1.6, facadeZ + 0.1, naveW + 0.4, 0.4, 0.6, matGranito);

  // Portal principal de granito com verga
  b.addBox(0, churchFloorY + 2.2, facadeZ + 0.25, 2.4, 3.8, 0.3, matGranito);
  // Porta verde escura
  b.addBox(0, churchFloorY + 2.0, facadeZ + 0.35, 1.8, 3.2, 0.1, matPorta);

  // Nicho central com estátua (como na foto)
  b.addBox(0, churchFloorY + 5.5, facadeZ + 0.25, 1.2, 1.8, 0.3, matGranito);

  // Relógio / medalhão de granito no frontão
  b.addBox(0, churchFloorY + 8.5, facadeZ + 0.25, 1.5, 1.5, 0.3, matPedestal);

  // Dois pináculos nos cantos do frontão (como na foto)
  b.addBox(-naveW / 2 + 0.4, pedimentY + 2.6, facadeZ, 0.7, 1.6, 0.7, matPedestal);
  b.addPyramid(-naveW / 2 + 0.4, pedimentY + 3.4, facadeZ, 0.7, 1.0, matPedestal);

  b.addBox(naveW / 2 - 0.4, pedimentY + 2.6, facadeZ, 0.7, 1.6, 0.7, matPedestal);
  b.addPyramid(naveW / 2 - 0.4, pedimentY + 3.4, facadeZ, 0.7, 1.0, matPedestal);

  // 4. TORRE SINEIRA CENTRAL / CAMPANÁRIO (Elemento icónico no centro)
  const towerW = 4.0, towerD = 3.8;
  const towerBaseY = churchFloorY + naveH + 2.0;

  // 1º Piso da torre (corpo fechado)
  b.addBox(0, towerBaseY + 2.0, facadeZ - 0.5, towerW, 4.0, towerD, matGranito);

  // 2º Piso da torre: Sineira com arco vazado (como na foto)
  // Pilares laterais
  const belfryY = towerBaseY + 5.5;
  b.addBox(-1.4, belfryY, facadeZ - 0.5, 1.0, 3.2, towerD, matGranito);
  b.addBox(1.4, belfryY, facadeZ - 0.5, 1.0, 3.2, towerD, matGranito);
  b.addBox(0, belfryY + 1.4, facadeZ - 0.5, towerW, 0.6, towerD, matGranito);

  // Sino de bronze no centro da sineira
  b.addBox(0, belfryY + 0.2, facadeZ - 0.5, 0.9, 1.2, 0.9, matSino);

  // Coruchéu piramidal branco com relógio/cruzeta
  const spireBaseY = belfryY + 1.8;
  b.addPyramid(0, spireBaseY, facadeZ - 0.5, 3.6, 4.8, matFachada);

  // Haste do catavento e cruz no cume (altura total ~23m)
  b.addBox(0, spireBaseY + 5.5, facadeZ - 0.5, 0.15, 1.8, 0.15, matSino);
  b.addBox(0, spireBaseY + 6.0, facadeZ - 0.5, 0.8, 0.15, 0.15, matSino);

  // 5. SOLAR HISTÓRICO EM CANTARIA À ESQUERDA (Visível na foto, lado Norte)
  const solarX = -13.5;
  const solarW = 13.0, solarL = 16.0, solarH = 8.5;
  const solarY = churchFloorY + solarH / 2;
  b.addBox(solarX, solarY, churchZ + 2, solarW, solarH, solarL, matSolar);

  // Telhado a 4 águas de telha lusa do solar
  const solarRoofH = 3.2;
  b.addGabledRoof(solarX, churchFloorY + solarH + solarRoofH / 2, churchZ + 2, solarW + 0.8, solarRoofH, solarL + 0.6, matTelha);

  // Janelas e varandas de sacada do solar
  for (let winIdx = -1; winIdx <= 1; winIdx++) {
    b.addBox(solarX + winIdx * 3.8, churchFloorY + 5.5, churchZ + 2 + solarL / 2 + 0.1, 1.4, 2.2, 0.2, matPorta);
    b.addBox(solarX + winIdx * 3.8, churchFloorY + 2.0, churchZ + 2 + solarL / 2 + 0.1, 1.4, 2.2, 0.2, matPorta);
  }

  // 6. ANEXO BAIXO À DIREITA (Visível na foto, lado Sul)
  const anexoX = 8.5;
  const anexoW = 5.5, anexoL = 9.0, anexoH = 4.2;
  b.addBox(anexoX, churchFloorY + anexoH / 2, churchZ + 4, anexoW, anexoH, anexoL, matFachada);
  b.addGabledRoof(anexoX, churchFloorY + anexoH + 1.2, churchZ + 4, anexoW + 0.6, 2.0, anexoL + 0.4, matTelha);

  const glb = b.buildGLB();
  if (!fs.existsSync("public/models")) fs.mkdirSync("public/models", { recursive: true });
  fs.writeFileSync("public/models/santuario_sanfins.glb", glb);
  console.log(`Modelo 3D Santuário gerado com sucesso em public/models/santuario_sanfins.glb (${glb.length} bytes)`);
}

buildSantuarioModel();
