"use strict";

/* ---------------------------------------------------------------------
   1. バトル開始 & キュー空き時の制御
--------------------------------------------------------------------- */
function startBattle(wild) {
  GAME.scene = 'battle';
  GAME.battle = {
    enemy: wild, 
    active: true, 
    resolved: false,
    menuOpen: false, 
    subMenu: null, 
    cursor: 0, 
    subCursor: 0,
    pendingPlayerMove: null,
  };
  startQueue([
    msg(`やせいの ${wild.species.name}（Lv${wild.level}）が とびだしてきた！`),
    action(() => { GAME.battle.menuOpen = true; }),
  ]);
}

// game-core.js のメッセージキューが空になった際に呼び出されるコールバック
function onQueueEmpty() {
  if (GAME.scene === 'battle' && GAME.battle && GAME.battle.active) {
    GAME.battle.menuOpen = true;
    GAME.battle.subMenu = null;
  }
}

/* ---------------------------------------------------------------------
   2. 初代リスペクトの計算ロジック（各種バグ・仕様の再現）
--------------------------------------------------------------------- */
// 素早さ依存の急所率（種族のベース素早さ / 512）
function critChance(baseSpd) { 
  return Math.min(baseSpd / 512, 0.5); 
}

function isCrit(attacker) {
  const threshold = Math.floor(critChance(attacker.species.base.spd) * 256);
  return rngByte() < threshold;
}

// 命中判定: accuracy=100 の技でもしきい値が255になるため、
// 乱数が最大値255を引いた場合のみ「1/256ではずれる」仕様を再現
function accuracyCheck(move) {
  const threshold = Math.floor(move.accuracy * 255 / 100);
  return rngByte() < threshold;
}

// ダメージ計算（実機準拠の計算順序と217〜255の乱数幅）
function calcDamage(attacker, defender, move, crit) {
  const atkStat = move.category === 'physical' ? attacker.stat.atk : attacker.stat.spc;
  const defStat = move.category === 'physical' ? defender.stat.def : defender.stat.spc;
  
  let dmg = Math.floor(Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * move.power * atkStat / defStat) / 50) + 2;
  if (crit) dmg *= 2;
  if (attacker.species.type === move.type) dmg = Math.floor(dmg * 1.5); // タイプ一致

  const randPart = 217 + rngRange(255 - 217 + 1); // 217-255のランダム幅
  dmg = Math.max(1, Math.floor(dmg * (randPart / 255)));
  return dmg;
}

/* ---------------------------------------------------------------------
   3. ターン解決 & 行動処理
--------------------------------------------------------------------- */
function enemyChooseMove(mon) {
  const usable = mon.moves.filter(m => m.pp > 0);
  const pool = usable.length ? usable : mon.moves;
  return pool[rngRange(pool.length)];
}

function executeTurn(playerMoveIdx) {
  const battle = GAME.battle;
  const mon = activeMon();
  const move = mon.moves[playerMoveIdx];
  if (!move || move.pp <= 0) return;

  battle.menuOpen = false; 
  battle.subMenu = null;
  battle.pendingPlayerMove = move;

  // 素早さ比較による行動順決定
  const order = (mon.stat.spd >= battle.enemy.stat.spd) ? ['player', 'enemy'] : ['enemy', 'player'];
  
  const steps = [];
  for (const who of order) {
    steps.push(action(() => resolveSingleMove(who)));
  }
  steps.push(action(endOfTurnStatusAction));
  startQueue(steps);
}

function resolveSingleMove(who) {
  const battle = GAME.battle;
  const attacker = who === 'player' ? activeMon() : battle.enemy;
  const defender = who === 'player' ? battle.enemy : activeMon();
  const move = who === 'player' ? battle.pendingPlayerMove : enemyChooseMove(battle.enemy);
  
  if (!attacker || attacker.curHP <= 0 || !defender || defender.curHP <= 0 || !move) return;

  move.pp = Math.max(0, move.pp - 1);
  const steps = [ msg(`${attacker.species.name}の ${move.name}！`) ];

  if (!accuracyCheck(move)) {
    steps.push(msg('しかし わざは はずれた！'));
  } else if (move.category === 'status') {
    steps.push(...applyStatusMoveSteps(attacker, defender, move));
  } else {
    const crit = isCrit(attacker);
    const dmg = calcDamage(attacker, defender, move, crit);
    defender.curHP = Math.max(0, defender.curHP - dmg);
    
    if (crit) steps.push(msg('きゅうしょに あたった！'));
    steps.push(msg(`${defender.species.name}に ${dmg} の ダメージ！`));
    steps.push(action(() => checkFaintAndQueue(defender, defender === battle.enemy)));
  }
  pushStepsFront(steps);
}

function applyStatusMoveSteps(attacker, defender, move) {
  const steps = [];
  if (move.id === 'toxic') {
    if (defender.status === 'badpoison') {
      steps.push(msg(`しかし こうかが なかった！`));
    } else {
      defender.status = 'badpoison';
      defender.toxicCounter = 1;
      steps.push(msg(`${defender.species.name}は どく状態（もうどく）になった！`));
    }
  } else if (move.id === 'leechseed') {
    if (defender.leechSeeded) {
      steps.push(msg(`しかし こうかが なかった！`));
    } else {
      defender.leechSeeded = true;
      defender.leechSeedSource = (defender === GAME.battle.enemy) ? 'player' : 'enemy';
      steps.push(msg(`${defender.species.name}に たねが うえつけられた！`));
    }
  }
  return steps;
}

/* ---------------------------------------------------------------------
   4. ターンエンド時の状態異常処理（重複バグの再現）
--------------------------------------------------------------------- */
function endOfTurnStatusAction() {
  const battle = GAME.battle;
  if (!battle || !battle.active) return;
  const steps = [];

  for (const who of ['player', 'enemy']) {
    const mon = who === 'player' ? activeMon() : battle.enemy;
    if (!mon || mon.curHP <= 0) continue;

    // もうどくのダメージ処理
    if (mon.status === 'badpoison') {
      const dmg = Math.max(1, Math.floor(mon.maxHP / 16) * mon.toxicCounter);
      mon.curHP = Math.max(0, mon.curHP - dmg);
      steps.push(msg(`${mon.species.name}は もうどくの ダメージを うけている！`));
      steps.push(action(() => checkFaintAndQueue(mon, mon === battle.enemy)));
      mon.toxicCounter++;
    }

    // やどりぎのタネの処理
    if (mon.leechSeeded && mon.curHP > 0) {
      // 【バグ再現】もうどく状態の時、やどりぎの吸収量計算にも「もうどくカウンタ」を共通適用してしまう
      const sharedMultiplier = (mon.status === 'badpoison') ? Math.max(1, mon.toxicCounter - 1) : 1;
      let drain = Math.floor(mon.maxHP / 8) * sharedMultiplier;
      drain = Math.min(drain, mon.curHP);
      mon.curHP -= drain;

      const source = mon.leechSeedSource === 'player' ? activeMon() : battle.enemy;
      if (source && source.curHP > 0) {
        source.curHP = Math.min(source.maxHP, source.curHP + drain);
      }
      
      steps.push(msg(`${mon.species.name}は やどりぎに 養分を すいとられた！`));
      if (sharedMultiplier > 1) {
        steps.push(msg('（もうどくカウンタと共有され 吸収量が ふくれあがっている…！）'));
      }
      steps.push(action(() => checkFaintAndQueue(mon, mon === battle.enemy)));
    }
  }
  pushStepsFront(steps);
}

/* ---------------------------------------------------------------------
   5. 勝敗・逃走・道具・交代の処理
--------------------------------------------------------------------- */
function checkFaintAndQueue(mon, isEnemy) {
  if (mon.curHP <= 0) {
    const steps = [ msg(`${mon.species.name}は たおれた！`) ];
    if (isEnemy) steps.push(action(handleVictory));
    else steps.push(action(handlePlayerFaintCheck));
    pushStepsFront(steps);
  }
}

function handleVictory() {
  const battle = GAME.battle;
  if (!battle || battle.resolved) return;
  battle.resolved = true;
  battle.active = false;

  const exp = Math.floor((battle.enemy.species.base.hp + battle.enemy.species.base.atk + battle.enemy.species.base.spd) * battle.enemy.level / 7) + 5;
  const mon = activeMon();
  const steps = [ msg(`${mon.species.name}は ${exp} の けいけんちを えた！`) ];
  
  mon.exp += exp;
  const newLevel = calcLevelFromExp(mon.exp);
  if (newLevel > mon.level) {
    mon.level = newLevel;
    recalcStats(mon);
    steps.push(msg(`${mon.species.name}は レベル${mon.level}に あがった！`));
  }
  steps.push(action(returnToField));
  pushStepsFront(steps);
}

function handlePlayerFaintCheck() {
  const battle = GAME.battle;
  const alive = GAME.party.findIndex(m => m.curHP > 0);
  
  if (alive === -1) {
    battle.active = false;
    battle.resolved = true;
    const steps = [
      msg('てもちポケモンが いなくなってしまった…'),
      action(() => { 
        GAME.party.forEach(m => { m.curHP = m.maxHP; m.status = null; m.toxicCounter = 0; m.leechSeeded = false; }); 
      }),
      action(returnToField),
    ];
    pushStepsFront(steps);
  } else {
    GAME.activeIndex = alive;
    pushStepsFront([ msg(`いけ！ ${activeMon().species.name}！`) ]);
  }
}

function attemptFlee() {
  const mon = activeMon(), enemy = GAME.battle.enemy;
  const chance = Math.min(255, Math.floor((mon.stat.spd / Math.max(1, enemy.stat.spd)) * 130) + 30);
  const battle = GAME.battle;
  battle.menuOpen = false;

  if (rngRange(255) < chance) {
    startQueue([ 
      msg('うまく にげきれた！'), 
      action(() => { battle.active = false; battle.resolved = true; returnToField(); }) 
    ]);
  } else {
    startQueue([ 
      msg('しかし まわりこまれて しまった！'), 
      action(() => { battle.menuOpen = true; }) 
    ]);
  }
}

function useItem(name) {
  const battle = GAME.battle;
  if (name === 'きずぐすり' && GAME.items['きずぐすり'] > 0) {
    const mon = activeMon();
    const heal = 20;
    const before = mon.curHP;
    mon.curHP = Math.min(mon.maxHP, mon.curHP + heal);
    GAME.items['きずぐすり']--;
    battle.subMenu = null;
    
    const healed = mon.curHP - before;
    startQueue([
      msg(`きずぐすりを つかった！ ${mon.species.name}の HPが ${healed} かいふくした！`),
      action(() => { battle.menuOpen = true; }),
    ]);
  }
}

function switchActiveMon(idx) {
  if (GAME.party[idx] && GAME.party[idx].curHP > 0 && idx !== GAME.activeIndex) {
    GAME.activeIndex = idx;
    GAME.battle.subMenu = null;
    startQueue([ 
      msg(`いけ！ ${activeMon().species.name}！`), 
      action(() => { GAME.battle.menuOpen = true; }) 
    ]);
  }
}

function returnToField() {
  GAME.scene = 'field';
  GAME.battle = null;
  player.moveCooldown = 12;
}

/* ---------------------------------------------------------------------
   6. バトル画面の描画処理
--------------------------------------------------------------------- */
function drawHPBar(x, y, w, ratio) {
  ctx.fillStyle = PAL[0];
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = PAL[3];
  ctx.fillRect(x + 1, y + 1, w - 2, 3);
  ctx.fillStyle = ratio > 0.5 ? PAL[1] : PAL[0];
  ctx.fillRect(x + 1, y + 1, Math.max(0, Math.floor((w - 2) * ratio)), 3);
}

function drawBattle() {
  ctx.fillStyle = PAL[3];
  ctx.fillRect(0, 0, 160, 144);
  const battle = GAME.battle;
  if (!battle) return;
  const enemy = battle.enemy;
  const pm = activeMon();

  // 敵モンスター情報
  ctx.font = '26px serif';
  ctx.fillStyle = PAL[0];
  ctx.fillText(TYPE_EMOJI[enemy.species.type] || '❓', 96, 44);
  ctx.font = '7px monospace';
  ctx.fillText(`${enemy.species.name} Lv${enemy.level}`, 86, 16);
  drawHPBar(86, 20, 64, Math.max(0, enemy.curHP) / enemy.maxHP);
  if (enemy.status === 'badpoison') ctx.fillText('もうどく', 86, 32);

  // 味方モンスター情報
  ctx.font = '26px serif';
  ctx.fillText(TYPE_EMOJI[pm.species.type] || '❓', 16, 100);
  ctx.font = '7px monospace';
  ctx.fillText(`${pm.species.name} Lv${pm.level}`, 6, 110);
  drawHPBar(6, 114, 64, Math.max(0, pm.curHP) / pm.maxHP);
  ctx.fillText(`${Math.max(0, pm.curHP)}/${pm.maxHP}`, 6, 124);
  if (pm.status === 'badpoison') ctx.fillText('もうどく', 70, 110);

  // 外枠メッセージウィンドウ
  ctx.strokeStyle = PAL[0];
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 126, 156, 16);
  ctx.fillStyle = PAL[0];
  ctx.font = '8px monospace';

  if (GAME.currentMessage !== null) {
    ctx.fillText(GAME.currentMessage.slice(0, 34), 6, 136);
    ctx.fillText('▶ Aで すすむ', 6, 142);
  } else if (battle.menuOpen) {
    const opts = ['たたかう', 'どうぐ', 'ポケモン', 'にげる'];
    for (let i = 0; i < 4; i++) {
      const cx = 8 + (i % 2) * 78;
      const cy = 132 + Math.floor(i / 2) * 9;
      ctx.fillText((battle.cursor === i ? '▶' : '　') + opts[i], cx, cy);
    }
  } else if (battle.subMenu === 'fight') {
    pm.moves.forEach((m, i) => {
      const cx = 6 + (i % 2) * 82;
      const cy = 132 + Math.floor(i / 2) * 9;
      ctx.fillText((battle.subCursor === i ? '▶' : '　') + `${m.name} ${m.pp}/${m.maxPp}`, cx, cy);
    });
  } else if (battle.subMenu === 'party') {
    GAME.party.forEach((m, i) => {
      const cy = 132 + i * 7;
      const tag = m.curHP <= 0 ? '(ひんし)' : `HP${m.curHP}/${m.maxHP}`;
      ctx.fillText((battle.subCursor === i ? '▶' : '　') + `${m.species.name} Lv${m.level} ${tag}`, 6, cy);
    });
  } else if (battle.subMenu === 'item') {
    const names = Object.keys(GAME.items);
    names.forEach((n, i) => {
      const cy = 132 + i * 9;
      ctx.fillText((battle.subCursor === i ? '▶' : '　') + `${n} x${GAME.items[n]}`, 6, cy);
    });
  }
}

/* ---------------------------------------------------------------------
   7. コアから委譲される戦闘用入力ハンドラ
--------------------------------------------------------------------- */
function pressABattle() {
  if (!GAME.battle) return;
  const battle = GAME.battle;

  if (battle.menuOpen) {
    battle.menuOpen = false;
    if (battle.cursor === 0) { battle.subMenu = 'fight'; battle.subCursor = 0; }
    else if (battle.cursor === 1) { battle.subMenu = 'item'; battle.subCursor = 0; }
    else if (battle.cursor === 2) { battle.subMenu = 'party'; battle.subCursor = 0; }
    else if (battle.cursor === 3) { attemptFlee(); }
    render();
    return;
  }

  if (battle.subMenu === 'fight') {
    executeTurn(battle.subCursor);
  } else if (battle.subMenu === 'item') {
    const names = Object.keys(GAME.items);
    useItem(names[battle.subCursor]);
  } else if (battle.subMenu === 'party') {
    switchActiveMon(battle.subCursor);
  }
  render();
}

function pressBBattle() {
  if (!GAME.battle) return;
  const battle = GAME.battle;
  if (battle.subMenu) { 
    battle.subMenu = null; 
    battle.menuOpen = true; 
    render(); 
  }
}

function pressDirBattle(dir) {
  if (!GAME.battle) return;
  const battle = GAME.battle;
  if (GAME.currentMessage !== null) return;

  if (battle.menuOpen) {
    if (dir === 'left' || dir === 'right') battle.cursor = battle.cursor % 2 === 0 ? battle.cursor + 1 : battle.cursor - 1;
    if (dir === 'up' || dir === 'down') battle.cursor = (battle.cursor + 2) % 4;
    render();
  } else if (battle.subMenu === 'fight') {
    const n = activeMon().moves.length;
    if (dir === 'left' || dir === 'right') battle.subCursor = (battle.subCursor + 1) % n;
    if (dir === 'up' || dir === 'down') battle.subCursor = (battle.subCursor + 2) % n;
    render();
  } else if (battle.subMenu === 'party') {
    const n = GAME.party.length;
    if (dir === 'up') battle.subCursor = (battle.subCursor - 1 + n) % n;
    if (dir === 'down') battle.subCursor = (battle.subCursor + 1) % n;
    render();
  } else if (battle.subMenu === 'item') {
    const n = Object.keys(GAME.items).length;
    if (dir === 'up') battle.subCursor = (battle.subCursor - 1 + n) % n;
    if (dir === 'down') battle.subCursor = (battle.subCursor + 1) % n;
    render();
  }
}
