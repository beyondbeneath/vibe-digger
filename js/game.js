// Port of the DIGGER game modules (Work/TA.C ... TZ.C, Source/IMAGE.C, IMAGE_B.C, CLIB.C).
// Function and variable names follow the original C so the two can be read side by side.
// Blocking busy-wait loops in the original become async functions that await timers.
'use strict';

const Digger = (() => {
  // ======================= DIGGER.H =======================
  const X_LAST = 292, X_FIRST = 12, Y_LAST = 180, Y_FIRST = 18;
  const X_OFFSET = 12, Y_OFFSET = 18, H_MAX = 10, W_MAX = 15;
  const LEFT = 4, RIGHT = 0, UP = 2, DOWN = 6, STOP = -1;
  const FALL_1 = 10, FALL_2 = 11, FALL_3 = 12, FALL_4 = 13, FALL_5 = 14, FALL_9 = 15;
  const M_X_START = 7, M_Y_START = 9;
  const GREEN = 1, RED = 2, BROWN = 3, WHITE = 3;
  const MONEY_BAG = 1, MAN = 2, BUG = 3, DEAD = 4, BOUNCE = 5;
  const BAG_0 = 0, BAG_4 = 1, BAG_5 = 2, BAG_6 = 3, BAG_7 = 4, BAG_8 = 5, BAG_9 = 6;
  const ADVANCING = 0, NORMAL = 1;
  const FALSE = false, TRUE = true;

  const S = ASSETS.sprites;
  const FONT = ASSETS.font;
  const snd = Sound;

  // ======================= timing =======================
  // sleep(1) in CUTIL.C is a 100 iteration busy loop; FRAME_MS is one pass of the
  // main game loop (task_c, task_a, task_b plus the constant-speed delay).
  const BASE_FRAME_MS = 66, BASE_SLEEP_MS = 0.8;
  const timing = { frameMs: BASE_FRAME_MS, sleepMs: BASE_SLEEP_MS };
  let lastFrame = 0;

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function sleep(n) { return wait(n * timing.sleepMs); }
  // sleep(n) that returns early once a key goes down
  async function sleepUntilKey(n) {
    const until = performance.now() + n * timing.sleepMs;
    while (performance.now() < until) {
      if (kb.keychr && !(kb.keychr & 0x80)) return;
      await wait(Math.max(0, Math.min(8, until - performance.now())));
    }
  }
  function setSpeed(factor) {
    timing.frameMs = BASE_FRAME_MS / factor;
    timing.sleepMs = BASE_SLEEP_MS / factor;
  }
  async function frameWait() {
    const now = performance.now();
    let next = lastFrame + timing.frameMs;
    if (next < now - timing.frameMs) next = now;
    lastFrame = next;
    if (next > now) await wait(next - now);
  }

  // ======================= KEYBOARD.ASM =======================
  const kb = {
    keychr: 0, keydir: STOP, lkdir: STOP, fire: false, fires: false, endgame: false,
    L: false, R: false, U: false, D: false,
    mscUp: true, sndUp: true,
  };

  function keychk() {
    kb.keydir = STOP;
    if (kb.U) kb.keydir = kb.lkdir = UP;
    if (kb.D) kb.keydir = kb.lkdir = DOWN;
    if (kb.L) kb.keydir = kb.lkdir = LEFT;
    if (kb.R) kb.keydir = kb.lkdir = RIGHT;
  }

  // scan codes are IBM PC set 1; key up is the scan code | 0x80
  function keyEvent(sc, down, extraFire) {
    kb.keychr = down ? sc : (sc | 0x80);
    if (extraFire) { if (down) { kb.fires = true; kb.fire = true; } else kb.fire = false; }
    switch (sc) {
      case 75: if (down) { kb.L = true; kb.keydir = kb.lkdir = LEFT; } else { kb.L = false; if (kb.keydir === LEFT) keychk(); } break;
      case 77: if (down) { kb.R = true; kb.keydir = kb.lkdir = RIGHT; } else { kb.R = false; if (kb.keydir === RIGHT) keychk(); } break;
      case 72: if (down) { kb.U = true; kb.keydir = kb.lkdir = UP; } else { kb.U = false; if (kb.keydir === UP) keychk(); } break;
      case 80: if (down) { kb.D = true; kb.keydir = kb.lkdir = DOWN; } else { kb.D = false; if (kb.keydir === DOWN) keychk(); } break;
      case 59: if (down) { kb.fires = true; kb.fire = true; } else kb.fire = false; break;
      case 65: if (down) { if (kb.mscUp) { snd.kb.music = !snd.kb.music; kb.mscUp = false; } } else kb.mscUp = true; break;
      case 67: if (down) { if (kb.sndUp) { snd.kb.sound = !snd.kb.sound; kb.sndUp = false; } } else kb.sndUp = true; break;
      case 1: if (down) kb.endgame = true; break;
    }
  }

  // ======================= CLIB.C =======================
  const rnd_table = ASSETS.rndTable;
  let rnd_seed = 0;
  // BIOS tick count low byte; the sound interrupt chains to it at ~72.8 Hz
  function timer() { return Math.floor(performance.now() * 0.0728) & 255; }
  function rnd(range) {
    const n = (++rnd_seed + timer()) & 255;
    return ((rnd_table[n] * (range + 1)) >> 8) & 255;
  }

  function printc(chr, x, y, color) {
    const g = FONT[chr];
    if (g) CGA.put(x, y, g, color);
  }
  function prints(string, x, y, color) {
    for (const ch of string) { printc(ch, x, y, color); x += 12; }
  }
  function printd(digit, x, y, color) { printc(String(digit), x, y, color); }
  function println(number, x, y, length, color) {
    let x_loc = (length - 1) * 12 + x;
    for (; length > 0; length--, x_loc -= 12) {
      const num = number % 10;
      if (length > 1 || num) printd(num, x_loc, y, color);
      number = Math.floor(number / 10);
    }
  }

  // ======================= IMAGE.C / IMAGE_B.C =======================
  const bug_count = [0, 0, 0, 0, 0, 0], bug_inc = [1, 1, 1, 1, 1, 1];
  let man_count = 0, man_inc = 1, mis_num = 0;

  function init_images() {
    for (let n = 1; n <= 7; n++) CGA.spInit(n, S['1']);
    for (let n = 8; n <= 13; n++) CGA.spInit(n, S.m0);
    init_b_images();
    for (let i = 0; i < 6; i++) { bug_count[i] = 0; bug_inc[i] = 1; }
  }
  function rst_images() {
    for (let n = 1; n <= 7; n++) CGA.spChnge(n, S['1']);
    for (let n = 8; n <= 13; n++) CGA.spChnge(n, S.m0);
    rst_b_images();
  }
  function init_b_images() {
    mis_num = 0; man_count = 0; man_inc = 1;
    CGA.spInit(0, S['0']);
    CGA.spInit(14, S.z1);
    CGA.spInit(15, S['15']);
  }
  function rst_b_images() {
    mis_num = 0; man_count = 0; man_inc = 1;
    CGA.spChnge(0, S['0']);
    CGA.spChnge(14, S.z1);
    CGA.spChnge(15, S['15']);
  }

  function draw_bug(bug_num, bug_type, bug_dir, x, y) {
    bug_count[bug_num] += bug_inc[bug_num];
    if (bug_count[bug_num] === 2 || bug_count[bug_num] === 0) bug_inc[bug_num] = -bug_inc[bug_num];
    if (bug_count[bug_num] > 2) bug_count[bug_num] = 2;
    if (bug_count[bug_num] < 0) bug_count[bug_num] = 0;
    const c = bug_count[bug_num];
    if (bug_type === ADVANCING) {
      if (bug_dir === RIGHT) CGA.spChnge(bug_num + 8, S['c' + c]);
      else if (bug_dir === LEFT) CGA.spChnge(bug_num + 8, S['a' + c]);
    } else CGA.spChnge(bug_num + 8, S['m' + c]);
    return CGA.spMove(bug_num + 8, x, y);
  }
  function draw_dead_bug(bug_num, bug_type, bug_dir, x, y) {
    if (bug_type === ADVANCING) {
      if (bug_dir === RIGHT) CGA.spChnge(bug_num + 8, S.c3);
      else if (bug_dir === LEFT) CGA.spChnge(bug_num + 8, S.a3);
    } else CGA.spChnge(bug_num + 8, S.m3);
    return CGA.spMove(bug_num + 8, x, y);
  }
  const BAG_SPRITES = ['1', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
  function draw_bag(bag_num, bag_type, x, y) {
    const spr = S[BAG_SPRITES[bag_type]];
    CGA.spChnge(bag_num, spr);
    return CGA.spMove(bag_num, x, y + (bag_type >= BAG_7 ? S['1'].h - spr.h : 0));
  }
  function put_man(stat, x, y) { CGA.spPut(x, y, S['s' + stat]); }
  function put_coin(x, y) { CGA.spBlank(x, y, S.cn.w, S.cn.h); CGA.spPut(x, y, S.cn); CGA.spDisp(); }
  function rem_coin(x, y) { CGA.spBlank(x, y, S.nc.w, S.nc.h); CGA.spPut(x, y, S.nc); CGA.spDisp(); }

  function blankPut(x, y, spr) { CGA.spBlank(x, y, spr.w, spr.h); CGA.spPut(x, y, spr); CGA.spDisp(); }
  function era_right(x, y) { blankPut(x + 16, y - 1, S.rt); }
  function era_left(x, y) { blankPut(x - 8, y - 1, S.lt); }
  function era_up(x, y) { blankPut(x - 4, y - 6, S.up); }
  function era_down(x, y) { blankPut(x - 4, y + 15, S.dn); }
  function era_b_down(x, y) { blankPut(x - 4, y + 15, S.bd); }
  function era_b_first(x, y) { blankPut(x - 4, y + 17, S.bf); }

  function draw_background(lev) {
    const p = S['p' + lev];
    for (let y = 14; y < 200; y += 4) for (let x = 0; x < 320; x += 20) CGA.spPut(x, y, p);
  }
  function draw_missile(x, y, mis_type) {
    switch (mis_type) {
      case 0:
        mis_num++;
        if (mis_num > 2) mis_num = 0;
        CGA.spChnge(15, [S['15'], S.k1, S.k2][mis_num]);
        return CGA.spMove(15, x, y);
      case 1: CGA.spChnge(15, S.e1); CGA.spMove(15, x, y); break;
      case 2: CGA.spChnge(15, S.e2); CGA.spMove(15, x, y); break;
      case 3: CGA.spChnge(15, S.e3); CGA.spMove(15, x, y); break;
    }
    return 0;
  }
  function draw_bonus(x, y) { CGA.spChnge(14, S.z1); CGA.spPlace(14, x, y); }

  const MAN_PREFIX = { [RIGHT]: 'r', [LEFT]: 'l', [UP]: 'u', [DOWN]: 'd' };
  function draw_man(dir, x, y, cab) {
    man_count += man_inc;
    if (man_count === 2 || man_count === 0) man_inc = -man_inc;
    if (man_count > 2) man_count = 2;
    if (man_count < 0) man_count = 0;
    if (dir in MAN_PREFIX) CGA.spChnge(0, S[MAN_PREFIX[dir] + (cab ? man_count : man_count + 4)]);
    else if (dir >= FALL_1 && dir <= FALL_5) CGA.spChnge(0, S['f' + (dir - FALL_1 + 1)]);
    else if (dir === FALL_9) CGA.spChnge(0, S.f9);
    else return 0; // STOP: nothing is redrawn
    return CGA.spMove(0, x, y);
  }

  // ======================= TA.C - bug movement =======================
  const BUG_ACTIVE = 0, BUG_X = 1, BUG_Y = 2, BUG_X_POS = 3, BUG_Y_POS = 4, BUG_X_REM = 5, BUG_Y_REM = 6,
    BUG_DIR = 7, BUG_OLD_DIR = 8, BUG_WAIT = 9, BUG_ALIVE = 10, BUG_TYPE = 11, BUG_STUCK = 12,
    DEAD_TYPE = 13, DEAD_NUM = 14, DEAD_WAIT = 15, BUG_BEGIN = 16;
  const bug = Array.from({ length: 6 }, () => new Array(20).fill(0));
  let wait_flag = false;
  let bugs_created = 0, bugs_total = 0, bugs_max = 0, bugs_delay = 0, start_delay = 0, bonus_ready = false;

  function init_ta() {
    for (let b = 0; b < 6; b++) bug[b][BUG_ACTIVE] = FALSE;
    start_delay = 45 - (get_dificulty() << 1);
    bugs_created = 0;
    bugs_total = 5 + get_dificulty();
    const d = get_dificulty();
    bugs_max = d === 1 ? 3 : d <= 7 ? 4 : 5;
    bugs_delay = 10;
    bonus_ready = TRUE;
  }
  function end_ta() {
    for (let b = 0; b < 6; b++) if (bug[b][BUG_ACTIVE]) CGA.spErase(b + 8);
  }
  function task_a() {
    if (bugs_delay > 0) bugs_delay--;
    else {
      if (bugs_created < bugs_total && bugs_count() < bugs_max && get_m_status() && !get_bonus()) start_bug();
      if (bonus_ready && bugs_created === bugs_total && bugs_delay === 0 && get_m_status()) {
        bonus_ready = FALSE;
        begin_bonus(1);
      }
    }
    for (let b = 0; b < 6; b++) {
      if (!bug[b][BUG_ACTIVE]) continue;
      if (bug[b][BUG_STUCK] > 10 - get_dificulty() && bug[b][BUG_TYPE] === NORMAL) {
        bug[b][BUG_STUCK] = 0;
        bug[b][BUG_TYPE] = ADVANCING;
      }
      if (bug[b][BUG_ALIVE]) {
        if (!bug[b][BUG_WAIT]) {
          move_bug(b);
          if (bug[b][BUG_ALIVE] && rnd(15 - get_dificulty()) === 0 && bug[b][BUG_TYPE] !== ADVANCING) move_bug(b);
        } else bug[b][BUG_WAIT]--;
      } else move_dead_bug(b);
    }
  }
  function start_bug() {
    for (let b = 0; b < 6; b++) {
      if (bug[b][BUG_ACTIVE]) continue;
      const g = bug[b];
      g[BUG_ACTIVE] = TRUE; g[BUG_ALIVE] = TRUE; g[BUG_WAIT] = 0; g[BUG_TYPE] = NORMAL; g[BUG_STUCK] = 0;
      g[BUG_X_POS] = 14; g[BUG_Y_POS] = 0; g[BUG_X] = 14 * 20 + X_OFFSET; g[BUG_Y] = Y_OFFSET;
      g[BUG_X_REM] = 0; g[BUG_Y_REM] = 0; g[BUG_DIR] = LEFT; g[BUG_OLD_DIR] = LEFT;
      bugs_created++;
      bugs_delay = start_delay;
      g[BUG_BEGIN] = 5;
      CGA.spPlace(b + 8, g[BUG_X], g[BUG_Y]);
      break;
    }
  }

  function move_bug(n) {
    const g = bug[n];
    const bug_x_old = g[BUG_X], bug_y_old = g[BUG_Y];
    let dir, dir_1, dir_2, dir_3, dir_4, temp;

    if (g[BUG_X_REM] === 0 && g[BUG_Y_REM] === 0) {
      if (g[BUG_STUCK] > 30 + get_dificulty() * 2 && g[BUG_TYPE] === ADVANCING) {
        g[BUG_STUCK] = 0;
        g[BUG_TYPE] = NORMAL;
      }
      if (Math.abs(get_m_y() - g[BUG_Y]) > Math.abs(get_m_x() - g[BUG_X])) {
        if (get_m_y() < g[BUG_Y]) { dir_1 = UP; dir_4 = DOWN; } else { dir_1 = DOWN; dir_4 = UP; }
        if (get_m_x() < g[BUG_X]) { dir_2 = LEFT; dir_3 = RIGHT; } else { dir_2 = RIGHT; dir_3 = LEFT; }
      } else {
        if (get_m_x() < g[BUG_X]) { dir_1 = LEFT; dir_4 = RIGHT; } else { dir_1 = RIGHT; dir_4 = LEFT; }
        if (get_m_y() < g[BUG_Y]) { dir_2 = UP; dir_3 = DOWN; } else { dir_2 = DOWN; dir_3 = UP; }
      }
      if (get_bonus()) {
        temp = dir_1; dir_1 = dir_4; dir_4 = temp;
        temp = dir_2; dir_2 = dir_3; dir_3 = temp;
      }
      dir = get_rev(g[BUG_DIR]);
      if (dir === dir_1) { dir_1 = dir_2; dir_2 = dir_3; dir_3 = dir_4; dir_4 = dir; }
      if (dir === dir_2) { dir_2 = dir_3; dir_3 = dir_4; dir_4 = dir; }
      if (dir === dir_3) { dir_3 = dir_4; dir_4 = dir; }
      if (rnd(5 + get_dificulty()) === 1 && get_dificulty() < 6) { temp = dir_1; dir_1 = dir_3; dir_3 = temp; }
      if (back_check(dir_1, g[BUG_X_POS], g[BUG_Y_POS])) dir = dir_1;
      else if (back_check(dir_2, g[BUG_X_POS], g[BUG_Y_POS])) dir = dir_2;
      else if (back_check(dir_3, g[BUG_X_POS], g[BUG_Y_POS])) dir = dir_3;
      else if (back_check(dir_4, g[BUG_X_POS], g[BUG_Y_POS])) dir = dir_4;
      if (g[BUG_TYPE] === ADVANCING) dir = dir_1;
      if (g[BUG_DIR] !== dir) g[BUG_WAIT]++;
      g[BUG_DIR] = dir;
    }

    if ((g[BUG_X] === X_LAST && g[BUG_DIR] === RIGHT) || (g[BUG_X] === X_FIRST && g[BUG_DIR] === LEFT) ||
        (g[BUG_Y] === Y_LAST && g[BUG_DIR] === DOWN) || (g[BUG_Y] === Y_FIRST && g[BUG_DIR] === UP)) g[BUG_DIR] = STOP;

    if (g[BUG_DIR] === LEFT || g[BUG_DIR] === RIGHT) g[BUG_OLD_DIR] = g[BUG_DIR];

    if (g[BUG_TYPE] === ADVANCING) era_background(g[BUG_X], g[BUG_Y], g[BUG_DIR]);
    switch (g[BUG_DIR]) {
      case RIGHT: if (g[BUG_TYPE] === ADVANCING) era_right(g[BUG_X], g[BUG_Y]); g[BUG_X] += 4; break;
      case LEFT: if (g[BUG_TYPE] === ADVANCING) era_left(g[BUG_X], g[BUG_Y]); g[BUG_X] -= 4; break;
      case UP: if (g[BUG_TYPE] === ADVANCING) era_up(g[BUG_X], g[BUG_Y]); g[BUG_Y] -= 3; break;
      case DOWN: if (g[BUG_TYPE] === ADVANCING) era_down(g[BUG_X], g[BUG_Y]); g[BUG_Y] += 3; break;
    }
    if (g[BUG_TYPE] === ADVANCING) {
      coin_check(((g[BUG_X] - X_OFFSET) / 20) | 0, ((g[BUG_Y] - Y_OFFSET) / 18) | 0,
        (g[BUG_X] - X_OFFSET) % 20, (g[BUG_Y] - Y_OFFSET) % 18, g[BUG_DIR]);
    }
    if (!get_m_status()) { g[BUG_X] = bug_x_old; g[BUG_Y] = bug_y_old; }
    if (g[BUG_BEGIN]) { g[BUG_BEGIN]--; g[BUG_X] = bug_x_old; g[BUG_Y] = bug_y_old; }

    if (g[BUG_TYPE] === ADVANCING && g[BUG_STUCK] < 100) g[BUG_STUCK]++;

    let flag = TRUE;
    const colision = draw_bug(n, g[BUG_TYPE], g[BUG_OLD_DIR], g[BUG_X], g[BUG_Y]);
    inc_plot();
    if (colision & 0x3f00) {
      g[BUG_WAIT]++;
      dir_change(n, colision);
      inc_extra(colision);
    }
    if (colision & 0xfe & get_active_bags()) {
      g[BUG_WAIT]++;
      wait_flag = FALSE;
      if (g[BUG_DIR] === LEFT || g[BUG_DIR] === RIGHT) {
        flag = move_all_bags(g[BUG_DIR], colision);
        g[BUG_WAIT]++;
      } else if (!money_check(colision)) flag = FALSE;
      if (wait_flag) g[BUG_WAIT] = 0;
      if (g[BUG_TYPE] === ADVANCING && g[BUG_STUCK] > 1) break_bags(colision);
    }
    if (g[BUG_TYPE] === NORMAL && (colision & 0x3f00) && get_m_status()) g[BUG_STUCK]++;

    if (!flag) {
      g[BUG_X] = bug_x_old; g[BUG_Y] = bug_y_old;
      draw_bug(n, g[BUG_TYPE], g[BUG_OLD_DIR], g[BUG_X], g[BUG_Y]);
      inc_plot();
      if (g[BUG_TYPE] === NORMAL) g[BUG_STUCK]++;
      if ((g[BUG_DIR] === UP || g[BUG_DIR] === DOWN) && g[BUG_TYPE] === NORMAL) g[BUG_DIR] = get_rev(g[BUG_DIR]);
    }
    if ((colision & 0x01) && get_m_status()) {
      if (get_bonus()) { era_bug(n); bonus_score(); snd.snd_bug(); }
      else kill_man(BUG, 0);
    }
    g[BUG_X_POS] = ((g[BUG_X] - X_OFFSET) / 20) | 0;
    g[BUG_Y_POS] = ((g[BUG_Y] - Y_OFFSET) / 18) | 0;
    g[BUG_X_REM] = (g[BUG_X] - X_OFFSET) % 20;
    g[BUG_Y_REM] = (g[BUG_Y] - Y_OFFSET) % 18;
  }

  function move_dead_bug(n) {
    const g = bug[n];
    switch (g[DEAD_TYPE]) {
      case MONEY_BAG:
        if (get_y_bag(g[DEAD_NUM]) + 6 > g[BUG_Y]) g[BUG_Y] = get_y_bag(g[DEAD_NUM]);
        draw_dead_bug(n, g[BUG_TYPE], g[BUG_OLD_DIR], g[BUG_X], g[BUG_Y]);
        inc_plot();
        if (get_d_bag(g[DEAD_NUM]) === STOP) { g[DEAD_WAIT] = 1; g[DEAD_TYPE] = DEAD; }
        break;
      case DEAD:
        if (g[DEAD_WAIT]) { g[DEAD_WAIT]--; break; }
        era_bug(n);
        score_bug();
        break;
    }
  }
  function inc_extra(colision) {
    for (let i = 0, mask = 0x100; i < 6; i++, mask <<= 1) if (colision & mask) inc_plot();
  }
  function dir_change(n, colision) {
    for (let i = 0, mask = 0x100; i < 6; i++, mask <<= 1) {
      if ((colision & mask) && bug[n][BUG_DIR] === bug[i][BUG_DIR] && bug[i][BUG_BEGIN] === 0 && bug[n][BUG_BEGIN] === 0)
        bug[i][BUG_DIR] = get_rev(bug[i][BUG_DIR]);
    }
  }
  function back_check(dir, x_pos, y_pos) {
    switch (dir) {
      case RIGHT:
        return x_pos < W_MAX - 1 && (get_background(x_pos + 1, y_pos) & 0x2000) === 0 &&
          ((get_background(x_pos + 1, y_pos) & 0x1) === 0 || (get_background(x_pos, y_pos) & 0x10) === 0);
      case LEFT:
        return x_pos > 0 && (get_background(x_pos - 1, y_pos) & 0x2000) === 0 &&
          ((get_background(x_pos - 1, y_pos) & 0x10) === 0 || (get_background(x_pos, y_pos) & 0x1) === 0);
      case UP:
        return y_pos > 0 && (get_background(x_pos, y_pos - 1) & 0x2000) === 0 &&
          ((get_background(x_pos, y_pos - 1) & 0x800) === 0 || (get_background(x_pos, y_pos) & 0x40) === 0);
      case DOWN:
        return y_pos < H_MAX - 1 && (get_background(x_pos, y_pos + 1) & 0x2000) === 0 &&
          ((get_background(x_pos, y_pos + 1) & 0x40) === 0 || (get_background(x_pos, y_pos) & 0x800) === 0);
    }
    return FALSE;
  }
  function save_bugs(x_pos) {
    for (let b = 0; b < 6; b++) if (bug[b][BUG_X_POS] === x_pos && bug[b][BUG_DIR] === UP) bug[b][BUG_DIR] = DOWN;
  }
  function era_bug(n) {
    if (bug[n][BUG_ACTIVE]) {
      bug[n][BUG_ACTIVE] = FALSE;
      bug[n][BUG_ALIVE] = FALSE;
      CGA.spErase(n + 8);
      if (get_bonus()) bugs_total++;
    }
  }
  function bag_bugs(bag_num, colision) {
    for (let b = 0, mask = 0x100; b < 6; b++, mask <<= 1)
      if ((colision & mask) && bug[b][BUG_Y] >= get_y_bag(bag_num)) kill_bug(b, MONEY_BAG, bag_num);
  }
  function rem_bugs(colision) {
    let stat = 0;
    for (let b = 0, mask = 0x100; b < 6; b++, mask <<= 1) if (colision & mask) { era_bug(b); stat++; }
    return stat;
  }
  function kill_bug(n, d_type, num) { bug[n][BUG_ALIVE] = FALSE; bug[n][DEAD_TYPE] = d_type; bug[n][DEAD_NUM] = num; }
  function bugs_left() { return bugs_count() + bugs_total - bugs_created; }
  function bugs_count() { let a = 0; for (let b = 0; b < 6; b++) if (bug[b][BUG_ACTIVE]) a++; return a; }
  function delay_bugs(a) {
    if (a > 6) a = 6;
    for (let i = 1; i < a; i++) bug[i][BUG_WAIT]++;
  }
  function rst_bwait() { wait_flag = TRUE; }

  // ======================= TB.C - money bags =======================
  const DROP_WAIT = 15;
  const BAG_X = 0, BAG_Y = 1, BAG_X_POS = 2, BAG_Y_POS = 3, BAG_X_REM = 4, BAG_Y_REM = 5, BAG_DIR = 6,
    BAG_LOOSE = 7, BAG_COUNT = 8, BAG_FIRST = 9, BAG_ACTIVE = 10, BAG_BROKEN = 11, BAG_BRAKABLE = 12;
  const mk = () => Array.from({ length: 8 }, () => new Array(20).fill(0));
  const bags_0 = mk(), bags_1 = mk(), bags = mk();
  let bag_wait = 0, broke_max = 0;

  function init_tb() {
    bag_wait = 0;
    broke_max = 150 - get_dificulty() * 10;
    for (let b = 1; b < 8; b++) bags[b][BAG_ACTIVE] = FALSE;
    let bag_num = 1;
    for (let x_pos = 0; x_pos < W_MAX; x_pos++) {
      for (let y_pos = 0; y_pos < H_MAX; y_pos++) {
        if (get_mat(x_pos, y_pos, get_screen()) === 'B' && bag_num < 8) {
          const g = bags[bag_num];
          g[BAG_ACTIVE] = TRUE; g[BAG_BROKEN] = 0; g[BAG_BRAKABLE] = 0; g[BAG_DIR] = STOP;
          g[BAG_LOOSE] = FALSE; g[BAG_COUNT] = DROP_WAIT; g[BAG_FIRST] = TRUE;
          g[BAG_X] = x_pos * 20 + X_OFFSET; g[BAG_Y] = y_pos * 18 + Y_OFFSET;
          g[BAG_X_POS] = x_pos; g[BAG_Y_POS] = y_pos; g[BAG_X_REM] = 0; g[BAG_Y_REM] = 0;
          bag_num++;
        }
      }
    }
    const store = get_player() === 0 ? bags_0 : bags_1;
    for (let b = 1; b < 8; b++) for (let i = 0; i < 20; i++) store[b][i] = bags[b][i];
  }
  function start_tb() {
    const store = get_player() === 0 ? bags_0 : bags_1;
    for (let b = 1; b < 8; b++) {
      for (let i = 0; i < 20; i++) bags[b][i] = store[b][i];
      if (bags[b][BAG_ACTIVE]) CGA.spPlace(b, bags[b][BAG_X], bags[b][BAG_Y]);
    }
  }
  function end_tb() {
    snd.rst_fall();
    const store = get_player() === 0 ? bags_0 : bags_1;
    for (let b = 1; b < 8; b++) {
      const g = bags[b];
      if ((g[BAG_X_POS] === M_X_START && g[BAG_Y_POS] === M_Y_START) || g[BAG_X_REM] || g[BAG_Y_REM] ||
          g[BAG_BROKEN] || g[BAG_BRAKABLE] || g[BAG_LOOSE]) {
        if (g[BAG_ACTIVE]) { g[BAG_ACTIVE] = FALSE; CGA.spErase(b); }
      }
      for (let i = 0; i < 20; i++) store[b][i] = g[i];
    }
  }
  function task_b() {
    for (let b = 1; b < 8; b++) {
      const g = bags[b];
      if (!g[BAG_ACTIVE]) continue;
      if (g[BAG_BROKEN]) {
        if (g[BAG_BROKEN] === 1) { snd.snd_break(); draw_bag(b, BAG_7, g[BAG_X], g[BAG_Y]); inc_plot(); }
        if (g[BAG_BROKEN] === 3) { draw_bag(b, BAG_8, g[BAG_X], g[BAG_Y]); inc_plot(); }
        if (g[BAG_BROKEN] === 5) { draw_bag(b, BAG_9, g[BAG_X], g[BAG_Y]); inc_plot(); }
        g[BAG_BROKEN]++;
        if (g[BAG_BROKEN] === broke_max) era_bag(b);
        else if (g[BAG_Y_POS] < H_MAX - 1 && g[BAG_BROKEN] < broke_max - 10) {
          if ((get_background(g[BAG_X_POS], g[BAG_Y_POS] + 1) & 0x2000) === 0) g[BAG_BROKEN] = broke_max - 10;
        }
      } else check_bag(b);
    }
    let flagf = TRUE, flagl = TRUE;
    for (let b = 1; b < 8; b++) {
      if (bags[b][BAG_DIR] === DOWN && bags[b][BAG_ACTIVE]) flagf = FALSE;
      if (bags[b][BAG_LOOSE] && bags[b][BAG_DIR] !== DOWN && bags[b][BAG_ACTIVE]) flagl = FALSE;
    }
    if (flagf) snd.rst_fall();
    if (flagl) snd.rst_loose();
  }
  function check_bag(b) {
    const g = bags[b];
    const x = g[BAG_X], x_pos = g[BAG_X_POS], x_rem = g[BAG_X_REM];
    const y = g[BAG_Y], y_pos = g[BAG_Y_POS], y_rem = g[BAG_Y_REM];
    switch (g[BAG_DIR]) {
      case STOP:
        if (y < Y_LAST && x_rem === 0) {
          if (g[BAG_LOOSE]) {
            if (!g[BAG_COUNT]) { g[BAG_DIR] = DOWN; snd.init_fall(); }
            else {
              g[BAG_COUNT]--;
              switch (g[BAG_COUNT] % 8) {
                case 0: draw_bag(b, BAG_4, x, y); inc_plot(); snd.init_loose(); break;
                case 2: draw_bag(b, BAG_0, x, y); inc_plot(); snd.init_loose(); break;
                case 4: draw_bag(b, BAG_5, x, y); inc_plot(); snd.init_loose(); break;
                case 6: draw_bag(b, BAG_0, x, y); inc_plot(); snd.init_loose(); break;
              }
            }
          } else if ((get_background(x_pos, y_pos + 1) & 0xfdf) !== 0xfdf && !get_man_block(x_pos, y_pos + 1)) {
            g[BAG_LOOSE] = TRUE;
          }
        } else {
          g[BAG_COUNT] = DROP_WAIT;
          g[BAG_LOOSE] = FALSE;
        }
        break;
      case LEFT:
      case RIGHT:
        if (x_rem === 0 && y < Y_LAST) {
          if ((get_background(x_pos, y_pos + 1) & 0xfdf) !== 0xfdf) {
            g[BAG_DIR] = DOWN;
            g[BAG_COUNT] = 0;
            snd.init_fall();
          } else stop_bag(b);
        }
        if (x_rem === 0 && y >= Y_LAST) stop_bag(b);
        break;
      case DOWN:
        if (y_rem === 0) g[BAG_BRAKABLE]++;
        if (y >= Y_LAST) stop_bag(b);
        else if ((get_background(x_pos, y_pos + 1) & 0xfdf) === 0xfdf && y_rem === 0) stop_bag(b);
        save_bugs(g[BAG_X_POS]);
        break;
    }
    if (g[BAG_DIR] !== STOP) {
      if (g[BAG_DIR] !== DOWN && bag_wait) bag_wait--;
      else move_bag(b, g[BAG_DIR]);
    }
  }
  function stop_bag(b) {
    const g = bags[b];
    if (g[BAG_DIR] === DOWN && g[BAG_BRAKABLE] > 1) g[BAG_BROKEN] = 1;
    else g[BAG_BRAKABLE] = 0;
    g[BAG_DIR] = STOP;
    g[BAG_COUNT] = DROP_WAIT;
    g[BAG_LOOSE] = FALSE;
    const colision = draw_bag(b, BAG_0, g[BAG_X], g[BAG_Y]);
    inc_plot();
    for (let i = 1, mask = 2; i < 8; i++, mask <<= 1) if (mask & colision) era_bag(i);
  }
  function move_bag(b, dir) {
    const g = bags[b];
    let flag = TRUE, colision;
    let x = g[BAG_X], y = g[BAG_Y];
    const x_pos = g[BAG_X_POS], y_pos = g[BAG_Y_POS];
    const old_x = x, old_y = y;

    if (g[BAG_BROKEN]) { grab_money(b); return TRUE; }

    if (g[BAG_DIR] === DOWN && (dir === LEFT || dir === RIGHT)) {
      colision = draw_bag(b, BAG_6, x, y);
      inc_plot();
      if ((colision & 0x01) && get_m_y() >= y) kill_man(MONEY_BAG, b);
      if (colision & 0x3f00) bag_bugs(b, colision);
      return TRUE;
    }

    if ((x === X_LAST && dir === RIGHT) || (x === X_FIRST && dir === LEFT) ||
        (y === Y_LAST && dir === DOWN) || (y === Y_FIRST && dir === UP)) flag = FALSE;

    if (flag) {
      switch (dir) {
        case RIGHT: x += 4; break;
        case LEFT: x -= 4; break;
        case DOWN:
          if (g[BAG_FIRST]) {
            g[BAG_FIRST] = FALSE;
            era_b_first(x, y);
            era_up(x, y + 21);
          } else era_b_down(x, y);
          era_background(x, y, dir);
          dest_coin(x_pos, y_pos);
          y += 6;
          break;
      }
      switch (dir) {
        case DOWN:
          colision = draw_bag(b, BAG_6, x, y);
          inc_plot();
          if ((colision & 0x01) && get_m_y() >= y) kill_man(MONEY_BAG, b);
          if (colision & 0x3f00) bag_bugs(b, colision);
          break;
        case LEFT:
        case RIGHT:
          g[BAG_COUNT] = DROP_WAIT;
          g[BAG_LOOSE] = FALSE;
          colision = draw_bag(b, BAG_0, x, y);
          inc_plot();
          bag_wait = 1;
          if (colision & 0xfe) {
            if (!move_all_bags(dir, colision)) {
              x = old_x; y = old_y;
              draw_bag(b, BAG_0, x, y);
              inc_plot();
              flag = FALSE;
            }
          }
          if ((colision & 0x1) || (colision & 0x3f00)) {
            x = old_x; y = old_y;
            draw_bag(b, BAG_0, x, y);
            inc_plot();
            flag = FALSE;
          }
          break;
      }
      g[BAG_DIR] = flag ? dir : get_rev(dir);
      g[BAG_X] = x;
      g[BAG_Y] = y;
      g[BAG_X_POS] = ((x - X_OFFSET) / 20) | 0;
      g[BAG_Y_POS] = ((y - Y_OFFSET) / 18) | 0;
      g[BAG_X_REM] = (x - X_OFFSET) % 20;
      g[BAG_Y_REM] = (y - Y_OFFSET) % 18;
    }
    return flag;
  }
  function move_all_bags(dir, colision) {
    let flag = TRUE;
    for (let b = 1, mask = 2; b < 8; b++, mask <<= 1) if ((colision & mask) && !move_bag(b, dir)) flag = FALSE;
    return flag;
  }
  function money_check(colision) {
    let flag = TRUE;
    for (let b = 1, mask = 2; b < 8; b++, mask <<= 1) {
      if (colision & mask) {
        if (bags[b][BAG_BROKEN]) grab_money(b);
        else flag = FALSE;
      }
    }
    return flag;
  }
  function era_bag(b) {
    if (bags[b][BAG_ACTIVE]) { bags[b][BAG_ACTIVE] = FALSE; CGA.spErase(b); }
  }
  function get_y_bag(b) { return bags[b][BAG_Y]; }
  function get_d_bag(b) { return bags[b][BAG_ACTIVE] ? bags[b][BAG_DIR] : STOP; }
  function get_active_bags() {
    let a = 0;
    for (let b = 1, mask = 2; b < 8; b++, mask <<= 1) if (bags[b][BAG_ACTIVE]) a |= mask;
    return a;
  }
  function break_bags(colision) {
    for (let b = 1, mask = 2; b < 8; b++, mask <<= 1) if (bags[b][BAG_ACTIVE] && (colision & mask)) era_bag(b);
  }
  function get_moving_bags() {
    let a = 0;
    for (let b = 1; b < 8; b++)
      if (bags[b][BAG_ACTIVE] && bags[b][BAG_BROKEN] < 10 && (bags[b][BAG_BROKEN] || bags[b][BAG_LOOSE])) a++;
    return a;
  }
  function grab_money(b) {
    const colision = draw_bag(b, BAG_9, bags[b][BAG_X], bags[b][BAG_Y]);
    inc_plot();
    if (colision & 0x01) { score_money(); snd.snd_money(); rst_mwait(); }
    else rst_bwait();
    era_bag(b);
  }

  // ======================= TC.C - man movement =======================
  let man_x = 0, man_y = 0, m_x_pos = 0, m_y_pos = 0, m_x_rem = 0, m_y_rem = 0;
  let m_dir = LEFT, new_m_dir = LEFT, m_last_dir = RIGHT, m_wait = 0, m_alive = TRUE, m_active = TRUE;
  let mis_ready = TRUE, mis_wait = 0, mis_x = 0, mis_y = 0, mis_dir = 0, mis_explode = 0;
  let dead_type = MONEY_BAG, dead_num = 0, dead_body = 0, dead_wait = 0;
  let bonus_flash = 0, bonus_time = 0, bonus_active = FALSE, bonus_on = FALSE, bonus_count = 0;
  let coin_time = 0;

  function init_tc() {
    m_dir = LEFT; new_m_dir = LEFT; m_last_dir = RIGHT;
    m_x_pos = M_X_START; m_y_pos = M_Y_START;
    man_x = m_x_pos * 20 + X_OFFSET; man_y = m_y_pos * 18 + Y_OFFSET;
    m_x_rem = 0; m_y_rem = 0;
    m_alive = TRUE; dead_type = MONEY_BAG; m_active = TRUE;
    m_wait = 0;
    CGA.spPlace(0, man_x, man_y);
    mis_ready = TRUE; mis_wait = 0; mis_explode = 0;
    kb.fires = FALSE;
    bonus_active = FALSE; bonus_on = FALSE;
    coin_time = 0;
  }
  function end_tc() { CGA.spErase(0); m_active = FALSE; }

  function task_c() {
    if (mis_explode) explode_missile();
    else move_missile();

    if (m_active) {
      if (m_alive) {
        if (m_wait) {
          draw_man(m_dir, man_x, man_y, mis_ready && !mis_wait);
          inc_plot();
          m_wait--;
        } else move_man();
      } else dead_move();
    }

    if (bonus_on && m_alive) {
      if (bonus_time) {
        bonus_time--;
        if (bonus_flash || bonus_time < 20) {
          bonus_flash--;
          if (bonus_time & 1) { CGA.palette(0); snd.init_chase(); }
          else { CGA.palette(1); snd.init_chase(); }
          if (bonus_flash === 0) { snd.init_music(0); snd.rst_chase(); CGA.palette(1); }
        }
      } else {
        end_bonus();
        snd.rst_chase();
        snd.init_music(1);
      }
    }
    if (bonus_on && !m_alive) {
      end_bonus();
      snd.rst_chase();
      snd.init_music(1);
    }
    if (coin_time > 0) coin_time--;
  }

  function move_missile() {
    let colision, point_stat = 0;
    if (mis_ready) {
      if (mis_wait) mis_wait--;
      else if (get_button() && get_m_status()) {
        mis_wait = 60 + get_dificulty() * 3;
        mis_ready = FALSE;
        switch (m_last_dir) {
          case RIGHT: mis_x = man_x + 8; mis_y = man_y + 4; break;
          case LEFT: mis_x = man_x; mis_y = man_y + 4; break;
          case UP: mis_x = man_x + 4; mis_y = man_y; break;
          case DOWN: mis_x = man_x + 4; mis_y = man_y + 8; break;
        }
        mis_dir = m_last_dir;
        CGA.spPlace(15, mis_x, mis_y);
        snd.init_fire();
      }
      return;
    }
    const pp = ppoint;
    switch (mis_dir) {
      case RIGHT: mis_x += 8; point_stat = pp(mis_x, mis_y + 4) | pp(mis_x + 4, mis_y + 4); break;
      case LEFT: mis_x -= 8; point_stat = pp(mis_x, mis_y + 4) | pp(mis_x + 4, mis_y + 4); break;
      case UP:
        mis_y -= 7;
        for (let i = 0; i < 7; i++) point_stat |= pp(mis_x + 4, mis_y + i) & 0xc0;
        break;
      case DOWN:
        mis_y += 7;
        for (let i = 0; i < 7; i++) point_stat |= pp(mis_x, mis_y + i) & 3;
        break;
    }
    colision = draw_missile(mis_x, mis_y, 0);
    inc_plot();
    if (colision & 0x3f00) {
      for (let i = 0, mask = 0x100; i < 6; i++, mask <<= 1) {
        if (colision & mask) { era_bug(i); score_bug(); mis_explode = 1; }
      }
    }
    if (colision & 0x40fe) mis_explode = 1;
    switch (mis_dir) {
      case RIGHT:
        if (mis_x > X_LAST + 4) mis_explode = 1;
        else if (point_stat && !colision) { mis_explode = 1; mis_x -= 8; draw_missile(mis_x, mis_y, 0); }
        break;
      case LEFT:
        if (mis_x < X_FIRST + 4) mis_explode = 1;
        else if (point_stat && !colision) { mis_explode = 1; mis_x += 8; draw_missile(mis_x, mis_y, 0); }
        break;
      case UP:
        if (mis_y < Y_FIRST + 3) mis_explode = 1;
        else if (point_stat && !colision) { mis_explode = 1; mis_y += 7; draw_missile(mis_x, mis_y, 0); }
        break;
      case DOWN:
        if (mis_y > Y_LAST + 3) mis_explode = 1;
        else if (point_stat && !colision) { mis_explode = 1; mis_y -= 7; draw_missile(mis_x, mis_y, 0); }
        break;
    }
  }
  function explode_missile() {
    switch (mis_explode) {
      case 1: snd.snd_explode(); draw_missile(mis_x, mis_y, 1); inc_plot(); mis_explode = 2; break;
      case 2: draw_missile(mis_x, mis_y, 2); inc_plot(); mis_explode = 3; break;
      case 3: draw_missile(mis_x, mis_y, 3); inc_plot(); mis_explode = 4; break;
      default: era_missile(); mis_explode = 0; break;
    }
  }
  function era_missile() {
    if (!mis_ready) { mis_ready = TRUE; CGA.spErase(15); snd.rst_fire(); }
  }

  function move_man() {
    let colision, flag = TRUE;
    joystk();
    const m_key_dir = check_turn();
    switch (m_key_dir) {
      case UP: case DOWN: case RIGHT: case LEFT: new_m_dir = m_key_dir; break;
      default: new_m_dir = STOP;
    }
    if (m_x_rem === 0 && (new_m_dir === UP || new_m_dir === DOWN)) { m_dir = new_m_dir; m_last_dir = new_m_dir; }
    if (m_y_rem === 0 && (new_m_dir === LEFT || new_m_dir === RIGHT)) { m_dir = new_m_dir; m_last_dir = new_m_dir; }
    if (m_key_dir === STOP) m_dir = STOP;
    else m_dir = m_last_dir;
    if ((man_x === X_LAST && m_dir === RIGHT) || (man_x === X_FIRST && m_dir === LEFT) ||
        (man_y === Y_LAST && m_dir === DOWN) || (man_y === Y_FIRST && m_dir === UP)) m_dir = STOP;

    const m_x_old = man_x, m_y_old = man_y;
    if (m_dir !== STOP) era_background(man_x, man_y, m_dir);
    switch (m_dir) {
      case RIGHT: era_right(man_x, man_y); man_x += 4; break;
      case LEFT: era_left(man_x, man_y); man_x -= 4; break;
      case UP: era_up(man_x, man_y); man_y -= 3; break;
      case DOWN: era_down(man_x, man_y); man_y += 3; break;
    }
    colision = coin_check(((man_x - X_OFFSET) / 20) | 0, ((man_y - Y_OFFSET) / 18) | 0,
      (man_x - X_OFFSET) % 20, (man_y - Y_OFFSET) % 18, m_dir);
    if (colision) {
      score_coin();
      snd.snd_coin();
      snd.snd_2_coin(coin_time);
      coin_time = 9;
    }
    colision = draw_man(m_last_dir, man_x, man_y, mis_ready && !mis_wait);
    inc_plot();
    if (colision & 0xfe & get_active_bags()) {
      if (m_dir === RIGHT || m_dir === LEFT) {
        flag = move_all_bags(m_dir, colision);
        m_wait++;
      } else if (!money_check(colision)) flag = FALSE;
      if (!flag) {
        man_x = m_x_old; man_y = m_y_old;
        draw_man(m_dir, man_x, man_y, mis_ready && !mis_wait);
        inc_plot();
        m_last_dir = get_rev(m_dir);
      }
    }
    if (colision & 0x3f00) {
      if (get_bonus()) {
        let temp = rem_bugs(colision);
        while (temp) { snd.snd_bug(); bonus_score(); temp--; }
      }
    }
    if (colision & 0x4000) { score_extra(); start_bonus(); }
    m_x_pos = ((man_x - X_OFFSET) / 20) | 0;
    m_x_rem = (man_x - X_OFFSET) % 20;
    m_y_pos = ((man_y - Y_OFFSET) / 18) | 0;
    m_y_rem = (man_y - Y_OFFSET) % 18;
  }

  function dead_move() {
    let colision;
    switch (dead_type) {
      case MONEY_BAG:
        if (get_y_bag(dead_num) + 6 > man_y) man_y = get_y_bag(dead_num) + 6;
        draw_man(FALL_9, man_x, man_y, FALSE);
        inc_plot();
        if (get_d_bag(dead_num) === STOP) {
          snd.snd_dead();
          dead_wait = 5;
          dead_type = MAN;
          dead_body = 0;
          man_y -= 6;
        }
        break;
      case MAN:
        if (dead_wait) { dead_wait--; break; }
        switch (dead_body) {
          case 0:
            snd.init_music(2);
            colision = draw_man(FALL_5, man_x, man_y, FALSE);
            inc_plot();
            if (colision & 0x3f00) rem_bugs(colision);
            dead_body = 1; dead_wait = 2;
            break;
          case 1: draw_man(FALL_4, man_x, man_y, FALSE); inc_plot(); dead_body = 2; dead_wait = 2; break;
          case 2: draw_man(FALL_3, man_x, man_y, FALSE); inc_plot(); dead_body = 3; dead_wait = 2; break;
          case 3: draw_man(FALL_2, man_x, man_y, FALSE); inc_plot(); dead_body = 4; dead_wait = 2; break;
          case 4:
            draw_man(FALL_1, man_x, man_y, FALSE);
            inc_plot();
            dead_type = DEAD;
            dead_wait = snd.isMusicOn() ? 60 : 10;
            break;
        }
        break;
      case BUG:
        dead_wait = 0;
        dead_type = BOUNCE;
        dead_body = 0;
        break;
      case BOUNCE: {
        const lift = [3, 5, 6, 6, 5, 3, 0];
        draw_man(FALL_9, man_x, man_y - lift[dead_body], FALSE);
        inc_plot();
        if (dead_body === 0) snd.snd_dead();
        if (dead_body === 6) { snd.rst_music(); dead_wait = 5; dead_body = 0; dead_type = MAN; }
        else dead_body++;
        break;
      }
      case DEAD:
        if (dead_wait) { dead_wait--; break; }
        make_dead(TRUE);
        break;
    }
  }

  function begin_bonus() { bonus_active = TRUE; draw_bonus(20 * 14 + X_OFFSET, Y_OFFSET); }
  function start_bonus() {
    bonus_on = TRUE;
    era_bonus();
    CGA.palette(1);
    bonus_time = 250 - get_dificulty() * 20;
    bonus_flash = 20;
    bonus_count = 1;
  }
  function end_bonus() { bonus_on = FALSE; CGA.palette(0); }
  function era_bonus() {
    if (bonus_active) { bonus_active = FALSE; CGA.spErase(14); }
    CGA.palette(0);
  }
  function bonus_score() { add_score(bonus_count * 200); bonus_count <<= 1; }
  function get_bonus() { return bonus_on; }
  function get_rev(dir) {
    switch (dir) {
      case RIGHT: return LEFT;
      case LEFT: return RIGHT;
      case UP: return DOWN;
      case DOWN: return UP;
    }
    return dir;
  }
  function get_man_block(x, y) {
    const mx = ((man_x - X_OFFSET) / 20) | 0, my = ((man_y - Y_OFFSET) / 18) | 0;
    return (m_dir === UP || m_dir === DOWN) && mx === x && (my === y || my + 1 === y);
  }
  function get_m_x() { return man_x; }
  function get_m_y() { return man_y; }
  function get_m_status() { return m_alive; }
  function kill_man(d_type, num) {
    if (dead_type !== MAN && dead_type !== DEAD && dead_type !== BUG) {
      snd.rst_music();
      m_alive = FALSE;
      dead_type = d_type;
      dead_num = num;
    }
  }
  function rst_mwait() { m_wait = 0; }
  function ppoint(x, y) { return CGA.peekXY(x, y); }

  // ======================= TD.C - emeralds ("coins") =======================
  const coins = Array.from({ length: H_MAX }, () => new Array(W_MAX).fill(0));
  let p_mask = 1;

  function init_td() {
    p_mask = get_player() === 0 ? 1 : 2;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++) {
      if (get_mat(x, y, get_screen()) === 'C') coins[y][x] |= p_mask;
      else coins[y][x] &= ~p_mask;
    }
  }
  function start_td() {
    p_mask = get_player() === 0 ? 1 : 2;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++)
      if (coins[y][x] & p_mask) put_coin(x * 20 + X_OFFSET, y * 18 + 3 + Y_OFFSET);
  }
  function coinAt(y, x) { return coins[y] && coins[y][x] ? coins[y][x] & p_mask : 0; }
  function coin_check(x_pos, y_pos, x_rem, y_rem, dir) {
    let stat = FALSE;
    const hit = (redraw, erase, rem) => {
      if (!coinAt(y_pos, x_pos)) return;
      if (rem === redraw) { put_coin(x_pos * 20 + X_OFFSET, y_pos * 18 + 3 + Y_OFFSET); inc_plot(); }
      if (rem === erase) {
        rem_coin(x_pos * 20 + X_OFFSET, y_pos * 18 + 3 + Y_OFFSET);
        inc_plot();
        stat = TRUE;
        coins[y_pos][x_pos] &= ~p_mask;
      }
    };
    switch (dir) {
      case RIGHT: if (x_rem) x_pos++; hit(8, 12, x_rem); break;
      case LEFT: hit(16, 12, x_rem); break;
      case UP: hit(12, 9, y_rem); break;
      case DOWN: if (y_rem) y_pos++; hit(6, 9, y_rem); break;
    }
    return stat;
  }
  function count_coins() {
    let t = 0;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++) if (coins[y][x] & p_mask) t++;
    return t;
  }
  function dest_coin(x_pos, y_pos) {
    if (coinAt(y_pos + 1, x_pos)) {
      coins[y_pos + 1][x_pos] &= ~p_mask;
      rem_coin(x_pos * 20 + X_OFFSET, (y_pos + 1) * 18 + 3 + Y_OFFSET);
    }
  }

  // ======================= TE.C - keyboard / joystick =======================
  let last_key = STOP, button = FALSE;
  function init_joy() { kb.keydir = STOP; kb.lkdir = STOP; button = FALSE; }
  function joystk() {
    last_key = kb.lkdir;
    if (kb.keydir !== STOP) last_key = kb.keydir;
    kb.lkdir = STOP;
    button = kb.fire || kb.fires;
    kb.fires = FALSE;
  }
  function start_wait() {
    if (kb.keychr !== 0 && !(kb.keychr & 0x80) && kb.keychr !== 1) { kb.keychr = 0; return TRUE; }
    return FALSE;
  }
  function check_turn() { return last_key; }
  function get_button() { return button; }

  // ======================= TF.C - score & screen =======================
  let score_p = 0, score_0 = 0, score_1 = 0, bonus_0 = 20000, bonus_1 = 20000;
  const score = new Array(11).fill(0);
  const name = new Array(11).fill('...');
  const HISCORE_KEY = 'digger-1983-hiscores';

  function init_tf() { add_score(0); }
  function init_hi_scores() {
    let data = '';
    try { data = localStorage.getItem(HISCORE_KEY) || ''; } catch (e) { /* storage unavailable */ }
    let count = 1;
    for (let i = 1; i < 11; i++) {
      name[i] = data.substr(count, 3);
      count += 5;
      score[i] = strnum(data.substr(count, 6));
      count += 6;
    }
    if (data[0] !== 's') for (let i = 0; i < 11; i++) { score[i] = 0; name[i] = '...'; }
  }
  function rst_scores() { score_p = 0; score_0 = 0; score_1 = 0; bonus_0 = 20000; bonus_1 = 20000; }
  function flash_score(color) {
    if (get_player() === 0) println(score_0, 0, 0, 6, color);
    else println(score_1, score_1 < 100000 ? 236 : 248, 0, 6, color);
  }
  function add_score(val) {
    if (get_player() === 0) {
      score_0 += val;
      if (score_0 > 999999) score_0 = 0;
      println(score_0, 0, 0, 6, GREEN);
      if (score_0 >= bonus_0) {
        if (get_lives(1) < 5) { add_life(1); print_lives(); }
        bonus_0 += 20000;
      }
    } else {
      score_1 += val;
      if (score_1 > 999999) score_1 = 0;
      println(score_1, score_1 < 100000 ? 236 : 248, 0, 6, GREEN);
      if (score_1 > bonus_1) {
        if (get_lives(2) < 5) { add_life(2); print_lives(); }
        bonus_1 += 20000;
      }
    }
    inc_plot(); inc_plot(); inc_plot();
  }
  async function check_hi_score() {
    add_score(0);
    score_p = get_player() === 0 ? score_0 : score_1;
    if (score_p > score[10]) {
      CGA.clear(0);
      print_present_score();
      prints('PLAYER ' + (get_player() === 0 ? '1' : '2'), 108, 0, RED);
      prints(' NEW HIGH SCORE ', 64, 40, RED);
      await get_name();
      sort_scores();
      save_scores();
    } else {
      blank_top();
      prints('GAME OVER', 104, 0, WHITE);
      snd.sn2_off();
      snd.set_tone(40);
      snd.sn2_stop();
      await wait(1200);
      snd.sn2_start();
      prints('         ', 104, 0, WHITE);
    }
  }
  function print_present_score() {
    println(score_0, 0, 0, 6, 3);
    if (players() === 2) println(score_1, score_1 < 100000 ? 236 : 248, 0, 6, 3);
  }
  function print_lives() {
    let temp = get_lives(1) - 1;
    for (let i = 1; i < 5; i++) { put_man(temp > 0 ? 0 : 2, 60 + i * 20, 0); temp--; }
    if (players() === 2) {
      temp = get_lives(2) - 1;
      for (let i = 1; i < 5; i++) { put_man(temp > 0 ? 1 : 2, 244 - i * 20, 0); temp--; }
    }
  }
  function show_players() {
    if (players() === 1) { prints('ONE', 220, 25, BROWN); prints(' PLAYER ', 192, 39, BROWN); }
    else { prints('TWO', 220, 25, BROWN); prints(' PLAYERS', 184, 39, BROWN); }
  }
  function show_scores() {
    prints('HIGH SCORES', 16, 25, 3);
    let color = 2;
    for (let i = 1; i < 11; i++) {
      prints(name[i] + '  ' + strscr(score[i], TRUE), 16, 31 + i * 13, color);
      color = 1;
    }
  }
  function save_scores() {
    let d = 's';
    for (let i = 1; i < 11; i++) d += name[i] + '  ' + strscr(score[i], TRUE);
    try { localStorage.setItem(HISCORE_KEY, d); } catch (e) { /* storage unavailable */ }
  }

  // the original flips palettes far faster than the display refresh; the result is a blend
  async function flash_palettes(ms) {
    CGA.setBlend(true);
    await wait(ms);
    CGA.setBlend(false);
    CGA.palette(0);
  }
  const GETKEY_TIMEOUT_MS = 15000;
  async function getkey(x, y) {
    kb.keychr = 0;
    printc('_', x, y, 3);
    const until = performance.now() + GETKEY_TIMEOUT_MS;
    CGA.setBlend(true);
    while (performance.now() < until) {
      if (!(kb.keychr & 0x80) && kb.keychr) { CGA.setBlend(false); CGA.palette(0); return kb.keychr; }
      await wait(10);
    }
    CGA.setBlend(false);
    CGA.palette(0);
    return 0;
  }
  async function get_name() {
    prints('ENTER YOUR', 100, 70, 3);
    prints(' INITIALS', 100, 90, 3);
    prints('_ _ _', 128, 130, 3);
    name[0] = '...';
    snd.sn2_off();
    snd.set_tone(40);
    snd.sn2_stop();
    let timeout = FALSE;
    const chars = name[0].split('');
    for (let count = 0; count < 3; count++) {
      let temp = 0;
      while (temp === 0 && !timeout) {
        temp = await getkey(128 + count * 24, 130);
        if (temp === 0) timeout = TRUE;
        if (count && temp === 0x0e) count--;
        temp = conkey(temp);
      }
      if (temp) { printc(temp, 128 + count * 24, 130, 3); chars[count] = temp; }
    }
    name[0] = chars.join('');
    kb.keychr = 0;
    await flash_palettes(600);
    snd.sn2_start();
    CGA.clear(0);
    CGA.palette(0);
  }
  function sort_scores() {
    let count = 10;
    while (count > 1) {
      if (score_p >= score[count - 1]) count--;
      else break;
    }
    for (let i = 10; i > count; i--) { score[i] = score[i - 1]; name[i] = name[i - 1]; }
    score[count] = score_p;
    name[count] = name[0];
  }
  function score_bug() { add_score(250); }
  function score_coin() { add_score(25); }
  function score_2_coin() { add_score(250); }
  function score_money() { add_score(500); }
  function score_extra() { add_score(1000); }
  function strscr(amount, blanks) {
    let out = '', digit = 100000, flag = FALSE;
    while (digit > 1) {
      const chr = Math.floor(amount / digit);
      amount %= digit;
      if (chr || flag) { out += chr; flag = TRUE; }
      else if (blanks) out += ' ';
      digit /= 10;
    }
    return out + amount;
  }
  function strnum(s) {
    let amount = 0, digit = 100000;
    for (let i = 0; i < 6; i++, digit /= 10) amount += digit * getval(s[i]);
    return amount;
  }

  // ======================= TG.C - background =======================
  const back_0 = Array.from({ length: H_MAX }, () => new Array(W_MAX).fill(0));
  const back_1 = Array.from({ length: H_MAX }, () => new Array(W_MAX).fill(0));
  const background = Array.from({ length: H_MAX }, () => new Array(W_MAX).fill(0));

  function init_tg() {
    const store = get_player() === 0 ? back_0 : back_1;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++) {
      background[y][x] = 0xffff;
      const t = get_mat(x, y, get_screen());
      if (t === 'S' || t === 'V') background[y][x] &= 0xd03f;
      if (t === 'S' || t === 'H') background[y][x] &= 0xdfe0;
      store[y][x] = background[y][x];
    }
  }
  function start_tg() {
    const store = get_player() === 0 ? back_0 : back_1;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++) background[y][x] = store[y][x];
    CGA.palette(0);
    draw_background(get_screen());
    era_path();
  }
  function end_tg() {
    const store = get_player() === 0 ? back_0 : back_1;
    for (let x = 0; x < W_MAX; x++) for (let y = 0; y < H_MAX; y++) store[y][x] = background[y][x];
  }
  function era_path() {
    for (let x_pos = 0; x_pos < W_MAX; x_pos++) {
      for (let y_pos = 0; y_pos < H_MAX; y_pos++) {
        if ((background[y_pos][x_pos] & 0x2000) !== 0) continue;
        const x = x_pos * 20 + X_OFFSET, y = y_pos * 18 + Y_OFFSET;
        if ((background[y_pos][x_pos] & 0xfc0) !== 0xfc0) {
          background[y_pos][x_pos] &= 0xd03f;
          era_down(x, y - 15); era_down(x, y - 12); era_down(x, y - 9);
          era_down(x, y - 6); era_down(x, y - 3); era_up(x, y + 3);
        }
        if ((background[y_pos][x_pos] & 0x1f) !== 0x1f) {
          background[y_pos][x_pos] &= 0xdfe0;
          era_right(x - 16, y); era_right(x - 12, y); era_right(x - 8, y);
          era_right(x - 4, y); era_left(x + 4, y);
        }
        if (x_pos < W_MAX - 1 && (background[y_pos][x_pos + 1] & 0xfdf) !== 0xfdf) era_right(x, y);
        if (y_pos < H_MAX - 1 && (background[y_pos + 1][x_pos] & 0xfdf) !== 0xfdf) era_down(x, y);
      }
    }
  }
  function clearBits(y_pos, x_pos, mask) {
    if (background[y_pos] && background[y_pos][x_pos] !== undefined) background[y_pos][x_pos] &= mask;
  }
  const H_BITS = [0xfffe, 0xfffd, 0xfffb, 0xfff7, 0xffef];
  const V_BITS = [0xffbf, 0xff7f, 0xfeff, 0xfdff, 0xfbff, 0xf7ff];
  function era_background(x, y, dir) {
    let x_pos = ((x - X_OFFSET) / 20) | 0, x_rem = (((x - X_OFFSET) % 20) / 4) | 0;
    let y_pos = ((y - Y_OFFSET) / 18) | 0, y_rem = (((y - Y_OFFSET) % 18) / 3) | 0;
    inc_plot();
    switch (dir) {
      case RIGHT:
        x_pos++;
        if (x_rem < 5) clearBits(y_pos, x_pos, H_BITS[x_rem]);
        if ((get_background(x_pos, y_pos) & 0x1f) === 0) clearBits(y_pos, x_pos, 0xdfff);
        break;
      case LEFT:
        x_rem--;
        if (x_rem < 0) { x_rem += 5; x_pos--; }
        clearBits(y_pos, x_pos, H_BITS[x_rem]);
        if ((get_background(x_pos, y_pos) & 0x1f) === 0) clearBits(y_pos, x_pos, 0xdfff);
        break;
      case UP:
        y_rem--;
        if (y_rem < 0) { y_rem += 6; y_pos--; }
        clearBits(y_pos, x_pos, V_BITS[y_rem]);
        if ((get_background(x_pos, y_pos) & 0xfc0) === 0) clearBits(y_pos, x_pos, 0xdfff);
        break;
      case DOWN:
        y_pos++;
        if (y_rem < 6) clearBits(y_pos, x_pos, V_BITS[y_rem]);
        if ((get_background(x_pos, y_pos) & 0xfc0) === 0) clearBits(y_pos, x_pos, 0xdfff);
        break;
    }
  }
  function get_background(x, y) {
    return background[y] && background[y][x] !== undefined ? background[y][x] : 0xffff;
  }

  // ======================= TX.C - data =======================
  function get_mat(x, y, lev) {
    const m = ASSETS.levels[lev - 1];
    return m ? m[y][x] : ' '; // player 2's unused slot in a 1 player game has level 0
  }
  function getval(chr) { return chr >= '1' && chr <= '9' ? chr.charCodeAt(0) - 48 : 0; }
  const SCAN_TO_ASCII = {
    0x1e: 'A', 0x30: 'B', 0x2e: 'C', 0x20: 'D', 0x12: 'E', 0x21: 'F', 0x22: 'G', 0x23: 'H', 0x17: 'I',
    0x24: 'J', 0x25: 'K', 0x26: 'L', 0x32: 'M', 0x31: 'N', 0x18: 'O', 0x19: 'P', 0x10: 'Q', 0x13: 'R',
    0x1f: 'S', 0x14: 'T', 0x16: 'U', 0x2f: 'V', 0x11: 'W', 0x2d: 'X', 0x15: 'Y', 0x2c: 'Z',
    0x34: '.', 0x39: ' ', 0x0b: '0', 0x02: '1', 0x03: '2', 0x04: '3', 0x05: '4', 0x06: '5', 0x07: '6',
    0x08: '7', 0x09: '8', 0x0a: '9',
  };
  function conkey(chr) { return SCAN_TO_ASCII[chr] || 0; }

  // ======================= TZ.C - task dispatcher =======================
  const table = [14, 13, 7, 6, 5, 4, 3, 2, 1, 12, 11, 10, 9, 8, 15, 0];
  const G_DEAD = 0, LIVES = 1, LEVEL = 2, DONE_LEVEL = 3;
  const game = [[0, 0, 0, 0], [0, 0, 0, 0]];
  let player = 0, num_players = 1, new_round = FALSE, new_player = FALSE, plot_count = 0;
  const listeners = [];
  let state = 'title';

  function setState(s) { state = s; for (const f of listeners) f(s); }

  async function main() {
    CGA.palette(0);
    init_hi_scores();
    snd.init_sound();
    num_players = 1;
    for (;;) {
      setState('title');
      snd.init_th();
      CGA.spTable(table);
      init_images();
      init_joy();
      CGA.clear(0);
      CGA.genTitle(ASSETS.title);
      CGA.line(280, 199, 319, 199, 0);
      prints('D I G G E R', 100, 0, 3);
      show_players();
      show_scores();
      let demo_time = 0, x = 0;
      kb.endgame = FALSE;
      let flag = FALSE;
      while (!flag) {
        flag = start_wait();
        if (kb.endgame) {
          toggle_players();
          show_players();
          kb.keychr = 0;
          kb.endgame = FALSE;
        }
        if (demo_time === 0) for (let l = 54; l < 174; l += 12) prints('            ', 164, l, 0);
        if (demo_time === 50) { CGA.spPlace(8, 292, 63); x = 292; }
        if (demo_time > 50 && demo_time <= 77) { x -= 4; draw_bug(0, NORMAL, LEFT, x, 63); }
        if (demo_time > 77) draw_bug(0, NORMAL, RIGHT, 184, 63);
        if (demo_time === 83) prints('NOBBIN', 216, 64, RED);
        if (demo_time === 90) { CGA.spPlace(9, 292, 82); draw_bug(1, ADVANCING, LEFT, 292, 82); x = 292; }
        if (demo_time > 90 && demo_time <= 117) { x -= 4; draw_bug(1, ADVANCING, LEFT, x, 82); }
        if (demo_time > 117) draw_bug(1, ADVANCING, RIGHT, 184, 82);
        if (demo_time === 123) prints('HOBBIN', 216, 83, RED);
        if (demo_time === 130) { CGA.spPlace(0, 292, 101); draw_man(LEFT, 292, 101, TRUE); x = 292; }
        if (demo_time > 130 && demo_time <= 157) { x -= 4; draw_man(LEFT, x, 101, TRUE); }
        if (demo_time > 157) draw_man(RIGHT, 184, 101, TRUE);
        if (demo_time === 163) prints('DIGGER', 216, 102, RED);
        if (demo_time === 178) { CGA.spPlace(1, 184, 120); draw_bag(1, BAG_0, 184, 120); }
        if (demo_time === 183) prints('GOLD', 216, 121, RED);
        if (demo_time === 198) put_coin(184, 141);
        if (demo_time === 203) prints('EMERALD', 216, 140, RED);
        if (demo_time === 218) draw_bonus(184, 158);
        if (demo_time === 223) prints('BONUS', 216, 159, RED);
        demo_time++;
        if (demo_time > 250) demo_time = 0;
        await sleepUntilKey(45);
      }

      setState('playing');
      game[0][LEVEL] = startLevel; game[0][LIVES] = 3;
      if (num_players === 2) { game[1][LEVEL] = startLevel; game[1][LIVES] = 3; }
      else game[1][LIVES] = 0;
      CGA.clear(0);
      player = 0; init_level();
      player = 1; init_level();
      rst_scores();
      new_round = TRUE;
      if (num_players === 2) new_player = TRUE;
      player = 0;
      lastFrame = performance.now();
      while (game[0][LIVES] || game[1][LIVES]) {
        game[player][G_DEAD] = FALSE;
        while (!game[player][G_DEAD] && game[player][LIVES]) {
          rst_images();
          await play_round();
        }
        if (player === 0) {
          if (game[1][LIVES]) { new_player = TRUE; new_round = TRUE; player = 1; }
        } else if (game[0][LIVES]) { new_player = TRUE; new_round = TRUE; player = 0; }
      }
    }
  }

  async function play_round() {
    let loop;
    if (new_round) {
      new_round = FALSE;
      start_level();
      if (new_player) {
        new_player = FALSE;
        const text = 'PLAYER ' + (player === 0 ? '1' : '2');
        blank_top();
        for (loop = 0; loop < 15; loop++) {
          prints(text, 108, 0, 1); flash_score(1); await sleep(20);
          prints(text, 108, 0, 2); flash_score(2); await sleep(20);
          prints(text, 108, 0, 3); flash_score(3); await sleep(20);
        }
        print_present_score();
        add_score(0);
      }
    } else restart_level();

    kb.keychr = 0;
    prints('        ', 108, 0, 3);
    init_tf();
    print_lives();
    snd.init_music(1);
    joystk();
    while (!game[player][G_DEAD] && !game[player][DONE_LEVEL]) {
      plot_count = 0;
      task_c();
      task_a();
      task_b();
      await frameWait();
      if (plot_count > 8) delay_bugs(plot_count - 8);
      await exit_check();
      done_check();
    }
    end_tc();
    snd.rst_music();

    loop = 20;
    while (get_moving_bags() || loop) {
      if (loop) loop--;
      plot_count = 0;
      task_b();
      task_c();
      task_a();
      if (plot_count < 8) loop = 0; // the delay loop in the original reuses (and clears) this counter
      await frameWait();
    }

    snd.init_th();
    era_missile();
    era_bonus();
    end_tb();
    end_tg();
    end_ta();
    if (game[player][DONE_LEVEL]) await snd_end();
    if (count_coins() === 0) {
      game[player][LEVEL]++;
      if (game[player][LEVEL] > 1000) game[player][LEVEL] = 1000;
      init_level();
    }
    if (game[player][G_DEAD]) {
      game[player][LIVES]--;
      print_lives();
      if (game[player][LIVES] < 1) await check_hi_score();
    }
    if (game[player][DONE_LEVEL]) {
      game[player][LEVEL]++;
      if (game[player][LEVEL] > 1000) game[player][LEVEL] = 1000;
      init_level();
    }
  }

  async function snd_end() {
    snd.snd_end_start();
    if (!snd.kb.sound) { await sleep(100); return; }
    const until = performance.now() + 6000;
    while (snd.endPlaying() && performance.now() < until) await wait(15);
  }

  function toggle_players() { num_players = num_players === 1 ? 2 : 1; }
  function init_level() {
    game[player][DONE_LEVEL] = FALSE;
    init_tg();
    init_td();
    init_tb();
    new_round = TRUE;
  }
  function start_level() {
    init_images();
    start_tg();
    start_tb();
    start_td();
    init_tc();
    init_ta();
  }
  function restart_level() {
    rst_images();
    init_tc();
    init_ta();
  }
  function done_check() {
    game[player][DONE_LEVEL] = (count_coins() === 0 || bugs_left() === 0) && get_m_status();
  }
  function inc_plot() { plot_count++; }
  function blank_top() { prints('                          ', 0, 0, 3); prints(' ', 308, 0, 3); }
  function get_screen() {
    let t = get_level();
    if (t > 8) t = (t % 4) + 5;
    return t;
  }
  function get_dificulty() { return game[player][LEVEL] > 10 ? 10 : game[player][LEVEL]; }
  function get_level() { return game[player][LEVEL]; }
  function get_lives(num) { return num === 1 ? game[0][LIVES] : game[1][LIVES]; }
  function add_life(num) { if (num === 1) game[0][LIVES]++; else game[1][LIVES]++; snd.snd_life(); }
  function make_dead(status) { game[player][G_DEAD] = status; }
  function get_player() { return player; }
  function players() { return num_players; }

  async function exit_check() {
    if (kb.keychr === 57 || kb.keychr === 185) {
      setState('paused');
      snd.init_pause();
      snd.set_sound(40);
      snd.sn2_off();
      blank_top();
      prints('PRESS ANY KEY', 80, 0, GREEN);
      while (kb.keychr === 57) await wait(10);
      while (kb.keychr & 0x80) await wait(10);
      blank_top();
      print_present_score();
      add_score(0);
      print_lives();
      await sleep(200);
      kb.keychr = 0;
      setState('playing');
      lastFrame = performance.now();
    } else snd.rst_pause();
  }

  snd.setHooks({ score_2_coin, rnd });

  let startLevel = 1;
  let running = false;
  function start() {
    if (running) return;
    running = true;
    main();
  }

  return {
    start, keyEvent, setSpeed,
    onState(f) { listeners.push(f); },
    getState() { return state; },
    setStartLevel(n) { startLevel = Math.max(1, Math.min(1000, n | 0)); },
    // used by tools/render-docs.js to draw the documentation's level previews
    drawLevelPreview(level) {
      player = 0;
      game[0][LEVEL] = level;
      CGA.spTable(table);
      CGA.clear(0);
      init_level();
      start_level();
      prints('LEVEL ' + level, 108, 0, 3);
    },
  };
})();
