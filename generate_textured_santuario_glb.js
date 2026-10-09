import fs from "fs";

// Helper class to construct a complete glTF 2.0 Binary (.GLB) with UV textures and PBR
class TexturedGLBBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
    this.textureBuffer = null;
  }

  setTexture(buffer) {
    this.textureBuffer = buffer;
  }

  // Add a 3D box with custom UV mapping per face
  // uvMap: { front, back, top, bottom, left, right } where each is [uMin, vMin, uMax, vMax]
  addBox(cx, cy, cz, sx, sy, sz, uvMap) {
    const startIndex = this.positions.length / 3;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;

    const defaultUV = [0.5, 0.5, 1.0, 1.0]; // granite
    const fUV = uvMap.front || defaultUV;
    const bUV = uvMap.back || defaultUV;
    const tUV = uvMap.top || defaultUV;
    const btUV = uvMap.bottom || defaultUV;
    const rUV = uvMap.right || defaultUV;
    const lUV = uvMap.left || defaultUV;

    const faces = [
      // Front (+Z)
      { normal: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], uv: fUV },
      // Back (-Z)
      { normal: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], uv: bUV },
      // Top (+Y)
      { normal: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], uv: tUV },
      // Bottom (-Y)
      { normal: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], uv: btUV },
      // Right (+X)
      { normal: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], uv: rUV },
      // Left (-X)
      { normal: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], uv: lUV },
    ];

    let vertCount = 0;
    const primIndices = [];

    for (const f of faces) {
      const baseV = startIndex + vertCount;
      const [u0, v0, u1, v1] = f.uv;
      const cornerUVs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];

      for (let i = 0; i < 4; i++) {
        const c = f.corners[i];
        const uv = cornerUVs[i];
        this.positions.push(cx + c[0], cy + c[1], cz + c[2]);
        this.normals.push(f.normal[0], f.normal[1], f.normal[2]);
        this.uvs.push(uv[0], uv[1]);
        vertCount++;
      }

      primIndices.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
    }

    this.indices.push(...primIndices);
  }

  // Add 2-pitch gabled roof
  addGabledRoof(cx, cy, cz, sx, sy, sz, uvRect) {
    const startIndex = this.positions.length / 3;
    const hx = sx / 2, hz = sz / 2;
    const yBase = cy - sy / 2;
    const yRidge = cy + sy / 2;
    const [u0, v0, u1, v1] = uvRect;

    const primIndices = [];
    let vertCount = 0;

    const addQuad = (p0, p1, p2, p3, norm) => {
      const baseV = startIndex + vertCount;
      this.positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
      this.normals.push(...norm, ...norm, ...norm, ...norm);
      this.uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
      vertCount += 4;
      primIndices.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
    };

    // Right Slope (+X)
    addQuad(
      [cx, yRidge, cz + hz],
      [cx + hx, yBase, cz + hz],
      [cx + hx, yBase, cz - hz],
      [cx, yRidge, cz - hz],
      [0.707, 0.707, 0]
    );

    // Left Slope (-X)
    addQuad(
      [cx - hx, yBase, cz + hz],
      [cx, yRidge, cz + hz],
      [cx, yRidge, cz - hz],
      [cx - hx, yBase, cz - hz],
      [-0.707, 0.707, 0]
    );

    // Front Gable (+Z)
    const baseV = startIndex + vertCount;
    this.positions.push(
      cx - hx, yBase, cz + hz,
      cx + hx, yBase, cz + hz,
      cx, yRidge, cz + hz
    );
    this.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    this.uvs.push(0.5, 1.0, 1.0, 1.0, 0.75, 0.5);
    vertCount += 3;
    primIndices.push(baseV, baseV + 1, baseV + 2);

    // Back Gable (-Z)
    const backV = startIndex + vertCount;
    this.positions.push(
      cx + hx, yBase, cz - hz,
      cx - hx, yBase, cz - hz,
      cx, yRidge, cz - hz
    );
    this.normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
    this.uvs.push(0.5, 1.0, 1.0, 1.0, 0.75, 0.5);
    vertCount += 3;
    primIndices.push(backV, backV + 1, backV + 2);

    this.indices.push(...primIndices);
  }

  // Add 4-sided pyramid for spire
  addPyramid(cx, cy, cz, baseSize, height, uvRect) {
    const startIndex = this.positions.length / 3;
    const hs = baseSize / 2;
    const yBase = cy;
    const yApex = cy + height;
    const [u0, v0, u1, v1] = uvRect;

    const primIndices = [];
    let vertCount = 0;

    const addSide = (p0, p1, norm) => {
      const baseV = startIndex + vertCount;
      this.positions.push(p0[0], yBase, p0[1], p1[0], yBase, p1[1], cx, yApex, cz);
      this.normals.push(...norm, ...norm, ...norm);
      this.uvs.push(u0, v1, u1, v1, (u0 + u1) / 2, v0);
      vertCount += 3;
      primIndices.push(baseV, baseV + 1, baseV + 2);
    };

    addSide([cx - hs, cz + hs], [cx + hs, cz + hs], [0, 0.5, 0.8]);
    addSide([cx + hs, cz + hs], [cx + hs, cz - hs], [0.8, 0.5, 0]);
    addSide([cx + hs, cz - hs], [cx - hs, cz - hs], [0, 0.5, -0.8]);
    addSide([cx - hs, cz - hs], [cx - hs, cz + hs], [-0.8, 0.5, 0]);

    this.indices.push(...primIndices);
  }

  buildGLB() {
    // 1. Calculate bounding box
    let rawMinX = Infinity, rawMinY = Infinity, rawMinZ = Infinity;
    let rawMaxX = -Infinity, rawMaxY = -Infinity, rawMaxZ = -Infinity;
    for (let i = 0; i < this.positions.length; i += 3) {
      rawMinX = Math.min(rawMinX, this.positions[i]);
      rawMaxX = Math.max(rawMaxX, this.positions[i]);
      rawMinY = Math.min(rawMinY, this.positions[i + 1]);
      rawMaxY = Math.max(rawMaxY, this.positions[i + 1]);
      rawMinZ = Math.min(rawMinZ, this.positions[i + 2]);
      rawMaxZ = Math.max(rawMaxZ, this.positions[i + 2]);
    }

    // 2. Automatically center model at (X=0, Z=0) and place ground at (Y=0)
    const centerX = (rawMinX + rawMaxX) / 2;
    const centerZ = (rawMinZ + rawMaxZ) / 2;
    const baseY = rawMinY;

    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] -= centerX;
      this.positions[i + 1] -= baseY;
      this.positions[i + 2] -= centerZ;
    }

    const minX = rawMinX - centerX, maxX = rawMaxX - centerX;
    const minY = 0, maxY = rawMaxY - baseY;
    const minZ = rawMinZ - centerZ, maxZ = rawMaxZ - centerZ;

    const posF32 = new Float32Array(this.positions);
    const normF32 = new Float32Array(this.normals);
    const uvF32 = new Float32Array(this.uvs);
    const indU16 = new Uint16Array(this.indices);

    const posBytes = Buffer.from(posF32.buffer);
    const normBytes = Buffer.from(normF32.buffer);
    const uvBytes = Buffer.from(uvF32.buffer);
    const indBytes = Buffer.from(indU16.buffer);

    // Padding helper to 4-byte alignment
    const pad = (buf) => {
      const rem = buf.length % 4;
      return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
    };

    const pPosBytes = pad(posBytes);
    const pNormBytes = pad(normBytes);
    const pUvBytes = pad(uvBytes);
    const pIndBytes = pad(indBytes);
    const pImgBytes = pad(this.textureBuffer);

    const posOffset = 0;
    const normOffset = posOffset + pPosBytes.length;
    const uvOffset = normOffset + pNormBytes.length;
    const indOffset = uvOffset + pUvBytes.length;
    const imgOffset = indOffset + pIndBytes.length;

    const binBuffer = Buffer.concat([pPosBytes, pNormBytes, pUvBytes, pIndBytes, pImgBytes]);

    const gltf = {
      asset: { version: "2.0", generator: "ArcGIS Douro PBR Textured Builder" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: "SantuarioSanfinsPBR" }],
      meshes: [
        {
          name: "SantuarioMesh",
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
              indices: 3,
              material: 0,
              mode: 4,
            },
          ],
        },
      ],
      materials: [
        {
          name: "SantuarioPBRMaterial",
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            metallicFactor: 0.05,
            roughnessFactor: 0.8,
          },
        },
      ],
      textures: [{ sampler: 0, source: 0 }],
      images: [{ bufferView: 4, mimeType: "image/jpeg", name: "SantuarioAtlas" }],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      accessors: [
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
        // 2: TEXCOORD_0
        {
          bufferView: 2,
          byteOffset: 0,
          componentType: 5126,
          count: uvF32.length / 2,
          type: "VEC2",
        },
        // 3: INDICES
        {
          bufferView: 3,
          byteOffset: 0,
          componentType: 5123,
          count: indU16.length,
          type: "SCALAR",
        },
      ],
      bufferViews: [
        // 0: POSITION
        { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
        // 1: NORMAL
        { buffer: 0, byteOffset: normOffset, byteLength: normBytes.length, target: 34962 },
        // 2: TEXCOORD_0
        { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes.length, target: 34962 },
        // 3: INDICES
        { buffer: 0, byteOffset: indOffset, byteLength: indBytes.length, target: 34963 },
        // 4: IMAGE (TEXTURE ATLAS)
        { buffer: 0, byteOffset: imgOffset, byteLength: this.textureBuffer.length },
      ],
      buffers: [{ byteLength: binBuffer.length }],
    };

    const jsonStr = JSON.stringify(gltf);
    let jsonBuf = Buffer.from(jsonStr, "utf8");
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

    const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuffer.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // "glTF"
    header.writeUInt32LE(2, 4);          // version 2
    header.writeUInt32LE(totalLen, 8);

    const jsonChunkHeader = Buffer.alloc(8);
    jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
    jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

    const binChunkHeader = Buffer.alloc(8);
    binChunkHeader.writeUInt32LE(binBuffer.length, 0);
    binChunkHeader.writeUInt32LE(0x004e4942, 4);  // "BIN\0"

    return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuffer]);
  }
}

// Generate the fully textured architectural GLB model of Santuário de Sanfins do Douro
async function generateTexturedChurch() {
  const b = new TexturedGLBBuilder();
  const atlasImg = fs.readFileSync("public/textures/santuario_atlas.jpg");
  b.setTexture(atlasImg);

  // UV Quadrants in Atlas (1024x1024):
  // Facade (Photo): [0.0, 0.0, 0.5, 0.5]
  // Solar (Manor):  [0.5, 0.0, 1.0, 0.5]
  // Tile Roof:      [0.0, 0.5, 0.5, 1.0]
  // Granite Stone:  [0.5, 0.5, 1.0, 1.0]

  const uvFacade = [0.0, 0.0, 0.5, 0.5];
  const uvSolar = [0.5, 0.0, 1.0, 0.5];
  const uvRoof = [0.0, 0.5, 0.5, 1.0];
  const uvGranite = [0.5, 0.5, 1.0, 1.0];

  // 1. MONUMENTAL 3-TIER GRANITE STAIRS & ADRO
  b.addBox(0, 0.4, 18, 28, 0.8, 14, { front: uvGranite, top: uvGranite, left: uvGranite, right: uvGranite });
  b.addBox(0, 1.1, 14, 24, 0.8, 10, { front: uvGranite, top: uvGranite, left: uvGranite, right: uvGranite });
  b.addBox(0, 1.8, 10, 20, 0.8, 6,  { front: uvGranite, top: uvGranite, left: uvGranite, right: uvGranite });
  // Upper Adro
  b.addBox(0, 2.3, 5, 26, 0.4, 8,   { front: uvGranite, top: uvGranite, left: uvGranite, right: uvGranite });

  // 2. MAIN CHURCH NAVE (Corpo da Igreja)
  const churchZ = -6;
  const naveW = 11, naveL = 18, naveH = 9.5;
  const churchFloorY = 2.5;
  const naveCenterY = churchFloorY + naveH / 2;

  // Lateral nave walls with granite stonework
  b.addBox(0, naveCenterY, churchZ, naveW, naveH, naveL, {
    front: uvGranite,
    back: uvGranite,
    left: uvGranite,
    right: uvGranite,
    top: uvRoof,
  });

  // Authentic Terracotta Tile Roof of the nave
  const roofRidgeH = 3.8;
  const roofCenterY = churchFloorY + naveH + roofRidgeH / 2;
  b.addGabledRoof(0, roofCenterY, churchZ, naveW + 0.8, roofRidgeH, naveL + 0.6, uvRoof);

  // 3. BAROQUE FRONT FACADE (Mapped with the authentic photographic texture!)
  const facadeZ = churchZ + naveL / 2 + 0.3;
  const facadeH = naveH + 3.2; // 12.7m
  const facadeCenterY = churchFloorY + facadeH / 2;

  // Central facade wall holding the photo
  b.addBox(0, facadeCenterY, facadeZ, naveW + 0.4, facadeH, 0.6, {
    front: uvFacade,   // Front face has the authentic church photo!
    back: uvGranite,
    top: uvGranite,
    left: uvGranite,
    right: uvGranite,
  });

  // Carved Granite Cornices & Pediment Frame
  b.addBox(0, churchFloorY + facadeH + 0.2, facadeZ + 0.1, naveW + 0.8, 0.4, 0.7, {
    front: uvGranite,
    top: uvGranite,
  });

  // Side Pinnacles on pediment
  b.addBox(-naveW / 2 + 0.3, churchFloorY + facadeH + 0.9, facadeZ, 0.6, 1.4, 0.6, { front: uvGranite });
  b.addPyramid(-naveW / 2 + 0.3, churchFloorY + facadeH + 1.6, facadeZ, 0.6, 1.0, uvGranite);

  b.addBox(naveW / 2 - 0.3, churchFloorY + facadeH + 0.9, facadeZ, 0.6, 1.4, 0.6, { front: uvGranite });
  b.addPyramid(naveW / 2 - 0.3, churchFloorY + facadeH + 1.6, facadeZ, 0.6, 1.0, uvGranite);

  // 4. CENTRAL BELL TOWER & SPIRE (Campanário e Sineira com Sino)
  const towerW = 4.2, towerD = 3.8;
  const towerBaseY = churchFloorY + facadeH;

  // Tower body
  b.addBox(0, towerBaseY + 2.0, facadeZ - 0.4, towerW, 4.0, towerD, {
    front: uvGranite,
    back: uvGranite,
    left: uvGranite,
    right: uvGranite,
  });

  // Arched Belfry (pillars with opening)
  const belfryY = towerBaseY + 5.5;
  b.addBox(-1.5, belfryY, facadeZ - 0.4, 0.9, 3.2, towerD, { front: uvGranite, right: uvGranite, left: uvGranite });
  b.addBox(1.5, belfryY, facadeZ - 0.4, 0.9, 3.2, towerD, { front: uvGranite, right: uvGranite, left: uvGranite });
  b.addBox(0, belfryY + 1.4, facadeZ - 0.4, towerW, 0.6, towerD, { front: uvGranite, bottom: uvGranite });

  // Bronze Bell inside belfry
  b.addBox(0, belfryY + 0.2, facadeZ - 0.4, 0.9, 1.2, 0.9, { front: [0.3, 0.4, 0.4, 0.5] });

  // White/Granite Pyramidal Spire
  const spireBaseY = belfryY + 1.8;
  b.addPyramid(0, spireBaseY, facadeZ - 0.4, 3.8, 5.0, uvGranite);

  // Iron cross and weather vane
  b.addBox(0, spireBaseY + 5.6, facadeZ - 0.4, 0.15, 1.6, 0.15, { front: uvGranite });
  b.addBox(0, spireBaseY + 6.1, facadeZ - 0.4, 0.7, 0.15, 0.15, { front: uvGranite });

  // 5. HISTORIC MANOR HOUSE (Solar em Granito à esquerda / Lado Norte)
  const solarX = -13.5;
  const solarW = 13.0, solarL = 16.0, solarH = 8.5;
  const solarY = churchFloorY + solarH / 2;

  // Front facade of solar holds the real manor house photo!
  b.addBox(solarX, solarY, churchZ + 2, solarW, solarH, solarL, {
    front: uvSolar,    // Authentic photo of the historic manor house!
    back: uvGranite,
    left: uvGranite,
    right: uvGranite,
    top: uvRoof,
  });

  // Hipped Terracotta Roof of the solar
  const solarRoofH = 3.2;
  b.addGabledRoof(solarX, churchFloorY + solarH + solarRoofH / 2, churchZ + 2, solarW + 0.8, solarRoofH, solarL + 0.6, uvRoof);

  // 6. LOW ANNEX (À direita / Lado Sul)
  const anexoX = 8.5;
  const anexoW = 5.5, anexoL = 9.0, anexoH = 4.2;
  b.addBox(anexoX, churchFloorY + anexoH / 2, churchZ + 4, anexoW, anexoH, anexoL, {
    front: uvGranite,
    right: uvGranite,
    back: uvGranite,
    top: uvRoof,
  });
  b.addGabledRoof(anexoX, churchFloorY + anexoH + 1.2, churchZ + 4, anexoW + 0.6, 2.0, anexoL + 0.4, uvRoof);

  // Build the complete textured binary GLB
  const glb = b.buildGLB();
  fs.writeFileSync("public/models/santuario_sanfins.glb", glb);
  console.log(`GLB Fotorealista gerado com sucesso em public/models/santuario_sanfins.glb (${glb.length} bytes, textura PBR de 1024x1024 embutida)`);
}

generateTexturedChurch();
