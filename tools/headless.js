#!/usr/bin/env node
// Runs the port headlessly with scripted input and writes framebuffer snapshots.
//   node tools/headless.js [outdir]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(ROOT, 'tools', 'out');
fs.mkdirSync(outDir, { recursive: true });

global.window = {};
global.localStorage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
const code = ['js/assets.js', 'js/cga.js', 'js/sound.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\nthis.Digger = Digger; this.CGA = CGA; this.Sound = Sound;';
vm.runInThisContext(code);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function snap(name) {
  const img = { data: new Uint8ClampedArray(320 * 200 * 4) };
  CGA.render(img);
  png(path.join(outDir, name + '.png'), 320, 200, img.data);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SPEED = 8;
Sound.start();

(async () => {
  Digger.setSpeed(SPEED);
  Sound.init_sound && 0;
  Digger.start();
  await sleep(150);
  snap('01-title-early');
  await sleep(2600);
  snap('02-title-demo');
  Digger.keyEvent(28, true); await sleep(30); Digger.keyEvent(28, false); // any key starts the game
  await sleep(300);
  snap('03-level1-start');
  const dirs = [75, 72, 77, 80];
  let shots = 0;
  for (let step = 0; step < 400; step++) {
    const d = dirs[Math.floor(Math.random() * 4)];
    Digger.keyEvent(d, true);
    if (Math.random() < 0.2) { Digger.keyEvent(59, true); await sleep(15); Digger.keyEvent(59, false); shots++; }
    await sleep(40 + Math.random() * 60);
    Digger.keyEvent(d, false);
    if (step % 25 === 0) snap('10-play-' + String(step).padStart(3, '0'));
    if (Digger.getState() === 'title' && step > 20) { console.log('back at title after step', step); break; }
  }
  snap('99-end');
  console.log('state', Digger.getState(), 'shots', shots);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED', e); process.exit(1); });
