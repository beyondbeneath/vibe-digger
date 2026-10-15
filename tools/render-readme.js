#!/usr/bin/env node
// Exports the images used by README.md into readme-img/: the sprite groups, font sheet and
// palette swatches that the web page draws at runtime, plus 2x copies of the level previews.
// GitHub can't render canvases or scale images without smoothing, so everything is
// pre-scaled here with nearest-neighbour.
//   node tools/render-docs.js && node tools/render-readme.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { writePng } = require('./png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'readme-img');
fs.mkdirSync(OUT, { recursive: true });

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/assets.js'), 'utf8') + '\nthis.ASSETS = ASSETS;');

const PAL = [
  [[0, 0, 0], [0, 170, 0], [170, 0, 0], [170, 85, 0]],
  [[0, 0, 0], [0, 170, 170], [170, 0, 170], [170, 170, 170]],
];
const PANEL = [21, 21, 21];
const LABEL = [138, 138, 138];

class Image {
  constructor(w, h, bg = PANEL) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fill(0, 0, w, h, bg);
  }
  fill(x0, y0, w, h, rgb) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.w, x0 + w); x++) {
        const o = (y * this.w + x) * 4;
        this.data[o] = rgb[0]; this.data[o + 1] = rgb[1]; this.data[o + 2] = rgb[2]; this.data[o + 3] = 255;
      }
    }
  }
  save(name) {
    writePng(path.join(OUT, name + '.png'), this.w, this.h, this.data);
    console.log('wrote readme-img/' + name + '.png');
  }
}

// 2 bits per pixel, 4 pixels per byte, left pixel in the high bits
const pixelAt = (bytes, wBytes, x, y) => (bytes[y * wBytes + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;

// CGA pixels are about 1.2x taller than wide, so sprites are drawn 4 wide by 5 high
const SX = 4, SY = 5;

function drawSprite(img, spr, x0, y0, pal, opaque) {
  for (let y = 0; y < spr.h; y++) {
    for (let x = 0; x < spr.w * 4; x++) {
      const pix = pixelAt(spr.image, spr.w, x, y), out = pixelAt(spr.outline, spr.w, x, y);
      if (pix === 0 && out === 3 && !opaque) continue;
      img.fill(x0 + x * SX, y0 + y * SY, SX, SY, PAL[pal][pix]);
    }
  }
}

function drawText(img, text, x0, y0, scale, rgb) {
  for (const ch of text.toUpperCase()) {
    const g = ASSETS.font[ch];
    if (g) {
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w * 4; x++) {
          if (pixelAt(g.data, g.w, x, y)) img.fill(x0 + x * scale, y0 + y * scale, scale, scale, rgb);
        }
      }
    }
    x0 += 12 * scale;
  }
}

const GROUPS = [
  ['digger', ['r0', 'r1', 'r2', 'l0', 'l1', 'l2', 'u0', 'u1', 'u2', 'd0', 'd1', 'd2']],
  ['digger-nocab', ['r4', 'r5', 'r6', 'l4', 'l5', 'l6', 'u4', 'u5', 'u6', 'd4', 'd5', 'd6']],
  ['death', ['f9', 'f5', 'f4', 'f3', 'f2', 'f1']],
  ['nobbin', ['m0', 'm1', 'm2', 'm3']],
  ['hobbin', ['c0', 'c1', 'c2', 'c3', 'a0', 'a1', 'a2', 'a3']],
  ['gold', ['1', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']],
  ['emerald', ['cn', 'nc']],
  ['fireball', ['15', 'k1', 'k2', 'e1', 'e2', 'e3']],
  ['cherry', ['z1']],
  ['lives', ['s0', 's1', 's2']],
  ['blanks', ['rt', 'lt', 'up', 'dn', 'bf', 'bd']],
  ['dirt', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']],
  ['spare', ['0', 'b3']],
];
const OPAQUE = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'nc', 's2']);

function spriteStrip(name, keys, pal) {
  const PAD = 12, GAP = 14, LABEL_SCALE = 2, LABEL_H = 12 * LABEL_SCALE;
  const cells = keys.map(k => {
    const spr = ASSETS.sprites[k];
    const labelW = k.length * 12 * LABEL_SCALE;
    return { k, spr, w: Math.max(spr.w * 4 * SX, labelW), h: spr.h * SY };
  });
  const maxH = Math.max(...cells.map(c => c.h));
  const w = PAD * 2 + cells.reduce((s, c) => s + c.w, 0) + GAP * (cells.length - 1);
  const h = PAD * 2 + maxH + 8 + LABEL_H;
  const img = new Image(w, h);
  let x = PAD;
  for (const c of cells) {
    const sw = c.spr.w * 4 * SX;
    drawSprite(img, c.spr, x + ((c.w - sw) >> 1), PAD + maxH - c.h, pal, OPAQUE.has(c.k));
    const lw = c.k.length * 12 * LABEL_SCALE;
    drawText(img, c.k, x + ((c.w - lw) >> 1), PAD + maxH + 8, LABEL_SCALE, LABEL);
    x += c.w + GAP;
  }
  img.save('sprites-' + name + (pal ? '-bonus' : ''));
}

function fontSheet() {
  const order = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._ ';
  const SCALE = 3, CELL = 12 * SCALE + 12, PER_ROW = 13, PAD = 12;
  const rows = Math.ceil(order.length / PER_ROW);
  const img = new Image(PAD * 2 + PER_ROW * CELL - 12, PAD * 2 + rows * (12 * SCALE + 12) - 12, [0, 0, 0]);
  [...order].forEach((ch, i) => {
    const x = PAD + (i % PER_ROW) * CELL, y = PAD + Math.floor(i / PER_ROW) * (12 * SCALE + 12);
    if (ch === ' ') img.fill(x, y + 12 * SCALE - 3, 12 * SCALE, 3, [60, 60, 60]); // show where the blank glyph sits
    else drawText(img, ch, x, y, SCALE, PAL[0][3]);
  });
  img.save('font');
}

function paletteSwatches() {
  const NAMES = [['BLACK', 'GREEN', 'RED', 'BROWN'], ['BLACK', 'CYAN', 'MAGENTA', 'GREY']];
  const SW = 40, PAD = 12, COL = 160, ROW = 64;
  const img = new Image(PAD * 2 + 4 * COL, PAD * 2 + 2 * ROW - 16);
  for (let p = 0; p < 2; p++) {
    for (let c = 0; c < 4; c++) {
      const x = PAD + c * COL, y = PAD + p * ROW;
      img.fill(x - 1, y - 1, SW + 2, SW + 2, [85, 85, 85]);
      img.fill(x, y, SW, SW, PAL[p][c]);
      drawText(img, c + ' ' + NAMES[p][c], x + SW + 8, y + 4, 1, LABEL);
    }
  }
  img.save('palettes');
}

// Nearest-neighbour 2x upscale of the engine-rendered previews in img/
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)); // written by png.js: RGB, filter 0 on every row
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * w + x) * 4 + k] = raw[y * (w * 3 + 1) + 1 + x * 3 + k];
      rgba[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { w, h, rgba };
}
function upscale(name, factor) {
  const src = readPng(path.join(ROOT, 'img', name + '.png'));
  const w = src.w * factor, h = src.h * factor;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / factor) * src.w + Math.floor(x / factor)) * 4, d = (y * w + x) * 4;
      out[d] = src.rgba[s]; out[d + 1] = src.rgba[s + 1]; out[d + 2] = src.rgba[s + 2];
    }
  }
  writePng(path.join(OUT, name + '.png'), w, h, out);
  console.log('wrote readme-img/' + name + '.png');
}

for (const [name, keys] of GROUPS) spriteStrip(name, keys, 0);
spriteStrip('digger', GROUPS[0][1], 1);
spriteStrip('hobbin', GROUPS[4][1], 1);
fontSheet();
paletteSwatches();
for (let l = 1; l <= 8; l++) upscale('level-' + l, 2);
upscale('level-1-bonus', 2);
upscale('title-bitmap', 2);
