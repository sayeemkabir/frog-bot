// Draws the Frog Bot icon into build/icon.png (app) and build/tray.png (tray),
// using only Node: shapes are rasterised with 4x4 supersampling and written as PNG.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { root } from './tasks.mjs';

// The mark: a flat frog silhouette (two eye domes on a rounded head) with the
// eyes cut out. One colour, no gradients, so it reads at 16 px and in print.
const ACCENT = [47, 191, 113];
const TILE_TOP = [26, 29, 32];
const TILE_BOTTOM = [15, 17, 19];
function crc32(buf) {
  let c;
  const table = crc32.table ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
};

/** Whether a point in the mark's 64×64 design space is inside the mark (see Logo in src/renderer/components/ui.tsx). */
function frog(x, y) {
  const body = inCircle(x, y, 20, 22, 10) || inCircle(x, y, 44, 22, 10) || inRoundRect(x, y, 6, 24, 58, 54, 15);
  const eyes = inCircle(x, y, 20, 22, 4) || inCircle(x, y, 44, 22, 4);
  return body && !eyes ? [...ACCENT, 255] : null;
}

function render(size, { background }) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size;
          const v = (py + (sy + 0.5) / ss) / size;
          let c = null;
          if (background) {
            // Dark rounded tile, mark at 60% scale, optically centred.
            const r = 0.225;
            const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
            const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
            if (dx * dx + dy * dy <= r * r) {
              c = [...mix(TILE_TOP, TILE_BOTTOM, v), 255];
              const f = frog((u - 0.2) * 64 / 0.6, (v - 0.21) * 64 / 0.6);
              if (f) c = f;
            }
          } else {
            c = frog(u * 64, v * 64 + 6);
          }
          if (c) acc = [acc[0] + c[0] * c[3], acc[1] + c[1] * c[3], acc[2] + c[2] * c[3], acc[3] + c[3]];
        }
      }
      const n = ss * ss;
      const a = acc[3] / n;
      const i = (py * size + px) * 4;
      rgba[i] = a ? acc[0] / acc[3] : 0;
      rgba[i + 1] = a ? acc[1] / acc[3] : 0;
      rgba[i + 2] = a ? acc[2] / acc[3] : 0;
      rgba[i + 3] = a;
    }
  }
  return png(size, rgba);
}

/** A Windows .ico made of PNG images (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.data)]);
}

const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), render(512, { background: true }));
fs.writeFileSync(path.join(out, 'tray.png'), render(64, { background: false }));
fs.writeFileSync(path.join(out, 'icon.ico'), ico([256, 64, 48, 32, 16].map((size) => ({ size, data: render(size, { background: true }) }))));
console.log('✓ wrote build/icon.png, build/tray.png and build/icon.ico');
