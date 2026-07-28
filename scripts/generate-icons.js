// Generate all raster app icons from the vector source (icons/icon-glyph.svg).
// Run: npm run build:icons   (requires devDependency `sharp`)
//
// One mark, every surface: PWA icons, Apple touch icon, iOS AppIcon, and the
// Android legacy / round / adaptive-foreground icons across all densities.
// The dark brand gradient is composited here so the SVG source stays a clean glyph.
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const GLYPH = path.join(ROOT, 'icons', 'icon-glyph.svg');
const BG_TOP = '#221708';   // gradient top-left
const BG_BOT = '#0d0904';   // gradient bottom-right + flat fill
const APP_SCALE = 0.82;     // glyph footprint inside a full app-icon tile
const FG_SCALE  = 0.66;     // glyph footprint inside the Android adaptive safe zone

const bgSvg = (size, rx) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
     <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOT}"/>
     </linearGradient></defs>
     <rect width="${size}" height="${size}" rx="${rx}" fill="url(#b)"/>
   </svg>`);

const circleSvg = (size) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
     <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
   </svg>`);

let MASTER;  // a large, crisp transparent render of the glyph, reused for every size
async function master() {
  if (!MASTER) {
    MASTER = await sharp(GLYPH, { density: 600 })
      .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
  }
  return MASTER;
}

async function glyphAt(px) {
  return sharp(await master())
    .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }

// full app-icon tile: gradient bg (rx) + centered glyph; opaque when flatten=true
async function appIcon(outPath, size, { rx = 0, scale = APP_SCALE, flatten = false } = {}) {
  ensureDir(outPath);
  const glyph = await glyphAt(Math.round(size * scale));
  let img = sharp(bgSvg(size, rx)).composite([{ input: glyph, gravity: 'center' }]);
  if (flatten) img = img.flatten({ background: BG_BOT }).removeAlpha();
  await img.png().toFile(outPath);
  console.log('  ✓', path.relative(ROOT, outPath), `${size}px`);
}

// transparent glyph centered on a transparent square (Android adaptive foreground)
async function foreground(outPath, size, scale = FG_SCALE) {
  ensureDir(outPath);
  const glyph = await glyphAt(Math.round(size * scale));
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, gravity: 'center' }])
    .png().toFile(outPath);
  console.log('  ✓', path.relative(ROOT, outPath), `${size}px (fg)`);
}

// circular icon (Android legacy round): square tile masked to a circle
async function roundIcon(outPath, size, scale = APP_SCALE) {
  ensureDir(outPath);
  const glyph = await glyphAt(Math.round(size * scale));
  const tile = await sharp(bgSvg(size, 0)).composite([{ input: glyph, gravity: 'center' }]).png().toBuffer();
  await sharp(tile).composite([{ input: circleSvg(size), blend: 'dest-in' }]).png().toFile(outPath);
  console.log('  ✓', path.relative(ROOT, outPath), `${size}px (round)`);
}

const AND = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = {
  'mdpi':    { launcher: 48,  fg: 108 },
  'hdpi':    { launcher: 72,  fg: 162 },
  'xhdpi':   { launcher: 96,  fg: 216 },
  'xxhdpi':  { launcher: 144, fg: 324 },
  'xxxhdpi': { launcher: 192, fg: 432 },
};

(async () => {
  console.log('Generating icons from icons/icon-glyph.svg …');

  console.log('PWA / web:');
  await appIcon(path.join(ROOT, 'icons', 'icon-192.png'), 192, { flatten: true });
  await appIcon(path.join(ROOT, 'icons', 'icon-512.png'), 512, { flatten: true });
  await appIcon(path.join(ROOT, 'icons', 'apple-touch-icon.png'), 180, { flatten: true });

  console.log('iOS:');
  await appIcon(path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'),
    1024, { flatten: true });  // opaque, no alpha — iOS masks corners itself

  console.log('Android:');
  for (const [d, s] of Object.entries(DENSITIES)) {
    const dir = path.join(AND, `mipmap-${d}`);
    await appIcon(path.join(dir, 'ic_launcher.png'), s.launcher, { rx: Math.round(s.launcher * 0.16) });
    await roundIcon(path.join(dir, 'ic_launcher_round.png'), s.launcher);
    await foreground(path.join(dir, 'ic_launcher_foreground.png'), s.fg);
  }

  console.log('Done.');
})().catch(e => { console.error('icon generation failed:', e); process.exit(1); });
