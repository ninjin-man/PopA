"use strict";

// 修正①: index.html側のcanvas idは "screen" のため一致させる
// (旧コードは "gameCanvas" を参照しており、CANVASがnullになって
//  CANVAS.getContext("2d") が例外を投げ、スクリプト全体が初期化前に
//  停止していた)
const CANVAS = document.getElementById("screen");
const ctx = CANVAS.getContext("2d");

const TILE = 16;
const PAL = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];

// 各シーン共通のゲーム状態管理
const GAME = {
  scene: 'field', // 'field', 'battle', 'status'
  party: [],
  box: [],
  activeIndex: 0,
  stepCount: 0,
  items: { 
    'きずぐすり': 5, 
    'モンスターボール': 5, 
    'スーパーボール': 5, 
    'ハイパーボール': 5 
  },
  currentMessage: null,
  statusCursor: 0, // 0:パーティ交換, 1:レポート(セーブ)
  mapId: 0,
  battle: null
};

const player = { x: 4, y: 4, dir: 'down', moveCooldown: 0 };

let stepQueue = [];
let rngState = 0x1234;

function rngByte() {
  rngState = (rngState * 5 + 1) & 0xFFFF;
  return rngState >> 8;
}
function rngRange(max) { return rngByte() % max; }

/* ---------------------------------------------------------------------
   種族データ（catchRate を追加）
--------------------------------------------------------------------- */
const SPECIES = [
  { id: 0, name: "ゴウラン", type: 0, base: { hp: 45, atk: 49, def: 49, spd: 45, spc: 65 }, catchRate: 45 },
  { id: 1, name: "リーフィ", type: 0, base: { hp: 60, atk: 62, def: 63, spd: 60, spc: 80 }, catchRate: 45 },
  { id: 2, name: "ボムリン", type: 1, base: { hp: 39, atk: 52, def: 43, spd: 65, spc: 50 }, catchRate: 190 },
  { id: 3, name: "ミュート", type: 1, base: { hp: 106, atk: 110, def: 90, spd: 130, spc: 154 }, catchRate: 3 },
  { id: 4, name: "カラブ", type: 2, base: { hp: 44, atk: 48, def: 65, spd: 43, spc: 50 }, catchRate: 255 },
  { id: 5, name: "ポイズン", type: 2, base: { hp: 59, atk: 63, def: 80, spd: 58, spc: 65 }, catchRate: 120 },
  { id: 6, name: "ロックス", type: 3, base: { hp: 35, atk: 55, def: 40, spd: 90, spc: 50 }, catchRate: 60 },
  { id: 7, name: "スイーピョ", type: 3, base: { hp: 65, atk: 70, def: 60, spd: 115, spc: 65 }, catchRate: 190 }
];

const TYPE_NAMES = ["くさ", "ほのお", "みず", "でんき"];
const TYPE_EMOJI = ["🍃", "🔥", "💧", "⚡"];

const MOVES = [
  { id: 'tackle', name: "たいあたり", power: 35, accuracy: 95, type: 0, category: 'physical', maxPp: 35 },
  { id: 'vine', name: "つるのむち", power: 35, accuracy: 100, type: 0, category: 'special', maxPp: 10 },
  { id: 'ember', name: "ひのこ", power: 40, accuracy: 100, type: 1, category: 'special', maxPp: 25 },
  { id: 'bubble', name: "あわ", power: 20, accuracy: 100, type: 2, category: 'special', maxPp: 30 },
  { id: 'shock', name: "でんきショック", power: 40, accuracy: 100, type: 3, category: 'special', maxPp: 30 },
  { id: 'toxic', name: "どくどく", power: 0, accuracy: 85, type: 0, category: 'status', maxPp: 10 },
  { id: 'leechseed', name: "やどりぎのタネ", power: 0, accuracy: 90, type: 0, category: 'status', maxPp: 10 }
];

/* ---------------------------------------------------------------------
   広大化マップ ＆ 複数マップ（ワープ・NPC・看板）定義
--------------------------------------------------------------------- */
const MAPS = [
  {
    id: 0,
    name: "マサラフィールド",
    cols: 20, rows: 18,
    encounter: true,
    // 2:木, 1:草むら, 0:道, 4:建物ドア(進入可)
    tiles: [
      2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,
      2,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,2,
      2,0,1,1,1,1,0,2,2,2,0,1,1,1,1,1,1,1,0,2,
      2,0,1,1,1,1,0,0,0,0,0,1,1,1,1,1,1,1,0,2,
      2,0,0,0,0,0,0,2,2,2,0,0,0,0,0,1,1,1,0,2,
      2,2,2,2,2,2,0,2,2,2,2,2,4,2,0,0,0,0,0,2,
      2,2,2,2,2,2,0,2,2,2,2,2,0,2,0,2,2,2,2,2,
      2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,2,
      2,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,2,
      2,0,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,0,2,
      2,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,0,2,
      2,2,2,2,2,2,2,2,2,0,0,1,1,1,1,1,1,1,0,2,
      2,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,2,
      2,0,1,1,1,1,1,0,2,0,1,1,1,1,1,1,1,1,0,2,
      2,0,1,1,1,1,1,0,2,0,1,1,1,1,1,1,1,1,0,2,
      2,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,2,
      2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,
      2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2
    ],
    warps: [
      { x: 12, y: 5, targetMap: 1, targetX: 4, targetY: 7 } // 建物に入る
    ],
    objects: [
      { x: 5, y: 3, type: 'sign', name: 'かんばん', text: '【おしらせ】ここに ウルトラな かいじゅうの かんばん がある。' },
      { x: 14, y: 8, type: 'npc', name: 'たんぱんこぞう', text: 'くさむら の なか は モンスター が とびだすぞ！' }
    ]
  },
  {
    id: 1,
    name: "ポケモンラボ",
    cols: 10, rows: 9,
    encounter: false,
    tiles: [
      2,2,2,2,2,2,2,2,2,2,
      2,0,0,0,0,0,0,0,0,2,
      2,0,0,0,0,0,0,0,0,2,
      2,0,0,0,0,0,0,0,0,2,
      2,0,0,0,0,0,0,0,0,2,
      2,0,0,0,0,0,0,0,0,2,
      2,0,0,0,0,0,0,0,0,2,
      2,2,2,2,0,2,2,2,2,2,
      2,2,2,2,0,2,2,2,2,2
    ],
    warps: [
      { x: 4, y: 8, targetMap: 0, targetX: 12, targetY: 6 } // 外に出る
    ],
    objects: [
      { x: 4, y: 2, type: 'npc', name: 'ジョーイさん', text: 'ラボ へ ようこそ！ ポケモン の キズ を かいふく させましょう！', isHealer: true },
      { x: 1, y: 2, type: 'sign', name: 'パソコン', text: 'パソコン が おいてある。 ボックス の なかみ を かくにん できる。' }
    ]
  }
];

function tileAt(x, y) {
  const currentMap = MAPS[GAME.mapId];
  if (x < 0 || x >= currentMap.cols || y < 0 || y >= currentMap.rows) return 2; // マップ外は通行不可の木(2)

  // NPCなどの衝突判定オブジェクトが存在するかチェック
  const hasNPC = currentMap.objects.some(o => o.type === 'npc' && o.x === x && o.y === y);
  if (hasNPC) return 2; // NPCがいるマスは木(2)と同じ進入不可扱いにする

  return currentMap.tiles[y * currentMap.cols + x];
}

const ENCOUNTER_TABLE = [
  { sp: 0, lvl: [3, 5] }, { sp: 2, lvl: [2, 4] }, { sp: 4, lvl: [3, 5] }, { sp: 6, lvl: [2, 4] },
  { sp: 1, lvl: [4, 6] }, { sp: 5, lvl: [4, 6] }, { sp: 7, lvl: [4, 5] }, { sp: 0, lvl: [5, 7] },
  { sp: 2, lvl: [6, 8] }, { sp: 3, lvl: [10, 12] }
];
const SLOT_WEIGHTS = [51, 51, 39, 39, 25, 25, 13, 10, 1, 1];

/* ---------------------------------------------------------------------
   44バイト（WRAM形式）の相互変換
--------------------------------------------------------------------- */
function encodeMon44(m) {
  const buf = new Uint8Array(44);
  buf[0] = m.species.id;
  buf[1] = m.level;
  buf[2] = m.curHP >> 8; buf[3] = m.curHP & 0xFF;
  buf[4] = m.maxHP >> 8; buf[5] = m.maxHP & 0xFF;
  buf[6] = m.stat.atk; buf[7] = m.stat.def; buf[8] = m.stat.spd; buf[9] = m.stat.spc;
  buf[10] = m.dv.atk; buf[11] = m.dv.def; buf[12] = m.dv.spd; buf[13] = m.dv.spc; buf[14] = m.dv.hp;
  buf[15] = m.exp >> 16; buf[16] = (m.exp >> 8) & 0xFF; buf[17] = m.exp & 0xFF;
  for (let i = 0; i < 4; i++) {
    if (m.moves[i]) {
      const idx = MOVES.findIndex(mv => mv.id === m.moves[i].id);
      buf[18 + i] = idx !== -1 ? idx : 0xFF;
      buf[22 + i] = m.moves[i].pp;
    } else {
      buf[18 + i] = 0xFF; buf[22 + i] = 0;
    }
  }
  return buf;
}

function decodeMon44(buf) {
  const spId = buf[0];
  const level = buf[1];
  const curHP = (buf[2] << 8) | buf[3];
  const maxHP = (buf[4] << 8) | buf[5];
  const species = SPECIES[spId] || SPECIES[0];
  
  const m = {
    species, level, curHP, maxHP,
    stat: { atk: buf[6], def: buf[7], spd: buf[8], spc: buf[9] },
    dv: { atk: buf[10], def: buf[11], spd: buf[12], spc: buf[13], hp: buf[14] },
    exp: (buf[15] << 16) | (buf[16] << 8) | buf[17],
    moves: [], status: null, toxicCounter: 0, leechSeeded: false
  };
  for (let i = 0; i < 4; i++) {
    const mvIdx = buf[18 + i];
    if (mvIdx !== 0xFF && MOVES[mvIdx]) {
      m.moves.push({ ...MOVES[mvIdx], pp: buf[22 + i] });
    }
  }
  return m;
}

function makeMon(spId, lvl, slotIndex = 4) {
  const sp = SPECIES[spId];
  const dv = { atk: rngRange(16), def: rngRange(16), spd: rngRange(16), spc: rngRange(16), hp: 0 };
  dv.hp = ((dv.atk & 1) << 3) | ((dv.def & 1) << 2) | ((dv.spd & 1) << 1) | (dv.spc & 1);
  if (slotIndex === 9) { dv.atk = 15; dv.def = 15; dv.spd = 15; dv.spc = 15; dv.hp = 15; }

  const baseExp = Math.floor(lvl * lvl * lvl * 0.8);
  const m = { species: sp, level: lvl, exp: baseExp, dv, moves: [], status: null, toxicCounter: 0, leechSeeded: false };
  recalcStats(m);
  m.curHP = m.maxHP;

  let movePool = ['tackle'];
  if (spId === 0 || spId === 1) movePool.push('vine', 'toxic', 'leechseed');
  if (spId === 2 || spId === 3) movePool.push('ember', 'toxic');
  if (spId === 4 || spId === 5) movePool.push('bubble', 'leechseed');
  if (spId === 6 || spId === 7) movePool.push('shock', 'toxic');

  movePool.slice(0, 4).forEach(id => {
    const orig = MOVES.find(mv => mv.id === id);
    if (orig) m.moves.push({ ...orig, pp: orig.maxPp });
  });
  return m;
}

function recalcStats(m) {
  const b = m.species.base;
  m.maxHP = Math.floor((b.hp + m.dv.hp) * 2 * m.level / 100) + m.level + 10;
  m.stat = {
    atk: Math.floor((b.atk + m.dv.atk) * 2 * m.level / 100) + 5,
    def: Math.floor((b.def + m.dv.def) * 2 * m.level / 100) + 5,
    spd: Math.floor((b.spd + m.dv.spd) * 2 * m.level / 100) + 5,
    spc: Math.floor((b.spc + m.dv.spc) * 2 * m.level / 100) + 5
  };
}

function calcLevelFromExp(exp) { return Math.min(100, Math.max(1, Math.floor(Math.cbrt(exp / 0.8)))); }
function activeMon() { return GAME.party[GAME.activeIndex]; }
function withdrawFromBox(buf44) { return decodeMon44(buf44); }

/* ---------------------------------------------------------------------
   実機風チェックサム付きセーブ＆ロード
--------------------------------------------------------------------- */
function saveGame() {
  const partyBytes = GAME.party.map(m => Array.from(encodeMon44(m)));
  const boxBytes = GAME.box.map(b => Array.from(b));

  const saveData = {
    mapId: GAME.mapId,
    playerX: player.x,
    playerY: player.y,
    playerDir: player.dir,
    stepCount: GAME.stepCount,
    items: GAME.items,
    party: partyBytes,
    box: boxBytes
  };

  const jsonStr = JSON.stringify(saveData);
  // チェックサム算出: 全文字コードの合計を0xFFで割った余りを反転
  let sum = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    sum += jsonStr.charCodeAt(i);
  }
  const checksum = (~sum) & 0xFF;

  const wrappedData = { payload: jsonStr, checksum: checksum };
  localStorage.setItem("minimon_sav_data", JSON.stringify(wrappedData));
  console.log("セーブ成功: レポートを書き込みました。");
}

function loadGame() {
  const saved = localStorage.getItem("minimon_sav_data");
  if (!saved) return false;

  try {
    const wrapped = JSON.parse(saved);
    let sum = 0;
    for (let i = 0; i < wrapped.payload.length; i++) {
      sum += wrapped.payload.charCodeAt(i);
    }
    const computedCheck = (~sum) & 0xFF;

    if (computedCheck !== wrapped.checksum) {
      console.warn("セーブデータ破損: チェックサム不一致。新規開始します。");
      return false;
    }

    const data = JSON.parse(wrapped.payload);
    GAME.mapId = data.mapId;
    player.x = data.playerX;
    player.y = data.playerY;
    player.dir = data.playerDir;
    GAME.stepCount = data.stepCount;
    GAME.items = data.items;
    
    GAME.party = data.party.map(b => decodeMon44(new Uint8Array(b)));
    GAME.box = data.box.map(b => new Uint8Array(b));
    GAME.activeIndex = 0;
    console.log("ロード成功: レポートから再開します。");
    return true;
  } catch(e) {
    console.error("ロード失敗:", e);
    return false;
  }
}

/* ---------------------------------------------------------------------
   メッセージキュー機構
--------------------------------------------------------------------- */
function msg(text) { return { type: 'msg', text }; }
function action(fn) { return { type: 'action', fn }; }

function startQueue(steps) {
  stepQueue = steps;
  advanceQueue();
}

function advanceQueue() {
  if (stepQueue.length === 0) {
    GAME.currentMessage = null;
    if (typeof onQueueEmpty === 'function') onQueueEmpty();
    render();
    return;
  }
  const next = stepQueue.shift();
  if (next.type === 'msg') {
    GAME.currentMessage = next.text;
    render();
  } else if (next.type === 'action') {
    next.fn();
    advanceQueue();
  }
}

function pushStepsFront(steps) {
  stepQueue = [...steps, ...stepQueue];
}

/* ---------------------------------------------------------------------
   オブジェクト対話システム
--------------------------------------------------------------------- */
function interactWithObject() {
  let nx = player.x;
  let ny = player.y;
  if (player.dir === 'left') nx--;
  else if (player.dir === 'right') nx++;
  else if (player.dir === 'up') ny--;
  else if (player.dir === 'down') ny++;

  const currentMap = MAPS[GAME.mapId];
  const obj = currentMap.objects.find(o => o.x === nx && o.y === ny);
  if (obj) {
    const steps = [msg(obj.text)];
    // もしジョーイさん（回復施設）なら全回復アクションを挟む
    if (obj.isHealer) {
      steps.push(msg("おあずかり した ポケモン を かいふく させました！"));
      steps.push(action(() => {
        GAME.party.forEach(m => {
          m.curHP = m.maxHP;
          m.status = null;
          m.toxicCounter = 0;
          m.leechSeeded = false;
        });
      }));
    }
    startQueue(steps);
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
   入力ハンドラー & シーン委譲
--------------------------------------------------------------------- */
function pressA() {
  if (GAME.currentMessage !== null) {
    advanceQueue();
    return;
  }
  if (GAME.scene === 'field') {
    // 目の前にオブジェクトがあれば会話開始
    if (interactWithObject()) return;
  }
  if (GAME.scene === 'battle' && typeof pressABattle === 'function') {
    pressABattle();
  } else if (GAME.scene === 'status') {
    if (GAME.statusCursor === 0) {
      // 既存のパーティ⇔ボックス交換
      if (GAME.party.length >= 2 && GAME.box.length >= 1) {
        const p2 = encodeMon44(GAME.party[1]);
        const b1 = GAME.box[0];
        GAME.party[1] = decodeMon44(b1);
        GAME.box[0] = p2;
      }
    } else if (GAME.statusCursor === 1) {
      // レポートを書く
      saveGame();
      startQueue([msg("レポート に しっかり かきつづった！")]);
      GAME.scene = 'field';
    }
    render();
  }
}

function pressB() {
  if (GAME.currentMessage !== null) return;
  if (GAME.scene === 'battle' && typeof pressBBattle === 'function') {
    pressBBattle();
  } else if (GAME.scene === 'status') {
    GAME.scene = 'field';
    render();
  }
}

function pressStart() {
  if (GAME.currentMessage !== null) return;
  if (GAME.scene === 'field') {
    GAME.scene = 'status';
    GAME.statusCursor = 0;
    render();
  }
}

function pressDir(dir) {
  if (GAME.currentMessage !== null) return;
  if (GAME.scene === 'field' && typeof tryMovePlayer === 'function') {
    if (dir === 'up') tryMovePlayer(0, -1);
    else if (dir === 'down') tryMovePlayer(0, 1);
    else if (dir === 'left') tryMovePlayer(-1, 0);
    else if (dir === 'right') tryMovePlayer(1, 0);
  } else if (GAME.scene === 'battle' && typeof pressDirBattle === 'function') {
    pressDirBattle(dir);
  } else if (GAME.scene === 'status') {
    if (dir === 'up' || dir === 'down') {
      GAME.statusCursor = GAME.statusCursor === 0 ? 1 : 0;
      render();
    }
  }
}

function render() {
  if (GAME.scene === 'field' && typeof drawField === 'function') drawField();
  else if (GAME.scene === 'battle' && typeof drawBattle === 'function') drawBattle();
  else if (GAME.scene === 'status' && typeof drawStatus === 'function') drawStatus();
}

/* ---------------------------------------------------------------------
   修正②: 画面上のボタン(十字キー/A/B/START)はHTMLに存在するだけで
   どこにもイベントリスナーが繋がっておらず、操作不能だった。
   タップ(pointerdown)とPC検証用キーボードの両方をここで接続する。
--------------------------------------------------------------------- */
function bindButton(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handler();
  });
}

function bindInputs() {
  bindButton('d-up', () => pressDir('up'));
  bindButton('d-down', () => pressDir('down'));
  bindButton('d-left', () => pressDir('left'));
  bindButton('d-right', () => pressDir('right'));
  bindButton('btn-a', pressA);
  bindButton('btn-b', pressB);
  bindButton('btn-start', pressStart);

  // PC検証用: 矢印キー / Z=A / X=B / Enter=Start
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowUp': pressDir('up'); break;
      case 'ArrowDown': pressDir('down'); break;
      case 'ArrowLeft': pressDir('left'); break;
      case 'ArrowRight': pressDir('right'); break;
      case 'z': case 'Z': pressA(); break;
      case 'x': case 'X': pressB(); break;
      case 'Enter': pressStart(); break;
    }
  });
}

/* ---------------------------------------------------------------------
   修正③: player.moveCooldown を毎フレーム減算する仕組みが
   どこにも存在せず、最初の1歩を動いた直後にクールダウンが
   9のまま固定され、以後ずっと移動不能になっていた。
   requestAnimationFrameで毎フレーム1ずつ減らすループを追加。
--------------------------------------------------------------------- */
function gameLoop() {
  if (player.moveCooldown > 0) player.moveCooldown--;
  requestAnimationFrame(gameLoop);
}

/* ---------------------------------------------------------------------
   初期化
--------------------------------------------------------------------- */
function initGame() {
  if (!loadGame()) {
    // セーブがない場合は新規初期化
    GAME.party = [makeMon(0, 5), makeMon(4, 5)];
    GAME.box = [encodeMon44(makeMon(2, 5)), encodeMon44(makeMon(6, 5))];
    GAME.mapId = 0;
    player.x = 4;
    player.y = 4;
  }
  bindInputs();
  requestAnimationFrame(gameLoop);
  render();
}

window.addEventListener('load', initGame);
