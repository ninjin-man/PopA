"use strict";

/* ---------------------------------------------------------------------
   0. 基本セットアップ & 定数定義
--------------------------------------------------------------------- */
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const PAL = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']; // 0=最暗 .. 3=最明
const TILE = 16, COLS = 10, ROWS = 9; // 160x144 画面サイズ

/* ---------------------------------------------------------------------
   1. 擬似RNG: DIVレジスタ風タイマー + 加算式ジェネレータ
--------------------------------------------------------------------- */
const RNG = {
  div: 0,        // 毎フレーム加算されるタイマー（DIVレジスタの模倣）
  state: 0x5A,   // 内部状態シード
  tickDiv(){
    this.div = (this.div + 1) & 0xFF;
  },
  // 0-255 の擬似乱数を1バイト生成する
  next(){
    this.state = (this.state + this.div + 0x1D) & 0xFF;
    this.state = ((this.state << 1) | (this.state >> 7)) & 0xFF;
    this.state = (this.state ^ this.div) & 0xFF;
    return this.state;
  }
};
function rngByte(){ return RNG.next(); }
function rngRange(maxExclusive){ // 0 .. maxExclusive-1
  return Math.floor(rngByte() / 256 * maxExclusive);
}

/* ---------------------------------------------------------------------
   2. 種族データ（オリジナル・モンスター）
--------------------------------------------------------------------- */
const TYPE_EMOJI = {
  'いわ':'🪨', 'くさ':'🌿', 'でんき':'⚡', 'エスパー':'🔮',
  'ノーマル':'⬜', 'どく':'☠️', 'みず':'💧'
};

const SPECIES = {
  0x01: { id:0x01, name:'ゴウラン',   type:'いわ',    base:{hp:105,atk:130,def:120,spd:40, spc:45 }, moves:['tackle','rockslide'] },
  0x02: { id:0x02, name:'リーフィ',   type:'くさ',    base:{hp:45, atk:49, def:49, spd:45, spc:65 }, moves:['tackle','vinewhip','leechseed'] },
  0x03: { id:0x03, name:'ボムリン',   type:'でんき',  base:{hp:50, atk:55, def:40, spd:90, spc:50 }, moves:['tackle','thundershock'] },
  0x04: { id:0x04, name:'ミュート',   type:'エスパー',base:{hp:100,atk:100,def:100,spd:100,spc:100}, moves:['tackle','watergun'] },
  0x05: { id:0x05, name:'カラブ',     type:'ノーマル',base:{hp:35, atk:55, def:30, spd:72, spc:20 }, moves:['tackle'] },
  0x06: { id:0x06, name:'ポイズン',   type:'どく',    base:{hp:48, atk:48, def:65, spd:43, spc:50 }, moves:['tackle','toxic'] },
  0x07: { id:0x07, name:'ロックス',   type:'いわ',    base:{hp:40, atk:80, def:100,spd:20, spc:30 }, moves:['tackle','rockslide'] },
  0x08: { id:0x08, name:'スイーピョ', type:'みず',    base:{hp:40, atk:50, def:40, spd:90, spc:40 }, moves:['tackle','watergun'] },
};

const MOVES = {
  tackle:       { id:'tackle',       name:'たいあたり',     type:'ノーマル', category:'physical', power:40, accuracy:100, basePp:35 },
  vinewhip:     { id:'vinewhip',     name:'つるのムチ',     type:'くさ',     category:'physical', power:35, accuracy:100, basePp:25 },
  leechseed:    { id:'leechseed',    name:'やどりぎのタネ', type:'くさ',     category:'status',   power:0,  accuracy:90,  basePp:15 },
  thundershock: { id:'thundershock', name:'でんきショック', type:'でんき',   category:'special',  power:40, accuracy:100, basePp:30 },
  watergun:     { id:'watergun',     name:'みずでっぽう',   type:'みず',     category:'special',  power:40, accuracy:100, basePp:25 },
  rockslide:    { id:'rockslide',    name:'いわおとし',     type:'いわ',     category:'physical', power:75, accuracy:90,  basePp:10 },
  toxic:        { id:'toxic',        name:'どくどく',       type:'どく',     category:'status',   power:0,  accuracy:90,  basePp:10 },
};

// 10スロットの野生エンカウントテーブル
const SLOT_WEIGHTS = [40,40,35,30,25,20,20,15,15,15]; // 合計255
const ENCOUNTER_TABLE = [
  { sp:0x05, lvl:[2,4] }, { sp:0x05, lvl:[3,5] }, { sp:0x06, lvl:[2,5] },
  { sp:0x02, lvl:[3,5] }, { sp:0x08, lvl:[3,6] }, { sp:0x07, lvl:[4,6] },
  { sp:0x03, lvl:[4,7] }, { sp:0x01, lvl:[5,8] }, { sp:0x06, lvl:[5,8] },
  { sp:0x04, lvl:[7,9] },
];

/* ---------------------------------------------------------------------
   3. ステータス/DV計算ロジック
--------------------------------------------------------------------- */
function expForLevel(lv){ return Math.pow(lv, 3); }

function calcLevelFromExp(exp){
  let lv = 1;
  while (lv < 100 && expForLevel(lv + 1) <= exp) lv++;
  return lv;
}

function calcStat(base, dv, level, isHP){
  if (isHP) return Math.floor(((base + dv) * 2 * level) / 100) + level + 10;
  return Math.floor(((base + dv) * 2 * level) / 100) + 5;
}

function rollDVs(slotIndex){
  const b1 = rngByte(), b2 = rngByte();
  let atk = (b1 >> 4) & 0xF, def = b1 & 0xF;
  let spd = (b2 >> 4) & 0xF, spc = b2 & 0xF;
  if (slotIndex >= 7) { // レアスロット制約の再現
    spc = spc & 0xD;
    spd = spd & 0xE;
  }
  const hp = ((atk & 1) << 3) | ((def & 1) << 2) | ((spd & 1) << 1) | (spc & 1);
  return { atk, def, spd, spc, hp };
}

function instantiateMove(id){
  const m = MOVES[id];
  return { id:m.id, name:m.name, type:m.type, category:m.category, power:m.power, accuracy:m.accuracy, pp:m.basePp, maxPp:m.basePp };
}

function makeMon(speciesId, level, slotIndex){
  const species = SPECIES[speciesId];
  const dv = rollDVs(slotIndex == null ? 0 : slotIndex);
  const mon = {
    species, level, dv,
    exp: expForLevel(level),
    status: null,
    toxicCounter: 0,
    leechSeeded: false,
    leechSeedSource: null,
    moves: species.moves.map(instantiateMove),
  };
  recalcStats(mon);
  mon.curHP = mon.maxHP;
  return mon;
}

function recalcStats(mon){
  const oldMax = mon.maxHP || 0;
  const oldCur = (mon.curHP == null) ? oldMax : mon.curHP;
  mon.maxHP = calcStat(mon.species.base.hp, mon.dv.hp, mon.level, true);
  mon.stat = {
    atk: calcStat(mon.species.base.atk, mon.dv.atk, mon.level, false),
    def: calcStat(mon.species.base.def, mon.dv.def, mon.level, false),
    spd: calcStat(mon.species.base.spd, mon.dv.spd, mon.level, false),
    spc: calcStat(mon.species.base.spc, mon.dv.spc, mon.level, false),
  };
  const diff = mon.maxHP - oldMax;
  mon.curHP = Math.max(1, Math.min(mon.maxHP, oldCur + Math.max(0, diff)));
}

/* ---------------------------------------------------------------------
   4. WRAM風 44バイト構造のエンコード/デコード
--------------------------------------------------------------------- */
function encodeMon44(mon, inBox){
  const buf = new Uint8Array(44);
  let i = 0;
  buf[i++] = mon.species.id;
  buf[i++] = (mon.curHP >> 8) & 0xFF; buf[i++] = mon.curHP & 0xFF;
  buf[i++] = inBox ? 0 : mon.level; // ボックス内では0になり経験値逆算フラグとなる仕様
  buf[i++] = mon.status === 'badpoison' ? 1 : 0;
  buf[i++] = 0; buf[i++] = 0;
  buf[i++] = 0;
  for (let m = 0; m < 4; m++) buf[i++] = mon.moves[m] ? Object.keys(MOVES).indexOf(mon.moves[m].id) + 1 : 0;
  buf[i++] = 0; buf[i++] = 0;
  buf[i++] = (mon.exp >> 16) & 0xFF; buf[i++] = (mon.exp >> 8) & 0xFF; buf[i++] = mon.exp & 0xFF;
  for (let e = 0; e < 5; e++){ buf[i++] = 0; buf[i++] = 0; }
  buf[i++] = ((mon.dv.atk & 0xF) << 4) | (mon.dv.def & 0xF);
  buf[i++] = ((mon.dv.spd & 0xF) << 4) | (mon.dv.spc & 0xF);
  for (let m = 0; m < 4; m++) buf[i++] = mon.moves[m] ? mon.moves[m].pp : 0;
  buf[i++] = inBox ? 0 : mon.level;
  buf[i++] = (mon.maxHP >> 8) & 0xFF; buf[i++] = mon.maxHP & 0xFF;
  buf[i++] = (mon.stat.atk >> 8) & 0xFF; buf[i++] = mon.stat.atk & 0xFF;
  buf[i++] = (mon.stat.def >> 8) & 0xFF; buf[i++] = mon.stat.def & 0xFF;
  buf[i++] = (mon.stat.spd >> 8) & 0xFF; buf[i++] = mon.stat.spd & 0xFF;
  buf[i++] = (mon.stat.spc >> 8) & 0xFF; buf[i++] = mon.stat.spc & 0xFF;
  return buf;
}

function decodeMon44(buf, speciesId, dvHint, expHint, movesHint){
  const storedLevel = buf[3];
  const exp = (buf[14] << 16) | (buf[15] << 8) | buf[16];
  const level = storedLevel === 0 ? calcLevelFromExp(exp) : storedLevel;
  const dvByte1 = buf[27], dvByte2 = buf[28];
  const dv = {
    atk: (dvByte1 >> 4) & 0xF, def: dvByte1 & 0xF,
    spd: (dvByte2 >> 4) & 0xF, spc: dvByte2 & 0xF,
  };
  dv.hp = ((dv.atk & 1) << 3) | ((dv.def & 1) << 2) | ((dv.spd & 1) << 1) | (dv.spc & 1);
  const mon = {
    species: SPECIES[speciesId], level, dv, exp,
    status: buf[4] === 1 ? 'badpoison' : null,
    toxicCounter: 0, leechSeeded:false, leechSeedSource:null,
    moves: movesHint.map(instantiateMove),
  };
  recalcStats(mon);
  mon.curHP = (buf[1] << 8) | buf[2];
  if (mon.curHP <= 0) mon.curHP = mon.maxHP;
  return mon;
}

function storeToBox(mon){
  const buf = encodeMon44(mon, true);
  return { buf, speciesId: mon.species.id, moveIds: mon.moves.map(m => m.id) };
}
function withdrawFromBox(boxEntry){
  return decodeMon44(boxEntry.buf, boxEntry.speciesId, null, null, boxEntry.moveIds);
}

/* ---------------------------------------------------------------------
   5. グローバルゲーム状態
--------------------------------------------------------------------- */
const player = { x:4, y:6, dir:'down', moveCooldown:0 };

// 0=道(歩行可) 1=草むら(エンカウント) 2=木(進入不可)
const MAP = [
  2,2,2,2,2,2,2,2,2,2,
  2,0,0,0,1,1,1,0,0,2,
  2,0,1,1,1,1,1,1,0,2,
  2,0,1,1,0,0,1,1,0,2,
  2,0,1,1,0,0,1,1,0,2,
  2,0,1,1,1,1,1,1,0,2,
  2,0,0,0,1,1,1,0,0,2,
  2,0,0,0,0,0,0,0,0,2,
  2,2,2,2,2,2,2,2,2,2,
];
function tileAt(x,y){
  if (x<0||y<0||x>=COLS||y>=ROWS) return 2;
  return MAP[y*COLS+x];
}

const GAME = {
  scene: 'field', // 'field' | 'battle' | 'status'
  party: [ makeMon(0x02, 5, 1), makeMon(0x03, 5, 6) ],
  box: [ storeToBox(makeMon(0x06, 5, 2)) ],
  activeIndex: 0,
  items: { 'きずぐすり': 3 },
  stepCount: 0,
  currentMessage: null,
  stepQueue: [],
  battle: null,
  statusCursor: 0,
};

function activeMon(){ return GAME.party[GAME.activeIndex]; }

/* ---------------------------------------------------------------------
   6. ステップキュー（メッセージ送り・行動の逐次処理）
--------------------------------------------------------------------- */
function msg(text){ return { type:'msg', text }; }
function action(fn){ return { type:'action', fn }; }
function pushStepsFront(steps){
  for (let i = steps.length - 1; i >= 0; i--) GAME.stepQueue.unshift(steps[i]);
}
function startQueue(steps){
  GAME.stepQueue = steps.slice();
  processNextStep();
}
function processNextStep(){
  if (GAME.stepQueue.length === 0){
    GAME.currentMessage = null;
    if (typeof onQueueEmpty === 'function') onQueueEmpty();
    render();
    return;
  }
  const step = GAME.stepQueue.shift();
  if (step.type === 'msg'){
    GAME.currentMessage = step.text;
    render();
  } else {
    step.fn();
    processNextStep();
  }
}
function ackMessage(){
  if (GAME.currentMessage !== null){
    GAME.currentMessage = null;
    processNextStep();
  }
}

/* ---------------------------------------------------------------------
   7. 入力ハンドラ（各シーンのロジックへディスパッチ）
--------------------------------------------------------------------- */
function pressA(){
  if (GAME.currentMessage !== null){ ackMessage(); return; }
  if (GAME.scene === 'status'){
    if (GAME.statusCursor === 0 && GAME.party[1] && GAME.box[0]){
      const fromParty = GAME.party[1];
      const fromBox = GAME.box[0];
      GAME.box[0] = storeToBox(fromParty);
      GAME.party[1] = withdrawFromBox(fromBox);
    }
    render();
    return;
  }
  // 戦闘中のAボタン処理は game-battle.js 側の関数が定義されていれば委譲
  if (GAME.scene === 'battle' && typeof pressABattle === 'function') {
    pressABattle();
  }
}

function pressB(){
  if (GAME.scene === 'status'){ GAME.scene = 'field'; render(); return; }
  if (GAME.scene === 'battle' && typeof pressBBattle === 'function') {
    pressBBattle();
  }
}

function pressStart(){
  if (GAME.scene === 'field'){ GAME.scene = 'status'; GAME.statusCursor = 0; render(); }
  else if (GAME.scene === 'status'){ GAME.scene = 'field'; render(); }
}

function pressDir(dir){
  if (GAME.scene === 'field' && typeof tryMovePlayer === 'function'){
    const map = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
    const [dx,dy] = map[dir];
    tryMovePlayer(dx,dy);
    return;
  }
  if (GAME.scene === 'battle' && typeof pressDirBattle === 'function') {
    pressDirBattle(dir);
  }
}

/* ---------------------------------------------------------------------
   8. 入力デバイスへのイベントバインド
--------------------------------------------------------------------- */
function bindHold(el, onDown){
  let interval = null;
  const start = (e) => {
    e.preventDefault();
    el.classList.add('active');
    onDown();
    clearInterval(interval);
    interval = setInterval(onDown, 140);
  };
  const end = (e) => { e && e.preventDefault(); el.classList.remove('active'); clearInterval(interval); };
  el.addEventListener('touchstart', start, {passive:false});
  el.addEventListener('touchend', end, {passive:false});
  el.addEventListener('touchcancel', end, {passive:false});
  el.addEventListener('mousedown', start);
  window.addEventListener('mouseup', end);
}
function bindTap(el, onTap){
  const fire = (e) => { e.preventDefault(); onTap(); };
  el.addEventListener('touchstart', fire, {passive:false});
  el.addEventListener('mousedown', fire);
}

bindHold(document.getElementById('d-up'), () => pressDir('up'));
bindHold(document.getElementById('d-down'), () => pressDir('down'));
bindHold(document.getElementById('d-left'), () => pressDir('left'));
bindHold(document.getElementById('d-right'), () => pressDir('right'));
bindTap(document.getElementById('btn-a'), pressA);
bindTap(document.getElementById('btn-b'), pressB);
bindTap(document.getElementById('btn-start'), pressStart);
bindTap(document.getElementById('btn-select'), () => {});

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') pressDir('up');
  else if (e.key === 'ArrowDown') pressDir('down');
  else if (e.key === 'ArrowLeft') pressDir('left');
  else if (e.key === 'ArrowRight') pressDir('right');
  else if (e.key === 'z' || e.key === 'Z') pressA();
  else if (e.key === 'x' || e.key === 'X') pressB();
  else if (e.key === 'Enter') pressStart();
});

/* ---------------------------------------------------------------------
   9. メインハブ描画関数 & ループ
--------------------------------------------------------------------- */
function render(){
  if (GAME.scene === 'field' && typeof drawField === 'function') drawField();
  else if (GAME.scene === 'battle' && typeof drawBattle === 'function') drawBattle();
  else if (GAME.scene === 'status' && typeof drawStatus === 'function') drawStatus();
}

function loop(){
  RNG.tickDiv();
  if (player.moveCooldown > 0) player.moveCooldown--;
  render();
  requestAnimationFrame(loop);
}

// 最初のフレーム駆動を開始（すべてのスクリプトが読み込まれた後に回り始めます）
requestAnimationFrame(loop);
