// CGA 320x200x4 framebuffer plus a port of the sprite library in GRAPHLIB.ASM.
// Video memory is kept in the real interlaced CGA layout (even scan lines at
// 0x0000, odd at 0x2000, 80 bytes per line, 4 pixels per byte) so that
// pixel peeks, the run-length encoded title screen and edge cases behave like
// the original.
'use strict';

const CGA = (() => {
  const mem = new Uint8Array(0x4000);

  const PALETTES = [
    [[0, 0, 0], [0, 170, 0], [170, 0, 0], [170, 85, 0]],       // palette 0: green / red / brown
    [[0, 0, 0], [0, 170, 170], [170, 0, 170], [170, 170, 170]], // palette 1: cyan / magenta / white
  ];
  let paletteNum = 0;
  let blendPalettes = false; // rapid palette flicker (flash_palettes) is shown as a blend

  // ---------- low level ----------

  function pointAddr(x, y) {
    let a = ((y & 0xfe) * 40) & 0xffff;
    if (y & 1) a += 0x2000;
    return (a + (x >> 2)) & 0x3fff;
  }

  function peekXY(x, y) { return mem[pointAddr(x, y)]; }

  function clear(color) {
    let c = color & 3;
    c = c | (c << 2) | (c << 4) | (c << 6);
    mem.fill(c);
  }

  function palette(n) { paletteNum = n & 1; }
  function setBlend(on) { blendPalettes = on; }

  function writePoint(x, y, color) {
    if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
    const a = pointAddr(x, y);
    const shift = (3 - (x & 3)) * 2;
    mem[a] = (mem[a] & ~(3 << shift)) | ((color & 3) << shift);
  }

  function line(x1, y1, x2, y2, color) {
    let d1 = x2 - x1, d2 = y2 - y1, s1 = 0, s2 = 1, a1 = 1, a2 = 0;
    if (d1 < 0) { a1 = -1; d1 = -d1; }
    if (d2 < 0) { s2 = -1; d2 = -d2; }
    if (d1 < d2) { const t = d1; d1 = d2; d2 = t; s1 = a1; a1 = 0; a2 = s2; s2 = 0; }
    let d3 = d1 >> 1, x = x1, y = y1;
    writePoint(x, y, color);
    for (let n = 1; n <= d1; n++) {
      x += a1; y += a2; d3 += d2;
      if (d3 > d1) { d3 -= d1; x += s1; y += s2; }
      writePoint(x, y, color);
    }
  }

  // ---------- sprite engine ----------
  // Index 16 is the scratch entry used by sp_put / sp_blank / put.

  const N = 17;
  const active = new Array(N).fill(false);
  const image = new Array(N), outline = new Array(N), backgnd = new Array(N);
  const spX = new Int32Array(N), spY = new Int32Array(N);
  const xWidth = new Int32Array(N), yWidth = new Int32Array(N);
  const xTrim = new Int32Array(N), yTrim = new Int32Array(N);
  const newImage = new Array(N), newOutline = new Array(N);
  const newXWidth = new Int32Array(N), newYWidth = new Int32Array(N);
  const newXTrim = new Int32Array(N), newYTrim = new Int32Array(N);
  const colFlag = new Array(N).fill(false), colCheck = new Array(N).fill(false);
  let table = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  for (let i = 0; i < N; i++) backgnd[i] = new Uint8Array(256);

  // walk the scan lines of a sprite rectangle the same way xfer_init/next_line do
  function forEachLine(n, fn) {
    let di = pointAddr(spX[n], spY[n]);
    let even = !(spY[n] & 1);
    const w = xWidth[n];
    for (let row = 0; row < yWidth[n]; row++) {
      fn(di, row * w, w);
      even = !even;
      di = even ? (di - 0x2000 + 80) & 0x3fff : (di + 0x2000) & 0x3fff;
    }
  }

  function removeSp(n) {
    const bg = backgnd[n];
    forEachLine(n, (di, off, w) => { for (let i = 0; i < w; i++) mem[(di + i) & 0x3fff] = bg[off + i]; });
  }

  function getBackgnd(n) {
    const bg = backgnd[n];
    forEachLine(n, (di, off, w) => { for (let i = 0; i < w; i++) bg[off + i] = mem[(di + i) & 0x3fff]; });
  }

  function putSp(n) {
    const img = image[n], out = outline[n];
    forEachLine(n, (di, off, w) => {
      for (let i = 0; i < w; i++) {
        const a = (di + i) & 0x3fff;
        mem[a] = (out[off + i] & mem[a]) | img[off + i];
      }
    });
  }

  function overlap(b, s) {
    if (spX[b] >= spX[s]) {
      if (!(spX[b] <= xWidth[s] * 4 + spX[s] - 1)) return false;
    } else if (!(xWidth[b] * 4 + spX[b] - 1 >= spX[s])) return false;
    if (spY[b] >= spY[s]) return spY[b] <= yWidth[s] + spY[s] - 1;
    return yWidth[b] + spY[b] - 1 >= spY[s];
  }

  function retCol(b, s) {
    if (spX[b] >= spX[s]) {
      if (!(spX[b] + xTrim[b] <= xWidth[s] * 4 + spX[s] - xTrim[s] - 1)) return false;
    } else if (!(xWidth[b] * 4 + spX[b] - xTrim[b] - 1 >= spX[s] + xTrim[s])) return false;
    if (spY[b] >= spY[s]) return spY[b] + yTrim[b] <= yWidth[s] + spY[s] - yTrim[s] - 1;
    return yWidth[b] + spY[b] - yTrim[b] - 1 >= spY[s] + yTrim[s];
  }

  // flags every sprite overlapping n (transitively) in colFlag
  function collision(n) {
    if (colCheck[n]) return;
    colCheck[n] = true;
    for (let b = 0; b < 16; b++) {
      if (!active[b] || b === n) continue;
      if (overlap(b, n)) { colFlag[b] = true; collision(b); }
      // (x+320, y-2) addresses the same video memory as (x, y): check wrapped copies
      spX[b] += 320; spY[b] -= 2;
      if (overlap(b, n)) { colFlag[b] = true; collision(b); }
      spX[b] -= 640; spY[b] += 4;
      if (overlap(b, n)) { colFlag[b] = true; collision(b); }
      spX[b] += 320; spY[b] -= 2;
    }
  }

  function clearChk() { colCheck.fill(false); }
  function clearTable() { clearChk(); colFlag.fill(false); }
  function replaceAll() { for (let i = 0; i < 16; i++) if (colFlag[table[i]]) putSp(table[i]); }
  function removeAll() { for (let i = 0; i < 16; i++) if (colFlag[i]) removeSp(i); }

  function colDetect(n) {
    let r = 0;
    for (let b = 0; b < 16; b++) {
      if (!active[b] || b === n) continue;
      if (retCol(b, n)) r |= 1 << b;
      spX[b] += 320; spY[b] -= 2;
      if (retCol(b, n)) r |= 1 << b;
      spX[b] -= 640; spY[b] += 4;
      if (retCol(b, n)) r |= 1 << b;
      spX[b] += 320; spY[b] -= 2;
    }
    return r;
  }

  function spInit(n, spr, xt = 0, yt = 0) {
    newImage[n] = image[n] = spr.image;
    newOutline[n] = outline[n] = spr.outline;
    newXWidth[n] = xWidth[n] = spr.w;
    newYWidth[n] = yWidth[n] = spr.h;
    newXTrim[n] = xTrim[n] = xt;
    newYTrim[n] = yTrim[n] = yt;
    active[n] = false;
  }

  function spChnge(n, spr, xt = 0, yt = 0) {
    newImage[n] = spr.image;
    newOutline[n] = spr.outline;
    newXWidth[n] = spr.w;
    newYWidth[n] = spr.h;
    newXTrim[n] = xt;
    newYTrim[n] = yt;
  }

  function takeNew(n) {
    image[n] = newImage[n]; outline[n] = newOutline[n];
    xWidth[n] = newXWidth[n]; yWidth[n] = newYWidth[n];
    xTrim[n] = newXTrim[n]; yTrim[n] = newYTrim[n];
  }

  function spPlace(n, x, y) {
    spX[n] = x & 0xfffc; spY[n] = y;
    takeNew(n);
    clearTable();
    collision(n);
    removeAll();
    getBackgnd(n);
    active[n] = true;
    colFlag[n] = true;
    replaceAll();
    return colDetect(n);
  }

  function spErase(n) {
    removeSp(n);
    active[n] = false;
    clearTable();
    collision(n);
    replaceAll();
  }

  function spMove(n, x, y) {
    const nx = x & 0xfffc, ny = y;
    clearTable();
    collision(n);
    const ox = spX[n], oy = spY[n], ow = xWidth[n], oh = yWidth[n];
    spX[n] = nx; spY[n] = ny;
    xWidth[n] = newXWidth[n]; yWidth[n] = newYWidth[n];
    clearChk();
    collision(n);
    spX[n] = ox; spY[n] = oy; xWidth[n] = ow; yWidth[n] = oh;
    colFlag[n] = true;
    removeAll();
    spX[n] = nx; spY[n] = ny;
    takeNew(n);
    getBackgnd(n);
    replaceAll();
    return colDetect(n);
  }

  function spTable(t) { table = t ? t.slice() : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; }

  // width is in bytes here (see the note at the top of GRAPHLIB.ASM)
  function spBlank(x, y, w, h) {
    spX[16] = x; spY[16] = y; xWidth[16] = w; yWidth[16] = h;
    clearTable();
    collision(16);
    removeAll();
  }

  function spDisp() {
    for (let i = 0; i < 16; i++) if (colFlag[i]) getBackgnd(i);
    replaceAll();
  }

  function spPut(x, y, spr) {
    spX[16] = x & 0xfffc; spY[16] = y;
    image[16] = spr.image; outline[16] = spr.outline;
    xWidth[16] = spr.w; yWidth[16] = spr.h;
    putSp(16);
  }

  // text/score glyph put: each byte is ANDed with the colour replicated into 4 pixels
  function put(x, y, glyph, color) {
    spX[16] = x & 0xfffc; spY[16] = y;
    xWidth[16] = glyph.w; yWidth[16] = glyph.h;
    let c = color & 3;
    c = c | (c << 2) | (c << 4) | (c << 6);
    const data = glyph.data;
    forEachLine(16, (di, off, w) => { for (let i = 0; i < w; i++) mem[(di + i) & 0x3fff] = data[off + i] & c; });
  }

  function isActive(n) { return active[n]; }

  // ---------- run-length encoded title screen (GENTITLE.ASM) ----------
  function genTitle(rle) {
    let di = 0, si = 0;
    const next = () => (si < rle.length ? rle[si++] : 0);
    while (di < 0x4000) {
      const al = next();
      if (al === 0xfe) {
        let count = next();
        const v = next();
        do { mem[di++] = v; count = (count - 1) & 0xff; } while (count && di < 0x4000);
      } else mem[di++] = al;
    }
  }

  // ---------- presentation ----------
  function render(imgData) {
    const d = imgData.data;
    let pal = PALETTES[paletteNum];
    if (blendPalettes) {
      pal = PALETTES[0].map((c, i) => c.map((v, k) => (v + PALETTES[1][i][k]) >> 1));
    }
    let p = 0;
    for (let y = 0; y < 200; y++) {
      const base = (y & 1 ? 0x2000 : 0) + (y >> 1) * 80;
      for (let xb = 0; xb < 80; xb++) {
        const b = mem[base + xb];
        for (let s = 6; s >= 0; s -= 2) {
          const c = pal[(b >> s) & 3];
          d[p++] = c[0]; d[p++] = c[1]; d[p++] = c[2]; d[p++] = 255;
        }
      }
    }
  }

  return {
    mem, PALETTES, clear, palette, setBlend, line, peekXY, render, genTitle,
    spInit, spChnge, spPlace, spErase, spMove, spTable, spBlank, spDisp, spPut, put, isActive,
  };
})();
