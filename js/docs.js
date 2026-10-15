// Builds the generated parts of the documentation (sprite gallery, font, level maps,
// difficulty table) straight from the data extracted from the original sources.
'use strict';

(() => {
  const PAL = [
    [[0, 0, 0], [0, 170, 0], [170, 0, 0], [170, 85, 0]],
    [[0, 0, 0], [0, 170, 170], [170, 0, 170], [170, 170, 170]],
  ];
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const k of kids) n.append(k);
    return n;
  };

  // A sprite is w bytes (4 pixels each) by h lines. Pixels whose outline bits are set
  // and image bits are clear are transparent.
  function spriteCanvas(spr, scale, pal, opaque) {
    const w = spr.w * 4, h = spr.h;
    const c = el('canvas', { width: w, height: h, class: 'pixel' });
    c.style.width = w * scale + 'px';
    c.style.height = h * scale * 1.2 + 'px'; // CGA pixels are taller than wide
    const g = c.getContext('2d');
    const d = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * spr.w + (x >> 2), sh = 6 - 2 * (x & 3);
        const pix = (spr.image[i] >> sh) & 3, out = (spr.outline[i] >> sh) & 3;
        const o = (y * w + x) * 4;
        if (pix === 0 && out === 3 && !opaque) continue;
        const rgb = PAL[pal][pix];
        d.data[o] = rgb[0]; d.data[o + 1] = rgb[1]; d.data[o + 2] = rgb[2]; d.data[o + 3] = 255;
      }
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  const GROUPS = [
    ['Digger, moving right / left / up / down (three frames each)', ['r0', 'r1', 'r2', 'l0', 'l1', 'l2', 'u0', 'u1', 'u2', 'd0', 'd1', 'd2']],
    ['Digger with the fireball spent ("no cab") — shown while recharging', ['r4', 'r5', 'r6', 'l4', 'l5', 'l6', 'u4', 'u5', 'u6', 'd4', 'd5', 'd6']],
    ['Death: overturned digger, then the gravestone rising', ['f9', 'f5', 'f4', 'f3', 'f2', 'f1']],
    ['Nobbin (three frames) and squashed Nobbin', ['m0', 'm1', 'm2', 'm3']],
    ['Hobbin facing right, then left (three frames + squashed)', ['c0', 'c1', 'c2', 'c3', 'a0', 'a1', 'a2', 'a3']],
    ['Gold bag: resting, wobbling, falling, bursting', ['1', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']],
    ['Emerald and its erase block', ['cn', 'nc']],
    ['Fireball in flight, then exploding', ['15', 'k1', 'k2', 'e1', 'e2', 'e3']],
    ['Bonus cherry', ['z1']],
    ['Lives indicator: player 1, player 2, blank', ['s0', 's1', 's2']],
    ['Tunnel "bite" blanks (right, left, up, down) and bag-fall blanks', ['rt', 'lt', 'up', 'dn', 'bf', 'bd']],
    ['Dirt patterns for levels 1–8 (5×4 bytes, tiled)', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']],
    ['Placeholder / spare images', ['0', 'b3']],
  ];

  function buildGallery(pal) {
    const root = document.getElementById('sprite-gallery');
    root.textContent = '';
    const used = new Set();
    for (const [title, keys] of GROUPS) {
      const items = el('div', { class: 'items' });
      for (const k of keys) {
        const spr = ASSETS.sprites[k];
        if (!spr) continue;
        used.add(k);
        const opaque = k[0] === 'p' || k === 'nc' || k === 's2';
        items.append(el('div', { class: 'item', title: spr.file }, spriteCanvas(spr, 3, pal, opaque), k));
      }
      root.append(el('div', { class: 'group' }, el('h4', {}, title), items));
    }
    const rest = Object.keys(ASSETS.sprites).filter(k => !used.has(k));
    if (rest.length) {
      const items = el('div', { class: 'items' });
      for (const k of rest) items.append(el('div', { class: 'item' }, spriteCanvas(ASSETS.sprites[k], 3, pal), k));
      root.append(el('div', { class: 'group' }, el('h4', {}, 'Other'), items));
    }
    document.getElementById('sprite-count').textContent = Object.keys(ASSETS.sprites).length;
  }

  function fontCanvas(g, scale) {
    const w = g.w * 4, h = g.h;
    const c = el('canvas', { width: w, height: h, class: 'pixel' });
    c.style.width = w * scale + 'px';
    c.style.height = h * scale * 1.2 + 'px';
    const ctx = c.getContext('2d');
    const d = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (g.data[y * g.w + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
      const rgb = PAL[0][v ? 3 : 0], o = (y * w + x) * 4;
      d.data[o] = rgb[0]; d.data[o + 1] = rgb[1]; d.data[o + 2] = rgb[2]; d.data[o + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }
  function buildFont() {
    const root = document.getElementById('font-gallery');
    const items = el('div', { class: 'items' });
    const order = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._ ';
    for (const ch of order) {
      const g = ASSETS.font[ch];
      if (g) items.append(el('div', { class: 'item' }, fontCanvas(g, 3), ch === ' ' ? '␠' : ch));
    }
    root.append(el('div', { class: 'group' }, el('h4', {}, 'All ' + Object.keys(ASSETS.font).length + ' glyphs (12 px advance)'), items));
  }

  function buildMaps() {
    for (let lvl = 1; lvl <= 8; lvl++) {
      const holder = document.getElementById('map-' + lvl);
      if (!holder) continue;
      const grid = el('div', { class: 'map', 'aria-label': 'Level ' + lvl + ' map data' });
      for (const row of ASSETS.levels[lvl - 1]) {
        for (const ch of row) {
          const cls = ch === ' ' ? 'sp' : ch;
          grid.append(el('span', { class: cls }, ch === ' ' ? '\u00a0' : ch));
        }
      }
      holder.append(grid);
    }
  }

  function buildDifficulty() {
    const tbody = document.querySelector('#difficulty tbody');
    for (let d = 1; d <= 10; d++) {
      const levels = d < 10 ? String(d) : '10+';
      const maxOn = d === 1 ? 3 : d < 8 ? 4 : 5;
      const swap = d < 6 ? '1 in ' + (6 + d) : 'never';
      const cells = [
        levels, 5 + d, maxOn, 45 - 2 * d, 10 - d, 30 + 2 * d, '1 in ' + (16 - d), swap,
        60 + 3 * d, 250 - 20 * d, 150 - 10 * d,
      ];
      const tr = el('tr');
      cells.forEach((v, i) => tr.append(el('td', i ? { class: 'num' } : {}, String(v))));
      tbody.append(tr);
    }
  }

  function buildAiSprites() {
    const root = document.getElementById('ai-sprites');
    if (!root) return;
    for (const [k, label] of [['m0', 'Nobbin'], ['c0', 'Hobbin →'], ['a0', '← Hobbin']]) {
      root.append(el('div', { class: 'item' }, spriteCanvas(ASSETS.sprites[k], 4, 0), label));
    }
  }

  buildGallery(0);
  buildAiSprites();
  buildFont();
  buildMaps();
  buildDifficulty();
  const palToggle = document.getElementById('gallery-palette');
  if (palToggle) palToggle.addEventListener('change', e => buildGallery(+e.target.value));
})();
