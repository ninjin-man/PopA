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
   3. キャラクター／オブジェクトのスプライト描画
--------------------------------------------------------------------- */
// プレイヤー：帽子をかぶったチビキャラ（向きでツバと目の位置が変わる）
function drawPlayerSprite(px, py, dir) {
  const cx = px + TILE / 2;

  // 影
  ctx.fillStyle = PAL[1];
  ctx.beginPath();
  ctx.ellipse(cx, py + TILE - 2, 5, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 体
  ctx.fillStyle = PAL[0];
  ctx.fillRect(cx - 4, py + 8, 8, 6);

  // 頭
  ctx.beginPath();
  ctx.arc(cx, py + 6, 4, 0, Math.PI * 2);
  ctx.fill();

  // 帽子のツバ（向いている方向に張り出す）
  ctx.fillStyle = PAL[1];
  if (dir === 'down') ctx.fillRect(cx - 4, py + 4, 8, 2);
  else if (dir === 'up') ctx.fillRect(cx - 3, py + 1, 6, 2);
  else if (dir === 'left') ctx.fillRect(cx - 6, py + 4, 6, 2);
  else ctx.fillRect(cx, py + 4, 6, 2);

  // 目（後ろ向きの時は見えない）
  if (dir !== 'up') {
    ctx.fillStyle = PAL[3];
    if (dir === 'down') {
      ctx.fillRect(cx - 2, py + 6, 1, 1);
      ctx.fillRect(cx + 1, py + 6, 1, 1);
    } else if (dir === 'left') {
      ctx.fillRect(cx - 3, py + 6, 1, 1);
    } else {
      ctx.fillRect(cx + 2, py + 6, 1, 1);
    }
  }
}

// NPC：帽子なしのチビキャラ（プレイヤーと見分けがつくシルエット）
function drawNpcSprite(ox, oy) {
  const cx = ox + TILE / 2;

  ctx.fillStyle = PAL[1];
  ctx.beginPath();
  ctx.ellipse(cx, oy + TILE - 2, 5, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PAL[0];
  ctx.fillRect(cx - 4, oy + 8, 8, 6);
  ctx.beginPath();
  ctx.arc(cx, oy + 6, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PAL[3];
  ctx.fillRect(cx - 2, oy + 6, 1, 1);
  ctx.fillRect(cx + 1, oy + 6, 1, 1);
}

// 看板：支柱付きの木の立て札
function drawSignSprite(ox, oy) {
  ctx.fillStyle = PAL[0];
  ctx.fillRect(ox + 7, oy + 8, 2, 6);
  ctx.fillRect(ox + 2, oy + 2, TILE - 4, 7);
  ctx.fillStyle = PAL[3];
  ctx.fillRect(ox + 4, oy + 4, TILE - 8, 1);
  ctx.fillRect(ox + 4, oy + 6, TILE - 8, 1);
}

/* ---------------------------------------------------------------------
   4. カメラスクロール対応フィールド画面の描画
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
      const px = x * TILE, py = y * TILE;

      if (t === 2) {
        // 木：暗い地面の上に丸い樹冠＋葉のハイライト（マス位置で固定パターン＝チラつかない）
        ctx.fillStyle = PAL[0];
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PAL[1];
        ctx.beginPath();
        ctx.arc(px + 8, py + 8, 6, 0, Math.PI * 2);
        ctx.fill();
        const dots = [[5, 5], [10, 6], [6, 10], [10, 11]];
        const d = dots[(mx * 7 + my * 13) % dots.length];
        ctx.fillStyle = PAL[2];
        ctx.fillRect(px + d[0], py + d[1], 2, 2);
      } else if (t === 1) {
        // 草むら：3パターンの草の生え方をマス位置で固定選択
        ctx.fillStyle = PAL[1];
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PAL[0];
        const variant = (mx + my) % 3;
        if (variant === 0) {
          ctx.fillRect(px + 3, py + 3, 2, 6);
          ctx.fillRect(px + 9, py + 6, 2, 6);
        } else if (variant === 1) {
          ctx.fillRect(px + 2, py + 5, 2, 6);
          ctx.fillRect(px + 8, py + 3, 2, 6);
          ctx.fillRect(px + 12, py + 7, 2, 5);
        } else {
          ctx.fillRect(px + 4, py + 4, 2, 7);
          ctx.fillRect(px + 10, py + 5, 2, 6);
        }
      } else if (t === 4) {
        // ドア：壁の中に暗い入口とアクセント
        ctx.fillStyle = PAL[1];
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PAL[0];
        ctx.fillRect(px + 3, py + 5, TILE - 6, TILE - 5);
        ctx.fillStyle = PAL[2];
        ctx.fillRect(px + 4, py + 7, 2, 2);
      } else {
        // 道：小石の点をマス位置で固定散らす
        ctx.fillStyle = PAL[3];
        ctx.fillRect(px, py, TILE, TILE);
        const variant = (mx * 3 + my * 5) % 5;
        ctx.fillStyle = PAL[2];
        if (variant === 0) ctx.fillRect(px + 2, py + 2, 1, 1);
        else if (variant === 2) ctx.fillRect(px + 11, py + 9, 1, 1);
        else if (variant === 3) ctx.fillRect(px + 6, py + 12, 1, 1);
      }
    }
  }

  // オブジェクト（NPC・看板）のカメラ空間への投影描画
  currentMap.objects.forEach(obj => {
    if (obj.x >= camX && obj.x < camX + 10 && obj.y >= camY && obj.y < camY + 9) {
      const ox = (obj.x - camX) * TILE;
      const oy = (obj.y - camY) * TILE;
      if (obj.type === 'npc') drawNpcSprite(ox, oy);
      else drawSignSprite(ox, oy);
    }
  });

  // プレイヤーの相対位置描画
  const px = (player.x - camX) * TILE;
  const py = (player.y - camY) * TILE;
  drawPlayerSprite(px, py, player.dir);

  // マップ名・歩数のUI（読みやすいよう背景ボックス付き）
  ctx.fillStyle = PAL[3];
  ctx.fillRect(0, 0, 110, 11);
  ctx.strokeStyle = PAL[0];
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, 110, 11);
  ctx.fillStyle = PAL[0];
  ctx.font = '7px monospace';
  ctx.fillText(`${currentMap.name} (${GAME.stepCount}歩)`, 3, 9);
  
  if (GAME.currentMessage !== null) {
    drawMessageWindow();
  }
}

function drawMessageWindow() {
  const boxX = 2, boxY = 98, boxW = 156, boxH = 44;
  ctx.fillStyle = PAL[3];
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = PAL[0];
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.font = '8px monospace';
  const lines = wrapMessage(GAME.currentMessage, boxW - 16).slice(0, 3);
  lines.forEach((line, i) => {
    ctx.fillStyle = PAL[0];
    ctx.fillText(line, boxX + 6, boxY + 14 + i * 12);
  });
  ctx.font = '7px monospace';
  ctx.fillText('▶', boxX + boxW - 12, boxY + boxH - 6);
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
