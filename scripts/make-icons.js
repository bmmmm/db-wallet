#!/usr/bin/env node
// Rasterizes the db-wallet icon (the shapes of favicon.svg) to the PNG app
// icons, with nothing but node:zlib — no external tools, deterministic output.
//
//   node scripts/make-icons.js          # (re)write the PNGs in the repo root
//   node scripts/make-icons.js --check  # exit 1 if a PNG differs from a fresh render
//
// Outputs:
//   icon-192.png, icon-512.png   purpose "any": rounded corners, transparent outside
//   icon-maskable-512.png        purpose "maskable": full bleed, motif scaled into
//                                the 80 % safe zone
//   apple-touch-icon.png         180 px, full bleed, opaque (iOS rounds it itself)
// Keep the geometry in sync with favicon.svg.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");

const BG = [0x14, 0x12, 0x1c];
const CUP = [0xb4, 0x9c, 0xff];
const ARROW = [0x9a, 0xd6, 0xff];

// --- geometry (SVG user units, viewBox 0 0 512 512) ------------------------

// SVG elliptical arc (circle, rx = ry) endpoint → polyline points.
function arcPoints(x1, y1, x2, y2, r, largeArc, sweep, steps) {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const d2 = dx * dx + dy * dy;
  const rr = Math.max(r, Math.sqrt(d2));
  let k = Math.sqrt(Math.max(0, (rr * rr - d2) / d2));
  if (largeArc === sweep) k = -k;
  const cx = (x1 + x2) / 2 + k * dy;
  const cy = (y1 + y2) / 2 - k * dx;
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  let a2 = Math.atan2(y2 - cy, x2 - cx);
  let delta = a2 - a1;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const a = a1 + (delta * i) / steps;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return pts;
}

// Cup: M156 144 h200 l-24 256 a32 32 0 0 1 -32 29 H212 a32 32 0 0 1 -32 -29 z
const CUP_PATH = (() => {
  const p = [[156, 144], [356, 144], [332, 400]];
  p.push(...arcPoints(332, 400, 300, 429, 32, 0, 1, 16));
  p.push([212, 429]);
  p.push(...arcPoints(212, 429, 180, 400, 32, 0, 1, 16));
  p.push([156, 144]); // close
  return p;
})();

const LAYERS = [
  { color: CUP, width: 20, polylines: [CUP_PATH] },
  { color: CUP, width: 12, polylines: [[[180, 220], [332, 220]]] },
  {
    color: ARROW,
    width: 16,
    polylines: [
      [[256, 144], [256, 96]],
      [[224, 112], [256, 80], [288, 112]],
    ],
  },
];

function segments(polylines) {
  const out = [];
  for (const pl of polylines) {
    for (let i = 0; i + 1 < pl.length; i++) out.push([pl[i], pl[i + 1]]);
  }
  return out;
}
const LAYER_SEGS = LAYERS.map((l) => ({ ...l, segs: segments(l.polylines), r: l.width / 2 }));

function distToSeg(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - t * vx;
  const dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Round stroke = all points within width/2 of a segment (round caps + joins).
function inStroke(layer, x, y) {
  for (const [a, b] of layer.segs) {
    if (distToSeg(x, y, a, b) <= layer.r) return true;
  }
  return false;
}

function inRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// --- rasterizer --------------------------------------------------------------

const SS = 4; // 4 x 4 supersampling per pixel

// opts: size (px), rounded (transparent rounded corners), scale (motif scale
// around the centre, for the maskable safe zone).
function render({ size, rounded, scale = 1 }) {
  const px = Buffer.alloc(size * size * 4);
  const unit = 512 / size; // SVG units per pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) * unit;
          const uy = (y + (sy + 0.5) / SS) * unit;
          if (rounded && !inRoundedRect(ux, uy, 512, 96)) continue;
          // Motif coordinates (scaled around the centre).
          const mx = 256 + (ux - 256) / scale;
          const my = 256 + (uy - 256) / scale;
          let c = BG;
          for (let i = LAYER_SEGS.length - 1; i >= 0; i--) {
            if (inStroke(LAYER_SEGS[i], mx, my)) {
              c = LAYER_SEGS[i].color;
              break;
            }
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (y * size + x) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((255 * a) / (SS * SS));
    }
  }
  return encodePng(size, size, px);
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- outputs -------------------------------------------------------------------

// The motif spans about 220 x 367 units around the centre; scaled by 0.8 its
// farthest point stays inside the maskable safe zone (radius 0.4 * 512).
const ICONS = {
  "icon-192.png": { size: 192, rounded: true },
  "icon-512.png": { size: 512, rounded: true },
  "icon-maskable-512.png": { size: 512, rounded: false, scale: 0.8 },
  "apple-touch-icon.png": { size: 180, rounded: false },
};

function main(argv) {
  const check = argv.includes("--check");
  let stale = 0;
  for (const [name, opts] of Object.entries(ICONS)) {
    const png = render(opts);
    const file = path.join(ROOT, name);
    if (check) {
      const same = fs.existsSync(file) && fs.readFileSync(file).equals(png);
      if (!same) {
        stale++;
        console.error(`stale: ${name}`);
      }
    } else {
      fs.writeFileSync(file, png);
      console.log(`${name}: ${opts.size}x${opts.size}, ${png.length} bytes`);
    }
  }
  return stale ? 1 : 0;
}

module.exports = { ICONS, render, encodePng, crc32, CUP_PATH, LAYERS };

if (require.main === module) process.exit(main(process.argv.slice(2)));
