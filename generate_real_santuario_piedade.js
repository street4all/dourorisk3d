import fs from "fs";

class GLBBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
    this.materials = [];
    this.primitives = [];
  }

  addMaterial(name, baseColor, metallic = 0.04, roughness = 0.85) {
    const id = this.materials.length;
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: baseColor,
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
      doubleSided: true,
    });
    return id;
  }

  // Add Quad Face (CCW winding from outside)
  addQuad(p0, p1, p2, p3, norm, matId) {
    const startIndex = this.positions.length / 3;
    this.positions.push(...p0, ...p1, ...p2, ...p3);
    this.normals.push(...norm, ...norm, ...norm, ...norm);
    
    // Counter-clockwise triangles
    const primIndices = [
      startIndex, startIndex + 1, startIndex + 2,
      startIndex, startIndex + 2, startIndex + 3
    ];

    this.primitives.push({
      material: matId,
      indexStart: this.indices.length,
      indexCount: 6,
    });
    this.indices.push(...primIndices);
  }

  // Add Axis-Aligned Box with solid CCW faces
  addBox(cx, cy, cz, sx, sy, sz, matId) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces = [
      // Front (+Z)
      { n: [0, 0, 1], p: [[cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz]] },
      // Back (-Z)
      { n: [0, 0, -1], p: [[cx + hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz - hz], [cx - hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz - hz]] },
      // Top (+Y)
      { n: [0, 1, 0], p: [[cx - hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz]] },
      // Bottom (-Y)
      { n: [0, -1, 0], p: [[cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy - hy, cz + hz]] },
      // Right (+X)
      { n: [1, 0, 0], p: [[cx + hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz + hz]] },
      // Left (-X)
      { n: [-1, 0, 0], p: [[cx - hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz + hz], [cx - hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz - hz]] },
    ];
    for (const f of faces) {
      this.addQuad(f.p[0], f.p[1], f.p[2], f.p[3], f.n, matId);
    }
  }

  // Add Regular Polygon Prism with outwards facing CCW normals
  addPrism(cx, cy, cz, radius, height, sides, matId, rotOffset = 0) {
    const y0 = cy - height / 2;
    const y1 = cy + height / 2;
    const step = (Math.PI * 2) / sides;

    for (let i = 0; i < sides; i++) {
      const a0 = i * step + rotOffset;
      const a1 = (i + 1) * step + rotOffset;
      const x0 = cx + radius * Math.cos(a0);
      const z0 = cz + radius * Math.sin(a0);
      const x1 = cx + radius * Math.cos(a1);
      const z1 = cz + radius * Math.sin(a1);

      const am = (a0 + a1) / 2;
      const nx = Math.cos(am);
      const nz = Math.sin(am);

      // CCW from outside: bottom-left (p1) -> bottom-right (p0) -> top-right (p3) -> top-left (p2)
      this.addQuad([x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [nx, 0, nz], matId);
    }
  }

  // Add Stepped Conical Dome with concentric tiers of dressed granite
  addSteppedDome(cx, cyBase, cz, baseRadius, height, tiers, sides, matId, rotOffset = 0) {
    const step = (Math.PI * 2) / sides;
    const tierH = height / tiers;

    for (let t = 0; t < tiers; t++) {
      const u0 = t / tiers;
      const u1 = (t + 1) / tiers;
      // Parabolic conical taper matching user's photographs
      const r0 = baseRadius * Math.pow(1 - u0, 0.76);
      const r1 = baseRadius * Math.pow(1 - u1, 0.76);
      const y0 = cyBase + t * tierH;
      const y1 = cyBase + (t + 1) * tierH;

      for (let i = 0; i < sides; i++) {
        const a0 = i * step + rotOffset;
        const a1 = (i + 1) * step + rotOffset;
        const am = (a0 + a1) / 2;
        const nx = Math.cos(am);
        const nz = Math.sin(am);

        const p00 = [cx + r0 * Math.cos(a0), y0, cz + r0 * Math.sin(a0)];
        const p01 = [cx + r0 * Math.cos(a1), y0, cz + r0 * Math.sin(a1)];
        const p11 = [cx + r1 * Math.cos(a1), y1, cz + r1 * Math.sin(a1)];
        const p10 = [cx + r1 * Math.cos(a0), y1, cz + r1 * Math.sin(a0)];

        const slantNorm = [nx * 0.7, 0.7, nz * 0.7];
        // CCW quad: p01 -> p00 -> p10 -> p11
        this.addQuad(p01, p00, p10, p11, slantNorm, matId);
      }
    }
  }

  buildGLB() {
    const posF32 = new Float32Array(this.positions);
    const normF32 = new Float32Array(this.normals);
    const indU16 = new Uint16Array(this.indices);

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
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: posF32.length / 3,
        type: "VEC3",
        max: [maxX, maxY, maxZ],
        min: [minX, minY, minZ],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: normF32.length / 3,
        type: "VEC3",
      },
      ...this.primitives.map((p) => ({
        bufferView: 2,
        byteOffset: p.indexStart * 2,
        componentType: 5123,
        count: p.indexCount,
        type: "SCALAR",
      })),
    ];

    const gltf = {
      asset: { version: "2.0", generator: "SantuarioNossaSenhoraDaPiedade" },
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

function buildRealSantuarioPiedadeModel() {
  const b = new GLBBuilder();

  // Color palette tuned to high-res photographs
  const matGranito = b.addMaterial("CantariaGranito", [0.78, 0.72, 0.63, 1.0], 0.04, 0.82);   // Pilastras, soco e cornijas
  const matCupula = b.addMaterial("CupulaGranitoEscalonada", [0.74, 0.68, 0.59, 1.0], 0.04, 0.86); // Cúpula cónica escalonada
  const matParedes = b.addMaterial("RebocoBranco", [0.97, 0.97, 0.96, 1.0], 0.01, 0.70);      // Panos de parede rebocados e caiados a branco
  const matPortaMadeira = b.addMaterial("PortaNobreMadeira", [0.22, 0.12, 0.07, 1.0], 0.06, 0.72); // Madeira nobre da porta
  const matSinoFerro = b.addMaterial("SinoBronzeFerro", [0.45, 0.38, 0.28, 1.0], 0.60, 0.40); // Sino e cruz de ferro
  const matPinaculos = b.addMaterial("PinaculosEsferas", [0.80, 0.74, 0.65, 1.0], 0.05, 0.80); // Esferas e urnas barrocas nos vértices

  const radius = 4.8;       // Raio do octógono (~9.6m largura total)
  const sides = 8;
  const rotOffset = Math.PI / 8; // Face principal perfeitamente virada a Sul (+Z)
  const wallH = 6.0;        // Altura das paredes
  const socoH = 1.2;        // Soco de cantaria (com profundidade para terreno em declive)

  // 1. FUNDAÇÃO / SOCO INFERIOR DE CANTARIA (estende-se ligeiramente abaixo do solo para assentar no relevo)
  b.addPrism(0, 0.2, 0, radius + 0.15, socoH, sides, matGranito, rotOffset);

  // 2. CORPO OCTOGONAL COM PANOS DE PAREDE BRANCOS
  const wallCenterY = 0.8 + (wallH - 0.8) / 2;
  b.addPrism(0, wallCenterY, 0, radius, wallH - 0.8, sides, matParedes, rotOffset);

  // 3. CUNHAIS / PILASTRAS DE CANTARIA NOS 8 VÉRTICES
  const step = (Math.PI * 2) / sides;
  for (let i = 0; i < sides; i++) {
    const a = i * step + rotOffset;
    const px = radius * Math.cos(a);
    const pz = radius * Math.sin(a);
    b.addBox(px, wallCenterY, pz, 0.78, wallH - 0.8, 0.78, matGranito);
  }

  // 4. CORNIJA SUPERIOR OCTOGONAL EM GRANITO
  const corniceY = wallH + 0.15;
  b.addPrism(0, corniceY, 0, radius + 0.35, 0.4, sides, matGranito, rotOffset);

  // 5. PINÁCULOS / ESFERAS DE CANTARIA NOS 8 CANTOS DA CORNIJA
  for (let i = 0; i < sides; i++) {
    const a = i * step + rotOffset;
    const px = (radius + 0.25) * Math.cos(a);
    const pz = (radius + 0.25) * Math.sin(a);
    b.addBox(px, corniceY + 0.35, pz, 0.45, 0.35, 0.45, matGranito);
    b.addBox(px, corniceY + 0.7, pz, 0.38, 0.45, 0.38, matPinaculos);
  }

  // 6. CÚPULA CÓNICA ESCALONADA DE CANTARIA
  const domeH = 8.2;
  const domeBaseY = corniceY + 0.2;
  b.addSteppedDome(0, domeBaseY, 0, radius + 0.12, domeH, 16, 16, matCupula, rotOffset);

  // Remate no topo da cúpula: pináculo cónico e cruz de ferro
  const apexY = domeBaseY + domeH;
  b.addBox(0, apexY + 0.4, 0, 0.6, 0.8, 0.6, matGranito);
  b.addBox(0, apexY + 0.9, 0, 0.45, 0.45, 0.45, matPinaculos);
  b.addBox(0, apexY + 1.45, 0, 0.12, 0.8, 0.12, matSinoFerro);
  b.addBox(0, apexY + 1.6, 0, 0.5, 0.12, 0.12, matSinoFerro);

  // 7. FACHADA PRINCIPAL (Face virada para +Z)
  const facadeZ = radius * Math.cos(rotOffset);

  // Portal em cantaria lavrada
  const portalY = 2.0;
  b.addBox(0, portalY, facadeZ + 0.15, 2.4, 3.6, 0.3, matGranito);
  // Porta de madeira nobre de dois batentes
  b.addBox(0, portalY - 0.2, facadeZ + 0.26, 1.85, 3.1, 0.1, matPortaMadeira);

  // Nicho superior barroco com volutas e imagem (Santa Bárbara)
  const nicheY = portalY + 2.5;
  b.addBox(0, nicheY, facadeZ + 0.15, 1.5, 1.7, 0.3, matGranito);
  b.addBox(-0.95, nicheY, facadeZ + 0.12, 0.4, 0.9, 0.2, matGranito);
  b.addBox(0.95, nicheY, facadeZ + 0.12, 0.4, 0.9, 0.2, matGranito);

  // 8. ARCO DE SINEIRA MONUMENTAL SOBRE A ENTRADA
  const belfryY = corniceY + 1.4;
  b.addBox(-0.7, belfryY, facadeZ + 0.05, 0.35, 1.8, 0.35, matGranito);
  b.addBox(0.7, belfryY, facadeZ + 0.05, 0.35, 1.8, 0.35, matGranito);
  b.addBox(0, belfryY + 0.95, facadeZ + 0.05, 1.75, 0.35, 0.35, matGranito);
  b.addBox(0, belfryY + 1.35, facadeZ + 0.05, 0.08, 0.5, 0.08, matSinoFerro);
  b.addBox(0, belfryY + 1.45, facadeZ + 0.05, 0.35, 0.08, 0.08, matSinoFerro);
  b.addBox(0, belfryY + 0.3, facadeZ + 0.05, 0.5, 0.7, 0.5, matSinoFerro);

  // 9. ESCADARIA FRONTAL DE CANTARIA COM OS DOIS PILARES MONUMENTAIS
  for (let s = 1; s <= 5; s++) {
    b.addBox(0, 0.25 - s * 0.18, facadeZ + 1.5 + s * 0.8, 5.5 - s * 0.2, 0.22, 0.9, matGranito);
  }
  const pillarZ = facadeZ + 5.5;
  b.addBox(-3.4, 1.4, pillarZ, 0.85, 2.6, 0.85, matGranito);
  b.addBox(-3.4, 2.9, pillarZ, 0.55, 0.55, 0.55, matPinaculos);
  b.addBox(3.4, 1.4, pillarZ, 0.85, 2.6, 0.85, matGranito);
  b.addBox(3.4, 2.9, pillarZ, 0.55, 0.55, 0.55, matPinaculos);

  const glb = b.buildGLB();
  if (!fs.existsSync("public/models")) fs.mkdirSync("public/models", { recursive: true });
  fs.writeFileSync("public/models/santuario_monte.glb", glb);
  console.log(`Modelo 3D Real do Santuário de N.ª Sr.ª da Piedade gerado em public/models/santuario_monte.glb (${glb.length} bytes)`);
}

buildRealSantuarioPiedadeModel();
