#!/usr/bin/env node
/*
 * Generates the brand mark and every icon size from one SVG source.
 *
 * Replaces the stock Create React App React atom (logo192/logo512) and the
 * emoji-in-SVG favicon. Re-run after editing MARK below:
 *   node scripts/build-brand-assets.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PUBLIC = path.join(__dirname, "..", "public");

// Brand tokens, kept in sync with :root in src/App.css by hand. If --gold or
// --bg change there, change them here and re-run.
const GOLD = "#d4af37";
const INK = "#12151c";

// A single geometric spade. Deliberately not an illustration: it has to stay
// legible at 16px in a browser tab, so it is one closed path and nothing else.
// Symmetric about x=50; vertical extent 10 to 92, so its centre is y=51.
const SPADE =
  "M 50 10 C 38 26 18 38 18 54 C 18 65 26 72 36 72 C 41 72 45 70 48 67 " +
  "C 47 78 42 87 34 92 L 66 92 C 58 87 53 78 52 67 C 55 70 59 72 64 72 " +
  "C 74 72 82 65 82 54 C 82 38 62 26 50 10 Z";

// scale: how much of the tile the spade occupies. radius: tile corner rounding.
const tile = ({ scale = 0.8, radius = 22, bg = INK } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  ${radius > 0
    ? `<rect width="100" height="100" rx="${radius}" fill="${bg}"/>`
    : `<rect width="100" height="100" fill="${bg}"/>`}
  <path transform="translate(50 50) scale(${scale}) translate(-50 -51)"
        fill="${GOLD}" d="${SPADE}"/>
</svg>`.trim();

// Pack PNGs into an .ico. Vista and later accept embedded PNG data directly,
// which is why this needs no BMP encoder.
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);            // reserved
  head.writeUInt16LE(1, 2);            // type: icon
  head.writeUInt16LE(pngs.length, 4);  // image count

  let offset = 6 + pngs.length * 16;
  const dir = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                // palette size
    e.writeUInt8(0, 3);                // reserved
    e.writeUInt16LE(1, 4);             // colour planes
    e.writeUInt16LE(32, 6);            // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.data)]);
}

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

(async () => {
  const rounded = tile();
  // Maskable icons get cropped to a circle or squircle by the launcher, so the
  // mark has to sit inside the central 80%. Full bleed, no corner rounding.
  const maskable = tile({ scale: 0.52, radius: 0 });
  // iOS applies its own rounding and does not honour transparency.
  const apple = tile({ scale: 0.68, radius: 0 });

  const out = [
    ["favicon.svg", Buffer.from(rounded + "\n")],
    ["logo192.png", await png(rounded, 192)],
    ["logo512.png", await png(rounded, 512)],
    ["maskable-512.png", await png(maskable, 512)],
    ["apple-touch-icon.png", await png(apple, 180)],
    ["favicon.ico", ico([
      { size: 16, data: await png(rounded, 16) },
      { size: 32, data: await png(rounded, 32) },
      { size: 48, data: await png(rounded, 48) },
    ])],
  ];

  for (const [name, data] of out) {
    fs.writeFileSync(path.join(PUBLIC, name), data);
    console.log(`  ${name.padEnd(22)} ${data.length} bytes`);
  }
})();
