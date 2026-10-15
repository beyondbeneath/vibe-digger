#!/usr/bin/env node
// Renders the documentation images (level previews, title screen) with the real engine.
//   node tools/render-docs.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { writePng } = require('./png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'img');
fs.mkdirSync(OUT, { recursive: true });

global.window = {};
global.localStorage = { getItem() { return null; }, setItem() {} };
vm.runInThisContext(['js/assets.js', 'js/cga.js', 'js/sound.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\nthis.Digger = Digger; this.CGA = CGA;');

function snap(name) {
  const img = { data: new Uint8ClampedArray(320 * 200 * 4) };
  CGA.render(img);
  writePng(path.join(OUT, name + '.png'), 320, 200, img.data);
  console.log('wrote img/' + name + '.png');
}

for (let level = 1; level <= 8; level++) {
  Digger.drawLevelPreview(level);
  snap('level-' + level);
}
Digger.drawLevelPreview(1);
CGA.palette(1);
snap('level-1-bonus');
CGA.palette(0);
CGA.clear(0);
CGA.genTitle(ASSETS.title);
CGA.line(280, 199, 319, 199, 0);
snap('title-bitmap');
