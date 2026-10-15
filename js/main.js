// Page glue: draws the emulated CGA screen, maps browser keys to PC scan codes,
// and wires the on-page controls.
'use strict';

(() => {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(320, 200);
  const overlay = document.getElementById('overlay');
  const wrap = document.getElementById('screen-wrap');
  const statusEl = document.getElementById('status');

  function frame() {
    CGA.render(img);
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  }

  // KeyboardEvent.code -> IBM PC/XT set 1 scan code
  const SCAN = {
    Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9,
    Digit9: 10, Digit0: 11, Backspace: 14,
    KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21, KeyU: 22, KeyI: 23, KeyO: 24, KeyP: 25,
    Enter: 28, NumpadEnter: 28,
    KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35, KeyJ: 36, KeyK: 37, KeyL: 38,
    KeyZ: 44, KeyX: 45, KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50, Period: 52,
    Space: 57, F1: 59, F7: 65, F9: 67,
    ArrowUp: 72, Numpad8: 72, ArrowLeft: 75, Numpad4: 75, ArrowRight: 77, Numpad6: 77, ArrowDown: 80, Numpad2: 80,
  };
  // keys that also fire, for keyboards where F1 is awkward to reach
  const EXTRA_FIRE = new Set(['KeyZ', 'Enter', 'NumpadEnter']);

  let started = false;
  let screenVisible = true;
  const held = new Map();

  function start() {
    if (started) return;
    started = true;
    overlay.classList.add('hidden');
    Sound.start();
    Digger.start();
    canvas.focus();
  }

  function onKey(e, down) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const sc = SCAN[e.code];
    if (sc === undefined) return;
    if (!started) {
      if (down && screenVisible) { e.preventDefault(); start(); }
      return;
    }
    if (!screenVisible) return;
    e.preventDefault();
    if (down) held.set(e.code, sc); else held.delete(e.code);
    Digger.keyEvent(sc, down, EXTRA_FIRE.has(e.code));
    syncButtons();
  }
  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup', e => onKey(e, false));
  window.addEventListener('blur', () => {
    for (const [code, sc] of held) Digger.keyEvent(sc, false, EXTRA_FIRE.has(code));
    held.clear();
  });

  new IntersectionObserver(entries => {
    screenVisible = entries[0].intersectionRatio > 0.4;
  }, { threshold: [0, 0.4, 1] }).observe(wrap);

  overlay.addEventListener('click', start);

  // ---------- controls ----------
  const musicBtn = document.getElementById('btn-music');
  const soundBtn = document.getElementById('btn-sound');

  function tap(sc) {
    Digger.keyEvent(sc, true);
    Digger.keyEvent(sc, false);
    syncButtons();
  }
  function syncButtons() {
    musicBtn.setAttribute('aria-pressed', String(Sound.kb.music));
    soundBtn.setAttribute('aria-pressed', String(Sound.kb.sound));
  }
  musicBtn.addEventListener('click', () => { tap(65); musicBtn.blur(); });
  soundBtn.addEventListener('click', () => { tap(67); soundBtn.blur(); });

  document.getElementById('volume').addEventListener('input', e => Sound.setVolume(e.target.value / 100));
  document.getElementById('speed').addEventListener('change', e => { Digger.setSpeed(+e.target.value); e.target.blur(); });
  document.getElementById('start-level').addEventListener('change', e => { Digger.setStartLevel(+e.target.value); e.target.blur(); });
  document.getElementById('btn-full').addEventListener('click', e => {
    e.currentTarget.blur();
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen?.();
  });

  const STATE_TEXT = { title: 'TITLE', playing: 'PLAYING', paused: 'PAUSED' };
  Digger.onState(s => { statusEl.textContent = STATE_TEXT[s] || s; });

  syncButtons();
  requestAnimationFrame(frame);
})();
