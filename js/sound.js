// Port of TH.C (sound generation) and an emulation of the PC speaker hardware it drives.
//
// Hardware model:
//  * PIT channel 2 ("tone 1", set_tone/set_sound) produces a square wave of
//    1193182 / period Hz. A period of 40 (~30 kHz) is the game's "silent" value.
//  * The speaker enable bit is either held on (sn2 off), pulsed for per2 loop
//    iterations once per PIT channel 0 period (pulse mode, used for music and its
//    volume envelope), or toggled once per period (square mode).
//  * The speaker output is enable AND tone.
//  * time() runs from the timer interrupt; the interrupt is re-programmed with
//    sound2 = period << 2 so it is called at 1193182 * 4 / 65536 ~= 72.8 Hz.
'use strict';

const Sound = (() => {
  const PIT = 1193182;
  const TICK_HZ = PIT * 4 / 65536;
  const LOOP_SECONDS = 4 / 1e6; // duration of one LOOP iteration in the pulse routine (~8088)

  const NS = 1, NE = 2, NQ = 4, NH = 8, NW = 16;
  const ATTACK = 0, HOLD = 1, DECAY = 2;
  const ON = 1, OFF = 0, PULSE = 1, SQUARE = 2;
  const N = ASSETS.notes;
  const { C5, D5, E5, F5, G5, A5, B5, C6 } = N;

  const music0 = ASSETS.music.music0, music1 = ASSETS.music.music1, music2 = ASSETS.music.music2;

  // shared with the keyboard module (KEYBOARD.ASM): toggled by F9 / F7
  const kb = { sound: true, music: true };

  let sound_on = false, sound2_on = false, sn2_stat = OFF, sn2_mode = SQUARE;
  let t_period = 40, p_period = 12000, p_width = 8;
  let fall_period = 0, fall_stat = false, fall_toggle = false, fall_num = 0;
  let loose_stat = false, loose_type = 0;
  let fire_stat = false, fire_freq = 0, fire_pause = 0;
  let chase_stat = false, chase_count = 0;
  let exp_stat = false, exp_period = 0, exp_count = 0;
  let break_stat = false, break_count = 0, break_period = 0;
  let coin_stat = false;
  let coin_2_count = 0, coin_2_stat = false, coin_2_period = C5, coin_2_type = 0;
  let bug_stat = false, bug_period = 0, bug_c_1 = 0, bug_c_2 = 0;
  let dead_stat = false, dead_count = 0, dead_period = 0;
  let life_stat = false, life_count = 0;
  let end_stat = false, end_count = 0, end_loop = 0;
  let money_stat = false, money_toggle = false, money_1 = 0, money_2 = 0, money_count = 0;
  let m_pointer = 0, m_type = 0, m_count = 0, m_note = 0, m_stat = false, m_pause = false;
  let attack_level = 0, attack_rate = 0, hold_level = 0, hold_rate = 0, hold_count = 0, decay_rate = 0;
  let envelope = ATTACK, env_position = 0;
  let tick = 0;

  // hooks into the game for score_2_coin() and random numbers
  let hooks = { score_2_coin() {}, rnd(n) { return Math.floor(Math.random() * (n + 1)); } };

  // ---------- hardware state ----------
  const hw = { tone: 40, sn2on: 0, p: 32000, per2: 1 };
  function set_tone(freq) { hw.tone = freq & 0xffff; }
  function set_sound(period) { if (sound_on) hw.tone = period & 0xffff; }

  function sn2_new() {
    if (sound_on) {
      set_tone(t_period);
      if (p_period < 1000) p_period = 1000;
      hw.p = p_period;
      if (p_width < 1) p_width = 1;
      if (p_width > 50) p_width = 50;
      hw.per2 = p_width;
      sn2_on();
    }
  }
  function sn2_off() { if (sn2_stat === ON) { sn2_stat = OFF; hw.sn2on = 0; } }
  function sn2_on() {
    hw.sn2on = sn2_mode;
    if (sn2_stat === OFF && sound_on) sn2_stat = ON;
  }
  function sn2_start() { if (!sound2_on) sound2_on = true; }
  function sn2_stop() {
    if (sound2_on) sound2_on = false;
    set_sound(40);
  }

  // ---------- interrupt handler (time() in TH.C) ----------
  function time() {
    tick = (tick + 1) & 0xff;
    if (end_stat) { chk_end(); return; }
    if (kb.sound && !sound_on) { sound_on = true; kb.music = true; }
    if (!kb.sound && sound_on) { sound_on = false; set_tone(40); sn2_off(); }
    if (sound_on && !m_pause) {
      p_period = 32000;
      t_period = 40;
      if (kb.music) chk_music();
      chk_2_coin(); chk_loose(); chk_dead(); chk_break(); chk_money(); chk_coin();
      chk_explode(); chk_fire(); chk_bug(); chk_fall(); chk_life(); chk_chase();
      if (p_period === 32000 || t_period !== 40) sn2_off();
      else { sn2_on(); sn2_new(); }
      set_sound(t_period);
    }
  }

  function init_th() {
    rst_fall(); rst_loose(); rst_fire(); rst_music(); rst_chase(); rst_explode();
    rst_break(); rst_coin(); rst_2_coin(); rst_money(); rst_bug(); rst_dead(); rst_life();
  }

  // end of screen fanfare: the original blocks in a loop calling chk_end on each tick
  function rst_end() { end_stat = false; m_pause = false; }
  function snd_end_start() {
    init_th();
    m_pause = true;
    end_count = 0;
    end_loop = 20;
    end_stat = true;
  }
  function endPlaying() { return end_stat; }
  function chk_end() {
    if (sound_on) {
      switch (end_count) {
        case 0: t_period = C5; break;
        case 1: t_period = E5; break;
        case 2: t_period = G5; break;
        case 3: t_period = D5; break;
        case 4: t_period = F5; break;
        case 5: t_period = A5; break;
        case 6: t_period = E5; break;
        case 7: t_period = G5; break;
        case 8: t_period = B5; break;
        case 9: case 10: t_period = (C5 / 2) | 0; break;
      }
      p_period = t_period + 35;
      p_width = 50;
      sn2_on(); sn2_new(); set_sound(t_period);
      if (end_loop > 0) end_loop--;
      else {
        end_loop = 20;
        end_count++;
        if (end_count > 10) { rst_end(); sn2_off(); set_tone(40); }
      }
    } else {
      end_stat = false; // original: sleep(100) then stop
      m_pause = false;
    }
  }

  function init_fall() { fall_period = 1000; fall_stat = true; }
  function rst_fall() { fall_stat = false; fall_num = 0; }
  function chk_fall() {
    if (fall_stat) {
      if (fall_num < 1) {
        fall_num++;
        if (fall_toggle) t_period = fall_period;
      } else {
        fall_num = 0;
        if (fall_toggle) { fall_period += 50; fall_toggle = false; }
        else fall_toggle = true;
      }
    }
  }

  function snd_break() { break_count = 3; if (break_period < 15000) break_period = 15000; break_stat = true; }
  function rst_break() { break_stat = false; }
  function chk_break() {
    if (break_stat) {
      if (break_count) { break_count--; t_period = break_period; }
      else break_stat = false;
    }
  }

  function chk_loose() {
    if (loose_stat) {
      loose_type++;
      if (loose_type > 63) loose_type = 0;
      switch (loose_type) {
        case 0: t_period = 2000; break;
        case 16: t_period = 2500; break;
        case 32: t_period = 3000; break;
        case 48: t_period = 2500; break;
      }
    }
  }
  function init_loose() { loose_stat = true; }
  function rst_loose() { loose_stat = false; loose_type = 0; }

  function init_fire() { fire_freq = 500; fire_stat = true; }
  function rst_fire() { fire_stat = false; fire_pause = 0; }
  function chk_fire() {
    if (fire_stat) {
      if (fire_pause === 1) {
        fire_pause = 0;
        fire_freq += (fire_freq / 55) | 0;
        t_period = fire_freq + hooks.rnd(fire_freq >> 3);
        if (fire_freq > 30000) rst_fire();
      } else fire_pause++;
    }
  }

  function snd_explode() { exp_period = 1500; exp_count = 10; exp_stat = true; rst_fire(); }
  function rst_explode() { exp_stat = false; }
  function chk_explode() {
    if (exp_stat) {
      if (exp_count) { exp_period -= exp_period >> 3; t_period = exp_period; exp_count--; }
      else exp_stat = false;
    }
  }

  function init_chase() { chase_stat = true; }
  function rst_chase() { chase_stat = false; chase_count = 0; }
  function chk_chase() {
    if (chase_stat) {
      chase_count++;
      if (chase_count > 15) chase_count = 0;
      if (chase_count <= 5) t_period = 1230;
      else if (chase_count >= 8 && chase_count <= 13) t_period = 1513;
    }
  }

  function rst_coin() { coin_stat = false; }
  function snd_coin() { coin_stat = true; }
  function chk_coin() { if (coin_stat) { t_period = 1000; rst_coin(); } }

  function rst_2_coin() { coin_2_stat = false; }
  function snd_2_coin(new_flag) {
    if (new_flag) {
      switch (coin_2_period) {
        case C5: coin_2_period = D5; break;
        case D5: coin_2_period = E5; break;
        case E5: coin_2_period = F5; break;
        case F5: coin_2_period = G5; break;
        case G5: coin_2_period = A5; break;
        case A5: coin_2_period = B5; break;
        case B5: coin_2_period = C6; hooks.score_2_coin(); break;
        case C6: coin_2_period = C5; break;
      }
    } else coin_2_period = C5;
    coin_2_count = 7;
    coin_2_type = 0;
    coin_2_stat = true;
  }
  function chk_2_coin() {
    if (coin_2_stat) {
      if (coin_2_count) {
        if (coin_2_type <= 1) t_period = coin_2_period;
        coin_2_type++;
        if (coin_2_type > 7) { coin_2_type = 0; coin_2_count--; }
      } else rst_2_coin();
    }
  }

  function rst_money() { money_stat = false; }
  function snd_money() { money_1 = 500; money_2 = 4000; money_count = 30; money_toggle = false; money_stat = true; }
  function chk_money() {
    if (money_stat) {
      if (money_count) money_count--;
      else money_stat = false;
      if (money_toggle) { money_toggle = false; t_period = money_1; }
      else { money_toggle = true; t_period = money_2; }
      money_1 += money_1 >> 4;
      money_2 -= money_2 >> 4;
    }
  }

  function rst_bug() { bug_stat = false; }
  function snd_bug() { bug_c_1 = 20; bug_c_2 = 3; bug_period = 2000; bug_stat = true; }
  function chk_bug() {
    if (bug_stat) {
      if (bug_c_2) {
        if (bug_c_1) {
          if (bug_c_1 % 4 === 1) t_period = bug_period;
          if (bug_c_1 % 4 === 3) t_period = bug_period - (bug_period >> 4);
          bug_c_1--;
          bug_period -= bug_period >> 4;
        } else { bug_c_1 = 20; bug_c_2--; bug_period = 2000; }
      } else bug_stat = false;
    }
  }

  function rst_dead() { dead_stat = false; }
  function snd_dead() { dead_count = 0; dead_period = 20000; dead_stat = true; }
  function chk_dead() {
    if (dead_stat) {
      dead_count++;
      if (dead_count === 1) rst_music();
      if (dead_count >= 1 && dead_count <= 10) dead_period = 20000 - dead_count * 1000;
      if (dead_count > 10) dead_period += 500;
      if (dead_period > 30000) rst_dead();
      t_period = dead_period;
    }
  }

  function rst_life() { life_stat = false; }
  function snd_life() { life_count = 96; life_stat = true; }
  function chk_life() {
    if (life_stat) {
      if (((life_count / 3) | 0) % 2) t_period = 600 + (life_count << 2);
      life_count--;
      if (life_count < 1) life_stat = false;
    }
  }

  function rst_music() { m_stat = false; m_pointer = 0; }
  function init_music(x) {
    m_type = x;
    m_count = 0;
    m_pointer = 0;
    switch (m_type) {
      case 0: attack_level = 50; attack_rate = 20; hold_level = 20; hold_rate = 10; decay_rate = 4; break;
      case 1: attack_level = 50; attack_rate = 50; hold_level = 8; hold_rate = 15; decay_rate = 1; break;
      case 2: attack_level = 50; attack_rate = 50; hold_level = 25; hold_rate = 5; decay_rate = 1; break;
    }
    m_stat = true;
    if (x === 2) rst_dead();
  }
  function chk_music() {
    if (!m_stat) return;
    if (m_count) m_count--;
    else {
      envelope = ATTACK;
      env_position = 0;
      switch (m_type) {
        case 0:
          m_count = music0[m_pointer + 1] * 3; m_note = music0[m_pointer]; hold_count = m_count - 3;
          m_pointer += 2; if (music0[m_pointer] === 32100) m_pointer = 0;
          break;
        case 1:
          m_count = music1[m_pointer + 1] * 6; m_note = music1[m_pointer]; hold_count = 12;
          m_pointer += 2; if (music1[m_pointer] === 32100) m_pointer = 0;
          break;
        case 2:
          m_count = music2[m_pointer + 1] * 10; m_note = music2[m_pointer]; hold_count = m_count - 10;
          m_pointer += 2; if (music2[m_pointer] === 32100) m_pointer = 0;
          break;
      }
    }
    env_position++;
    sn2_mode = PULSE;
    p_period = m_note;
    if (env_position >= hold_count) envelope = DECAY;
    switch (envelope) {
      case ATTACK:
        if (p_width + attack_rate >= attack_level) { p_width = attack_level; envelope = HOLD; }
        else p_width += attack_rate;
        break;
      case HOLD:
        if (p_width - hold_rate <= hold_level) p_width = hold_level;
        else p_width -= hold_rate;
        break;
      case DECAY:
        if (p_width - decay_rate <= 1) p_width = 1;
        else p_width -= decay_rate;
        break;
    }
    if (p_width === 1) p_period = 32000;
  }

  function init_pause() { m_pause = true; }
  function rst_pause() { m_pause = false; }

  function init_sound() {
    sound_on = true;
    sound2_on = false;
    sn2_mode = SQUARE;
    p_period = 12000;
    p_width = 8;
    t_period = 40;
    sn2_stat = ON;
    sn2_off();
    init_th();
    sn2_start();
  }

  // ---------- audio output ----------
  let ctx = null, node = null, running = false;
  let tickAcc = 0, tonePhase = 0, pPhase = 0, sqState = 1, fallbackTimer = null, lastFallback = 0;
  let dc = 0, lp = 0;
  let volume = 0.25;

  function speakerSample(dt) {
    let enable = 1;
    if (hw.sn2on === PULSE) {
      const period = hw.p / PIT;
      pPhase += dt;
      if (pPhase >= period) pPhase %= period;
      enable = pPhase < hw.per2 * LOOP_SECONDS ? 1 : 0;
    } else if (hw.sn2on === SQUARE) {
      const period = hw.p / PIT;
      pPhase += dt;
      if (pPhase >= period) { pPhase %= period; sqState ^= 1; }
      enable = sqState;
    }
    let tone;
    const f = PIT / (hw.tone || 65536);
    if (f > 15000) tone = 0.5; // far above audibility: the cone just sits at the average
    else {
      tonePhase += dt * f;
      tonePhase -= Math.floor(tonePhase);
      tone = tonePhase < 0.5 ? 1 : 0;
    }
    return enable * tone;
  }

  function process(e) {
    const out = e.outputBuffer.getChannelData(0);
    const sr = ctx.sampleRate, dt = 1 / sr, ticksPerSample = TICK_HZ / sr;
    for (let i = 0; i < out.length; i++) {
      tickAcc += ticksPerSample;
      if (tickAcc >= 1) { tickAcc -= 1; if (sound2_on || end_stat) time(); }
      const s = speakerSample(dt);
      dc += (s - dc) * 0.0015;           // DC blocker
      lp += ((s - dc) - lp) * 0.45;      // gentle low pass to soften aliasing
      out[i] = lp * volume;
    }
  }

  function fallbackTick() {
    const now = performance.now();
    let n = Math.floor((now - lastFallback) * TICK_HZ / 1000);
    if (n > 50) n = 50;
    if (n > 0) {
      lastFallback += n * 1000 / TICK_HZ;
      while (n--) if (sound2_on || end_stat) time();
    }
    if (now - lastFallback > 1000) lastFallback = now;
  }

  function start() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try {
          ctx = new AC();
          node = ctx.createScriptProcessor(1024, 0, 1);
          node.onaudioprocess = process;
          node.connect(ctx.destination);
        } catch (err) { ctx = null; }
      }
      lastFallback = performance.now();
      fallbackTimer = setInterval(() => { if (!running) fallbackTick(); }, 10);
    }
    if (ctx && ctx.state !== 'running') ctx.resume();
    running = !!ctx && ctx.state === 'running';
    if (ctx) ctx.onstatechange = () => { running = ctx.state === 'running'; lastFallback = performance.now(); };
  }

  function setVolume(v) { volume = v; }

  return {
    kb, start, setVolume, init_sound, init_th, init_music, rst_music, init_pause, rst_pause,
    init_fall, rst_fall, init_loose, rst_loose, init_fire, rst_fire, snd_explode, init_chase, rst_chase,
    snd_break, snd_coin, snd_2_coin, snd_money, snd_bug, snd_dead, snd_life, snd_end_start, endPlaying,
    set_sound, set_tone, sn2_off, sn2_start, sn2_stop,
    setHooks(h) { hooks = Object.assign(hooks, h); },
    getTick() { return tick; },
    isMusicOn() { return kb.music; },
  };
})();
