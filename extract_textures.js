import sharp from "sharp";
import fs from "fs";

// Photo dimensions: 1024 x 768
// Let's create crops of key architectural elements from public/images/santuario_sanfins.jpg:
// 1. Facade & Tower:
// In the photo (1024x768):
// Center is around x=550.
// Spire cross is at x ~ 560, y ~ 70.
// Belfry is at y ~ 240 to 360, x ~ 505 to 615.
// Front pediment with clock is at y ~ 360 to 450, x ~ 430 to 680.
// Portal with azulejos is at y ~ 450 to 620, x ~ 435 to 675.
// Stairs are at y ~ 620 to 760, x ~ 0 to 750.
// Solar (manor house on left) is at y ~ 420 to 620, x ~ 210 to 440.

async function extractKeyTextures() {
  const meta = await sharp("public/images/santuario_sanfins.jpg").metadata();
  console.log("Photo metadata:", meta);

  if (!fs.existsSync("public/textures")) fs.mkdirSync("public/textures", { recursive: true });

  // Crop 1: Complete Church Facade + Bell Tower (excluding sky where possible)
  // x: 425 to 685 (width: 260), y: 220 to 630 (height: 410)
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 420, top: 220, width: 270, height: 410 })
    .resize(512, 512, { fit: "fill" })
    .toFile("public/textures/tex_facade.jpg");
  console.log("Extracted tex_facade.jpg");

  // Crop 2: Central Portal + Azulejos + Clock
  // x: 435 to 675 (width: 240), y: 390 to 625 (height: 235)
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 435, top: 390, width: 240, height: 235 })
    .resize(512, 512, { fit: "fill" })
    .toFile("public/textures/tex_portal_azulejos.jpg");
  console.log("Extracted tex_portal_azulejos.jpg");

  // Crop 3: Bell Tower & Belfry
  // x: 495 to 625 (width: 130), y: 225 to 375 (height: 150)
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 495, top: 225, width: 130, height: 150 })
    .resize(256, 256, { fit: "fill" })
    .toFile("public/textures/tex_belfry.jpg");
  console.log("Extracted tex_belfry.jpg");

  // Crop 4: Manor House (Solar Nobre em Granito)
  // x: 215 to 435 (width: 220), y: 440 to 630 (height: 190)
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 215, top: 440, width: 220, height: 190 })
    .resize(512, 512, { fit: "fill" })
    .toFile("public/textures/tex_solar_stone.jpg");
  console.log("Extracted tex_solar_stone.jpg");

  // Crop 5: Monumental Granite Stairs
  // x: 100 to 500 (width: 400), y: 640 to 760 (height: 120)
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 100, top: 640, width: 400, height: 120 })
    .resize(512, 256, { fit: "fill" })
    .toFile("public/textures/tex_granite_stairs.jpg");
  console.log("Extracted tex_granite_stairs.jpg");

  // Crop 6: Authentic Terracotta Tile Roof (from the solar roof)
  // x: 215 to 430, y: 390 to 445
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 220, top: 390, width: 200, height: 55 })
    .resize(256, 256, { fit: "fill" })
    .toFile("public/textures/tex_tile_roof.jpg");
  console.log("Extracted tex_tile_roof.jpg");

  // Crop 7: Carved Granite Texture (from side wall or pedestal)
  // x: 570 to 660, y: 620 to 670
  await sharp("public/images/santuario_sanfins.jpg")
    .extract({ left: 570, top: 620, width: 90, height: 50 })
    .resize(256, 256, { fit: "fill" })
    .toFile("public/textures/tex_granite_clean.jpg");
  console.log("Extracted tex_granite_clean.jpg");
}

extractKeyTextures();
