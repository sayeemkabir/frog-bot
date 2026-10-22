// Draws the Frog Bot icon into build/icon.png (app) and build/tray.png (tray),
// using only Node: shapes are rasterised with 4x4 supersampling and written as PNG.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { root } from './tasks.mjs';

const GREEN_TOP = [95, 240, 160];
const GREEN_BOTTOM = [34, 184, 102];

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
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// Smile: quadratic curve from (20,41) via (32,47) to (44,41), 3.2 units thick.
const smile = Array.from({ length: 120 }, (_, i) => {
  const t = i / 119;
  return [(1 - t) ** 2 * 20 + 2 * (1 - t) * t * 32 + t * t * 44, (1 - t) ** 2 * 41 + 2 * (1 - t) * t * 47 + t * t * 41];
});
const onSmile = (x, y) => smile.some(([sx, sy]) => (x - sx) ** 2 + (y - sy) ** 2 <= 1.6 ** 2);

/** Colour of the frog at a point in its 64×64 design space, or null if outside. */
function frog(x, y) {
  let color = null;
  if (inCircle(x, y, 19, 20, 11) || inCircle(x, y, 45, 20, 11) || inEllipse(x, y, 32, 38, 27, 21)) {
    color = [...mix(GREEN_TOP, GREEN_BOTTOM, Math.min(1, Math.max(0, (y - 9) / 50))), 255];
  }
  if (!color) return null;
  if (inCircle(x, y, 13, 37, 3) || inCircle(x, y, 51, 37, 3)) color = [...mix(color.slice(0, 3), [255, 143, 163], 0.55), 255];
  if (inCircle(x, y, 19, 19, 6) || inCircle(x, y, 45, 19, 6)) color = [255, 255, 255, 255];
  if (inCircle(x, y, 20, 20, 3.2) || inCircle(x, y, 46, 20, 3.2)) color = [10, 12, 11, 255];
  if (onSmile(x, y)) color = [10, 58, 31, 255];
  return color;
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
            // Rounded square with a soft vertical gradient, frog at 78% scale.
            const r = 0.22;
            const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
            const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
            if (dx * dx + dy * dy <= r * r) c = [...mix([24, 30, 27], [10, 12, 11], v), 255];
            const f = frog((u - 0.11) * 64 / 0.78, (v - 0.14) * 64 / 0.78);
            if (f) c = f;
          } else {
            c = frog(u * 64, v * 64 + 2);
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

const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), render(512, { background: true }));
fs.writeFileSync(path.join(out, 'tray.png'), render(64, { background: false }));
console.log('✓ wrote build/icon.png and build/tray.png');
