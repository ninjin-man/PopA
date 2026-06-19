"use strict";

/* ---------------------------------------------------------------------
   1. フィールド移動処理 & エンカウント判定
--------------------------------------------------------------------- */
function tryMovePlayer(dx, dy) {
  // フィールドシーン以外、または歩行クールダウン中は移動不可
  if (GAME.scene !== 'field' || player.moveCooldown > 0) return;

  // プレイヤーの向きを更新
  if (dx < 0) player.dir = 'left'; 
  else if (dx > 0) player.dir = 'right';
  else if (dy < 0) player.dir = 'up'; 
  else if (dy > 0) player.dir = 'down';

  const nx = player.x + dx;
  const ny = player.y + dy;

  // 進もうとした先が「木（2）」なら進めない（向きだけ変わる）
  if (tileAt(nx, ny) === 2) { 
    render(); 
    return; 
  }

  // 座標を更新し、歩行クールダウンを設定（アニメーション速度の模倣）
  player.x = nx; 
  player.y = ny;
  player.moveCooldown = 9;

  // 現在のタイルの種類をチェック
  const currentTile = tileAt(player.x, player.y);
  if (currentTile === 1) { // 草むらタイル
    GAME.stepCount++;
    
    // 1歩ごとに初代風の確率（255分の25）でエンカウント判定
    if (rngRange(255) < 25) {
      triggerEncounter();
      return;
    }
  }
  render();
}

/* ---------------------------------------------------------------------
   2. 野生エンカウント生成ロジック
--------------------------------------------------------------------- */
function triggerEncounter() {
  const slotRoll = rngRange(255);
  let acc = 0;
  let slot = SLOT_WEIGHTS.length - 1;

  // 確率の重みに基づいて10個のスロットから選出
  for (let s = 0; s < SLOT_WEIGHTS.length; s++) {
    acc += SLOT_WEIGHTS[s];
    if (slotRoll < acc) { 
      slot = s; 
      break; 
    }
  }

  const entry = ENCOUNTER_TABLE[slot];
  // テーブルに定義されたレベルの範囲からランダムに決定
  const lvl = entry.lvl[0] + rngRange(entry.lvl[1] - entry.lvl[0] + 1);
  
  // 野生モンスターを生成（スロットインデックスを渡してレア枠のDVマスクを適用）
  const wildMon = makeMon(entry.sp, lvl, slot);

  // 戦闘シーンを開始（game-battle.js が読み込まれると実行可能になります）
  if (typeof startBattle === 'function') {
    startBattle(wildMon);
  } else {
    console.warn("startBattle is not defined yet. (Waiting for game-battle.js)");
  }
}

/* ---------------------------------------------------------------------
   3. フィールド画面の描画
--------------------------------------------------------------------- */
function drawField() {
  // マップタイルの描画
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = MAP[y * COLS + x];
      // 2:木(最暗) / 1:草むら(暗) / 0:道(最明)
      ctx.fillStyle = t === 2 ? PAL[0] : (t === 1 ? PAL[1] : PAL[3]);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      
      // 草むらのドット模様
      if (t === 1) {
        ctx.fillStyle = PAL[0];
        ctx.fillRect(x * TILE + 3, y * TILE + 3, 2, 6);
        ctx.fillRect(x * TILE + 9, y * TILE + 6, 2, 6);
      }
      // 道の砂利ドット模様
      if (t === 0) {
        ctx.fillStyle = PAL[2];
        ctx.fillRect(x * TILE + 1, y * TILE + 1, 1, 1);
      }
    }
  }

  // プレイヤーの描画（ドット風の矩形）
  const px = player.x * TILE;
  const py = player.y * TILE;
  ctx.fillStyle = PAL[0];
  ctx.fillRect(px + 3, py + 2, TILE - 6, TILE - 4); // 体
  
  // 向きに応じた「目」の表現
  ctx.fillStyle = PAL[3];
  if (player.dir === 'up') ctx.fillRect(px + 6, py + 3, 4, 2);
  else if (player.dir === 'down') ctx.fillRect(px + 6, py + TILE - 6, 4, 2);
  else if (player.dir === 'left') ctx.fillRect(px + 3, py + 6, 2, 4);
  else ctx.fillRect(px + TILE - 5, py + 6, 2, 4);

  // 歩数UIの表示
  ctx.fillStyle = PAL[0];
  ctx.font = '7px monospace';
  ctx.fillText(`steps:${GAME.stepCount}`, 2, 10);
  
  // メッセージウィンドウがアクティブなら最前面に描画
  if (GAME.currentMessage !== null) {
    drawMessageWindow();
  }
}

// フィールド上での簡易メッセージウィンドウ描画用
function drawMessageWindow() {
  ctx.fillStyle = PAL[3];
  ctx.fillRect(2, 126, 156, 16);
  ctx.strokeStyle = PAL[0];
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 126, 156, 16);
  
  ctx.fillStyle = PAL[0];
  ctx.font = '8px monospace';
  ctx.fillText(GAME.currentMessage.slice(0, 34), 6, 136);
}

/* ---------------------------------------------------------------------
   4. ステータス画面（メニュー）の描画
--------------------------------------------------------------------- */
function drawStatus() {
  ctx.fillStyle = PAL[3];
  ctx.fillRect(0, 0, 160, 144);
  
  ctx.fillStyle = PAL[0];
  ctx.font = '9px monospace';
  ctx.fillText('— パーティ —', 6, 14);
  
  ctx.font = '7px monospace';
  // てもちポケモンのステータス・個体値（DV）を表示
  GAME.party.forEach((m, i) => {
    const y = 28 + i * 22;
    ctx.fillText(`${TYPE_EMOJI[m.species.type] || '⬜'} ${m.species.name}  Lv${m.level}`, 6, y);
    ctx.fillText(`HP ${m.curHP}/${m.maxHP}  DV(A/D/S/Sp/H):${m.dv.atk}/${m.dv.def}/${m.dv.spd}/${m.dv.spc}/${m.dv.hp}`, 6, y + 9);
  });
  
  ctx.font = '9px monospace';
  ctx.fillText('— ボックス（レベル非保持） —', 6, 100);
  
  ctx.font = '7px monospace';
  // パソコン内のボックス預かりモンスターを表示（44バイトからその場で逆算）
  GAME.box.forEach((b, i) => {
    const mon = withdrawFromBox(b);
    ctx.fillText(`${TYPE_EMOJI[SPECIES[b.speciesId].type] || '⬜'} ${SPECIES[b.speciesId].name}  経験値:${mon.exp} → 逆算Lv${mon.level}`, 6, 110 + i * 9);
  });
  
  // 操作ガイド
  ctx.fillText((GAME.statusCursor === 0 ? '▶' : '　') + 'パーティ2番目 ⇔ ボックス1番目 を交換', 4, 134);
  ctx.fillText('Aで交換 / Bで とじる', 4, 142);
}
