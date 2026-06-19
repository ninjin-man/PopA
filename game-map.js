"use strict";

/* ---------------------------------------------------------------------
   1. フィールド移動処理 ＆ ワープ・エンカウント判定
--------------------------------------------------------------------- */
function tryMovePlayer(dx, dy) {
  if (GAME.scene !== 'field' || player.moveCooldown > 0) return;

  if (dx < 0) player.dir = 'left'; 
  else if (dx > 0) player.dir = 'right';
  else if (dy < 0) player.dir = 'up'; 
  else if (dy > 0) player.dir = 'down';

  const nx = player.x + dx;
  const ny = player.y + dy;

  // 進もうとした先が通行不可タイル、またはNPC衝突判定なら進めない
  if (tileAt(nx, ny) === 2) { 
    render(); 
    return; 
  }

  player.x = nx; 
  player.y = ny;
  player.moveCooldown = 9;

  const currentMap = MAPS[GAME.mapId];

  // ワープ判定
  const warp = currentMap.warps.find(w => w.x === player.x && w.y === player.y);
  if (warp) {
    GAME.mapId = warp.targetMap;
    player.x = warp.targetX;
    player.y = warp.targetY;
    render();
    return;
  }

  // エンカウント可能エリアでのみ草むら歩数・エンカウントチェック
  if (currentMap.encounter) {
    const currentTile = tileAt(player.x, player.y);
    if (currentTile === 1) { // 草むら
      GAME.stepCount++;
      if (rngRange(255) < 25) {
        triggerEncounter();
        return;
      }
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

  for (let s = 0; s < SLOT_WEIGHTS.length; s++) {
    acc += SLOT_WEIGHTS[s];
    if (slotRoll < acc) { 
      slot = s; 
      break; 
    }
  }

  const entry = ENCOUNTER_TABLE[slot];
  const lvl = entry.lvl[0] + rngRange(entry.lvl[1] - entry.lvl[0] + 1);
  const wildMon = makeMon(entry.sp, lvl, slot);

  if (typeof startBattle === 'function') {
    startBattle(wildMon);
  } else {
    console.warn("startBattle is not defined yet.");
  }
}

/* ---------------------------------------------------------------------
   3. カメラスクロール対応フィールド画面の描画
--------------------------------------------------------------------- */
function drawField() {
  const currentMap = MAPS[GAME.mapId];
  
  // カメラ座標の計算（プレイヤーを中心に置く。10x9マスの画面ウィンドウ）
  let camX = player.x - 4;
  let camY = player.y - 4;
  
  // カメラ位置がマップ外に出ないようにクランプ
  camX = Math.max(0, Math.min(camX, currentMap.cols - 10));
  camY = Math.max(0, Math.min(camY, currentMap.rows - 9));

  // 画面は常に 10 x 9 マス分のみ描画する
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 10; x++) {
      const mx = camX + x;
      const my = camY + y;
      
      const t = currentMap.tiles[my * currentMap.cols + mx];
      
      // 2:木/壁(最暗) / 1:草むら(暗) / 0:道(最明) / 4:ドア(最明)
      ctx.fillStyle = t === 2 ? PAL[0] : (t === 1 ? PAL[1] : PAL[3]);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      
      if (t === 1) { // 草
        ctx.fillStyle = PAL[0];
        ctx.fillRect(x * TILE + 3, y * TILE + 3, 2, 6);
        ctx.fillRect(x * TILE + 9, y * TILE + 6, 2, 6);
      }
      if (t === 0) { // 道
        ctx.fillStyle = PAL[2];
        ctx.fillRect(x * TILE + 1, y * TILE + 1, 1, 1);
      }
      if (t === 4) { // 建物ドアの黒枠表現
        ctx.fillStyle = PAL[0];
        ctx.fillRect(x * TILE + 2, y * TILE + 4, TILE - 4, TILE - 4);
      }
    }
  }

  // オブジェクト（NPC・看板）のカメラ空間への投影描画
  currentMap.objects.forEach(obj => {
    if (obj.x >= camX && obj.x < camX + 10 && obj.y >= camY && obj.y < camY + 9) {
      const ox = (obj.x - camX) * TILE;
      const oy = (obj.y - camY) * TILE;
      ctx.fillStyle = PAL[0];
      
      if (obj.type === 'npc') {
        // NPCは丸
        ctx.beginPath();
        ctx.arc(ox + TILE/2, oy + TILE/2, TILE/2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PAL[3];
        ctx.font = '6px monospace';
        ctx.fillText("N", ox + 5, oy + 10);
      } else {
        // 看板は角丸四角風
        ctx.fillRect(ox + 2, oy + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = PAL[3];
        ctx.font = '6px monospace';
        ctx.fillText("S", ox + 5, oy + 10);
      }
    }
  });

  // プレイヤーの相対位置描画
  const px = (player.x - camX) * TILE;
  const py = (player.y - camY) * TILE;
  ctx.fillStyle = PAL[0];
  ctx.fillRect(px + 3, py + 2, TILE - 6, TILE - 4);
  
  ctx.fillStyle = PAL[3];
  if (player.dir === 'up') ctx.fillRect(px + 6, py + 3, 4, 2);
  else if (player.dir === 'down') ctx.fillRect(px + 6, py + TILE - 6, 4, 2);
  else if (player.dir === 'left') ctx.fillRect(px + 3, py + 6, 2, 4);
  else ctx.fillRect(px + TILE - 5, py + 6, 2, 4);

  // マップ名・歩数のUI
  ctx.fillStyle = PAL[0];
  ctx.font = '7px monospace';
  ctx.fillText(`${currentMap.name} (${GAME.stepCount}歩)`, 2, 10);
  
  if (GAME.currentMessage !== null) {
    drawMessageWindow();
  }
}

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
   4. ステータス画面（メニュー・レポート選択肢追加）
--------------------------------------------------------------------- */
function drawStatus() {
  ctx.fillStyle = PAL[3];
  ctx.fillRect(0, 0, 160, 144);
  
  ctx.fillStyle = PAL[0];
  ctx.font = '9px monospace';
  ctx.fillText('— パーティ —', 6, 12);
  
  ctx.font = '7px monospace';
  GAME.party.forEach((m, i) => {
    const y = 24 + i * 20;
    ctx.fillText(`${TYPE_EMOJI[m.species.type] || '⬜'} ${m.species.name}  Lv${m.level}`, 6, y);
    ctx.fillText(`HP ${m.curHP}/${m.maxHP}  DV:${m.dv.atk}/${m.dv.def}/${m.dv.spd}/${m.dv.spc}/${m.dv.hp}`, 6, y + 8);
  });
  
  ctx.font = '8px monospace';
  ctx.fillText('— ボックス —', 6, 72);
  
  ctx.font = '7px monospace';
  GAME.box.slice(0, 3).forEach((b, i) => {
    const mon = withdrawFromBox(b);
    ctx.fillText(`${TYPE_EMOJI[SPECIES[b[0]].type]} ${SPECIES[b[0]].name} Lv${mon.level} 経験:${mon.exp}`, 6, 82 + i * 8);
  });
  
  // メニュー選択肢（レポート機能対応）
  ctx.strokeStyle = PAL[0];
  ctx.strokeRect(4, 114, 152, 26);
  ctx.fillStyle = PAL[0];
  ctx.font = '8px monospace';
  
  ctx.fillText((GAME.statusCursor === 0 ? '▶' : '　') + 'パーティ2番目 ⇔ ボックス1番目を交換', 8, 123);
  ctx.fillText((GAME.statusCursor === 1 ? '▶' : '　') + 'レポート（現在の状態をセーブする）', 8, 133);
}
