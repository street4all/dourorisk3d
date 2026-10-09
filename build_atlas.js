import sharp from "sharp";
import fs from "fs";

async function createMasterAtlas() {
  console.log("Generating 1024x1024 Architectural Texture Atlas...");

  // 1. Facade crop:
  // x: 425 to 685 (width: 260), y: 220 to 625 (height: 405)
  const facadeBuf = await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 425, top: 220, width: 260, height: 405 })
    .resize(512, 512, { fit: "cover" })
    .toBuffer();

  // 2. Solar (Manor House) crop:
  // x: 215 to 435 (width: 220), y: 440 to 630 (height: 190)
  const solarBuf = await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 215, top: 440, width: 220, height: 190 })
    .resize(512, 512, { fit: "cover" })
    .toBuffer();

  // 3. Tile Roof crop (from the real roof of the church in the photo!):
  // Look at x: 670 to 760, y: 505 to 550 (the sloped nave roof on the right of the facade)
  // Or create a seamless terracotta tile pattern:
  const tileWidth = 512, tileHeight = 512;
  const tileRgba = Buffer.alloc(tileWidth * tileHeight * 4);
  for (let y = 0; y < tileHeight; y++) {
    for (let x = 0; x < tileWidth; x++) {
      const idx = (y * tileWidth + x) * 4;
      // Portuguese "telha lusa" wave profile:
      const wave = Math.sin((x / 24) * Math.PI * 2);
      const rowStep = (y % 40) < 4 ? 0.75 : 1.0;
      const noise = ((x * 13 + y * 29) % 31) / 31 * 20 - 10;
      
      const r = Math.min(Math.max(185 + wave * 35 + noise, 0), 255) * rowStep;
      const g = Math.min(Math.max(75 + wave * 18 + noise * 0.5, 0), 255) * rowStep;
      const b = Math.min(Math.max(42 + wave * 12 + noise * 0.3, 0), 255) * rowStep;
      
      tileRgba[idx] = Math.round(r);
      tileRgba[idx + 1] = Math.round(g);
      tileRgba[idx + 2] = Math.round(b);
      tileRgba[idx + 3] = 255;
    }
  }
  const roofBuf = await sharp(tileRgba, { raw: { width: tileWidth, height: tileHeight, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer();

  // 4. Granite Stone / Stairs (weathered Douro granite):
  const granRgba = Buffer.alloc(512 * 512 * 4);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const idx = (y * 512 + x) * 4;
      const blockX = (x % 64) < 3 ? 0.7 : 1.0;
      const blockY = (y % 32) < 3 ? 0.7 : 1.0;
      const grain = ((x * 17 + y * 37) % 53) / 53 * 35 - 17;
      
      const base = 195 + grain;
      granRgba[idx] = Math.round(Math.min(Math.max(base * blockX * blockY, 0), 255));
      granRgba[idx + 1] = Math.round(Math.min(Math.max((base - 10) * blockX * blockY, 0), 255));
      granRgba[idx + 2] = Math.round(Math.min(Math.max((base - 22) * blockX * blockY, 0), 255));
      granRgba[idx + 3] = 255;
    }
  }
  const graniteBuf = await sharp(granRgba, { raw: { width: 512, height: 512, channels: 4 } })
    .jpeg({ quality: 90 })
    .toBuffer();

  const atlas = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 180, g: 170, b: 160 }
    }
  })
  .composite([
    { input: facadeBuf, left: 0, top: 0 },
    { input: solarBuf, left: 512, top: 0 },
    { input: roofBuf, left: 0, top: 512 },
    { input: graniteBuf, left: 512, top: 512 }
  ])
  .jpeg({ quality: 92 })
  .toFile("public/textures/santuario_atlas.jpg");

  console.log("Master Atlas generated at public/textures/santuario_atlas.jpg:", atlas);
}

createMasterAtlas();
