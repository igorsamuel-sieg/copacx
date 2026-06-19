require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

const PORT = process.env.PORT || 3000;
const MASTER_PASSWORD    = process.env.MASTER_PASSWORD    || 'cxsieg2025';
const SPECTATOR_PASSWORD = process.env.SPECTATOR_PASSWORD || 'espectador';

// ── Anti-brute-force: limita tentativas de senha por IP ──────────────────────
const pwAttempts = new Map(); // ip -> { count, resetAt }
const MAX_PW_ATTEMPTS = 8;
const PW_WINDOW_MS = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const rec = pwAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    pwAttempts.set(ip, { count: 1, resetAt: now + PW_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_PW_ATTEMPTS;
}

// ── Anti-bot: limita a velocidade de cliques por jogador ─────────────────────
const MIN_CLICK_INTERVAL_MS = 280; // cliques mais rápidos que isso são ignorados (bots/scripts)

// ── Regra de encerramento: jogo acaba para todos quando N jogadores completarem ──
const TOP_FINISHERS = 3;

// ── In-memory state ──────────────────────────────────────────────────────────
const rooms = {};

function createRoom(roomId) {
  return {
    roomId,
    gameStatus: 'waiting', // waiting | playing | finished
    winner: null,
    finishers: [], // ordered list of players who found all 7 errors: { id, name, team, totalClicks, totalWrong, finishedAt }
    players: {},
    // Master-defined team rosters: { 'branco': ['Ana','João'], ... }
    teamRosters: { branco: [], amarelo: [], azul: [], verde: [] },
    createdAt: Date.now(),
  };
}

function createPlayer(id, name, team, isMaster) {
  return {
    id, name, team, isMaster,
    found: [],
    totalClicks: 0,
    wrongStreak: 0,
    totalWrong: 0,
    lockedUntil: 0,
    lastClickAt: 0,
    clickLog: [],
    joinedAt: Date.now(),
  };
}

// ── 7 erros mapeados na Imagem B — coordenadas geradas por generate-images.js ──
// Layout: 6 linhas × 14 colunas, célula 100×80px, SVG 1400×480
//  1. Linha 1 col 12 — bandeira invertida (verde/amarelo/azul → azul/amarelo/verde)
//  2. Linha 2 col  5 — chapéu de bola amarela aparece
//  3. Linha 3 col 14 — boné azul → verde
//  4. Linha 4 col  2 — camisa branca → amarela
//  5. Linha 4 col 10 — camisa verde → azul
//  6. Linha 5 col 13 — óculos aparecem
//  7. Linha 6 col  6 — boné amarelo → azul

const ERRORS = [
  { x: 0.8214, y: 0.0833, r: 0.05, label: 'Bandeira invertida (r0c11)' },
  { x: 0.3214, y: 0.2500, r: 0.05, label: 'Chapéu bola amarela (r1c4)' },
  { x: 0.9643, y: 0.4167, r: 0.05, label: 'Boné azul→verde (r2c13)' },
  { x: 0.1071, y: 0.5833, r: 0.05, label: 'Camisa branca→amarela (r3c1)' },
  { x: 0.6786, y: 0.5833, r: 0.05, label: 'Camisa verde→azul (r3c9)' },
  { x: 0.8929, y: 0.7500, r: 0.05, label: 'Óculos aparecem (r4c12)' },
  { x: 0.3929, y: 0.9167, r: 0.05, label: 'Boné amarelo→azul (r5c5)' },
];
const TOTAL_ERRORS = ERRORS.length; // 7

function checkHit(xPct, yPct, found) {
  for (let i = 0; i < ERRORS.length; i++) {
    if (found.includes(i)) continue;
    const dx = xPct - ERRORS[i].x;
    const dy = yPct - ERRORS[i].y;
    if (Math.sqrt(dx * dx + dy * dy) < ERRORS[i].r) return i;
  }
  return -1;
}

// ── Encerra o jogo para todos: monta ranking final e dispara o anúncio ───────
// Ordem do ranking: 1º quem terminou (na ordem em que terminou — finishers),
// depois os demais jogadores ordenados por progresso (mais erros encontrados,
// menos cliques como critério de desempate).
function finishGame(room) {
  room.gameStatus = 'finished';

  const finisherIds = new Set(room.finishers.map(f => f.id));
  const rest = Object.values(room.players)
    .filter(p => !p.isMaster && !p.isSpectator && !finisherIds.has(p.id))
    .sort((a, b) => b.found.length - a.found.length || a.totalClicks - b.totalClicks)
    .map(p => ({ name: p.name, team: p.team, found: p.found.length, totalClicks: p.totalClicks, totalWrong: p.totalWrong }));

  const finishersRanked = room.finishers.map(f => ({
    name: f.name, team: f.team, found: TOTAL_ERRORS,
    totalClicks: f.totalClicks, totalWrong: f.totalWrong,
  }));

  const ranking = [...finishersRanked, ...rest];

  // O "winner" oficial é sempre o 1º colocado (primeiro a completar os 7 erros)
  room.winner = room.finishers[0]
    ? { ...room.finishers[0] }
    : (ranking[0] ? { name: ranking[0].name, team: ranking[0].team, totalClicks: ranking[0].totalClicks, totalWrong: ranking[0].totalWrong } : null);

  const payload = { type: 'winner_announced', winner: room.winner, players: ranking, finishers: room.finishers };
  broadcast(room.roomId, payload);
  broadcastToMasters(room.roomId, payload);
  broadcastToSpectators(room.roomId, payload);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function broadcast(roomId, payload, excludeWs = null) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws.roomId === roomId && ws !== excludeWs) {
      ws.send(msg);
    }
  });
}
function broadcastToMasters(roomId, payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws.roomId === roomId && ws.isMaster) ws.send(msg);
  });
}
function broadcastToSpectators(roomId, payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws.roomId === roomId && ws.isSpectator) ws.send(msg);
  });
}

function spectatorSnapshot(room) {
  const players = Object.values(room.players)
    .filter(p => !p.isMaster && !p.isSpectator)
    .sort((a,b) => b.found.length - a.found.length || a.totalClicks - b.totalClicks)
    .map(p => ({ id: p.id, name: p.name, team: p.team, found: p.found.length, totalClicks: p.totalClicks }));
  return {
    type: 'spectator_state',
    gameStatus: room.gameStatus,
    totalErrors: TOTAL_ERRORS,
    players,
    teamRosters: room.teamRosters,
    winner: room.gameStatus === 'finished' ? room.winner : null,
  };
}

function roomSnapshot(room, forMaster = false) {
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    isMaster: p.isMaster,
    found: p.found.length,
    totalClicks: forMaster ? p.totalClicks : undefined,
    totalWrong:  forMaster ? p.totalWrong  : undefined,
    lockedUntil: forMaster ? p.lockedUntil : undefined,
    clickLog:    forMaster ? p.clickLog    : undefined,
  }));
  return {
    type: 'room_state',
    roomId: room.roomId,
    gameStatus: room.gameStatus,
    totalErrors: TOTAL_ERRORS,
    teamRosters: room.teamRosters,
    winner: forMaster ? room.winner : (room.gameStatus === 'finished' ? room.winner : null),
    players,
  };
}

// ── WebSocket protocol ────────────────────────────────────────────────────────
const masterTokens = new Map(); // token -> { ip, expiresAt }

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws._clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join': {
        const { name, team, roomId, masterPassword, spectatorPassword } = msg;
        if (!roomId) return ws.send(JSON.stringify({ type: 'error', text: 'Código da sala obrigatório.' }));

        // Anti-brute-force: limita tentativas de senha master/espectador por IP
        if (masterPassword || spectatorPassword) {
          const ip = ws._clientIp || 'unknown';
          if (isRateLimited(ip)) {
            return ws.send(JSON.stringify({ type: 'error', text: 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' }));
          }
        }

        const isMaster    = masterPassword    === MASTER_PASSWORD;
        const isSpectator = spectatorPassword === SPECTATOR_PASSWORD;

        if (masterPassword    && !isMaster)    return ws.send(JSON.stringify({ type: 'error', text: 'Senha do Master incorreta!' }));
        if (spectatorPassword && !isSpectator) return ws.send(JSON.stringify({ type: 'error', text: 'Código de espectador incorreto!' }));
        if (!isSpectator && !isMaster && (!name || !team)) return ws.send(JSON.stringify({ type: 'error', text: 'Dados incompletos.' }));
        if (!isSpectator && !isMaster && name.length > 30) return ws.send(JSON.stringify({ type: 'error', text: 'Nome muito longo.' }));

        if (!rooms[roomId]) {
          if (!isMaster) return ws.send(JSON.stringify({ type: 'error', text: 'Sala não encontrada. O Master deve entrar primeiro.' }));
          rooms[roomId] = createRoom(roomId);
        }

        const room = rooms[roomId];
        if (room.gameStatus === 'playing' && !isMaster && !isSpectator) {
          return ws.send(JSON.stringify({ type: 'error', text: 'O jogo já começou! Aguarde a próxima rodada.' }));
        }

        // Evita que a mesma pessoa entre duas vezes na sala (multi-aba) durante o mesmo time/nome
        if (!isSpectator && !isMaster) {
          const dup = Object.values(room.players).find(p => !p.isMaster && p.name.trim().toLowerCase() === name.trim().toLowerCase());
          if (dup) {
            return ws.send(JSON.stringify({ type: 'error', text: 'Esse nome já está em uso nesta sala. Escolha outro nome.' }));
          }
        }

        const playerId = crypto.randomUUID();
        if (!isSpectator) {
          room.players[playerId] = createPlayer(playerId, name, team, isMaster);
        }

        ws.roomId     = roomId;
        ws.playerId   = playerId;
        ws.isMaster   = isMaster;
        ws.isSpectator = isSpectator;

        let gabaritoToken = null;
        if (isMaster) {
          gabaritoToken = crypto.randomBytes(24).toString('hex');
          masterTokens.set(gabaritoToken, { ip: ws._clientIp, expiresAt: Date.now() + 30*60*1000 });
          setTimeout(() => masterTokens.delete(gabaritoToken), 30 * 60 * 1000);
        }

        ws.send(JSON.stringify({ type: 'joined', playerId, isMaster, isSpectator, roomId, totalErrors: TOTAL_ERRORS, gabaritoToken }));

        if (isSpectator) {
          ws.send(JSON.stringify(spectatorSnapshot(room)));
        } else {
          ws.send(JSON.stringify(roomSnapshot(room, isMaster)));
          broadcast(roomId, roomSnapshot(room, false), ws);
          broadcastToMasters(roomId, roomSnapshot(room, true));
        }
        break;
      }

      case 'update_rosters': {
        // Master sends full team rosters: { branco: [...], amarelo: [...], azul: [...], verde: [...] }
        const room = rooms[ws.roomId];
        if (!room || !ws.isMaster) return;
        const { rosters } = msg;
        if (rosters && typeof rosters === 'object') {
          room.teamRosters = rosters;
          broadcast(ws.roomId, { type: 'rosters_updated', teamRosters: rosters });
          ws.send(JSON.stringify({ type: 'rosters_updated', teamRosters: rosters }));
          broadcastToSpectators(ws.roomId, { type: 'rosters_updated', teamRosters: rosters });
        }
        break;
      }

      case 'master_start': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isMaster) return;
        room.gameStatus = 'playing';
        broadcast(ws.roomId, { type: 'game_started' });
        ws.send(JSON.stringify({ type: 'game_started' }));
        broadcastToSpectators(ws.roomId, { type: 'game_started' });
        break;
      }

      case 'click': {
        const room = rooms[ws.roomId];
        if (!room || room.gameStatus !== 'playing') return;
        const player = room.players[ws.playerId];
        if (!player || player.isMaster) return;

        // Jogador que já completou os 7 erros não pode mais clicar — está aguardando o fim da rodada
        if (player.found.length >= TOTAL_ERRORS) return;

        const now = Date.now();
        if (player.lockedUntil > now) {
          return ws.send(JSON.stringify({ type: 'locked', lockedUntil: player.lockedUntil, remaining: player.lockedUntil - now }));
        }

        // Anti-bot: ignora cliques disparados rápido demais para ser um clique humano real
        if (now - player.lastClickAt < MIN_CLICK_INTERVAL_MS) return;
        player.lastClickAt = now;

        const { x, y } = msg;
        if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return;
        const xPct = Math.max(0, Math.min(1, x));
        const yPct = Math.max(0, Math.min(1, y));

        player.totalClicks++;
        const hitIndex = checkHit(xPct, yPct, player.found);
        const isCorrect = hitIndex !== -1;

        if (isCorrect) {
          player.found.push(hitIndex);
          player.wrongStreak = 0;
        } else {
          player.wrongStreak = (player.wrongStreak || 0) + 1;
          player.totalWrong++;
          if (player.wrongStreak >= 3) {
            const penaltyMs = Math.min((player.wrongStreak - 2) * 1000, 15000);
            player.lockedUntil = now + penaltyMs;
          }
        }

        player.clickLog.push({ x: Math.round(xPct*1000)/1000, y: Math.round(yPct*1000)/1000, correct: isCorrect, errorIndex: isCorrect ? hitIndex : null, time: now });

        ws.send(JSON.stringify({
          type: 'click_result',
          correct: isCorrect,
          x: xPct, y: yPct,
          errorIndex: isCorrect ? hitIndex : null,
          found: player.found,
          totalClicks: player.totalClicks,
          penaltyMs: (!isCorrect && player.wrongStreak >= 3) ? Math.min((player.wrongStreak-2)*1000,15000) : 0,
          wrongStreak: player.wrongStreak || 0,
        }));

        // ── Jogador completou os 7 erros ──
        if (player.found.length === TOTAL_ERRORS && room.gameStatus === 'playing') {
          const alreadyFinished = room.finishers.some(f => f.id === player.id);
          if (!alreadyFinished) {
            const place = room.finishers.length + 1;
            const finisherInfo = {
              id: player.id, name: player.name, team: player.team,
              totalClicks: player.totalClicks, totalWrong: player.totalWrong,
              place, finishedAt: now,
            };
            room.finishers.push(finisherInfo);

            // Avisa o próprio jogador que terminou e em qual posição ficou
            ws.send(JSON.stringify({ type: 'you_finished', place }));
            // Avisa os demais (sem revelar quem é) que alguém terminou
            broadcast(ws.roomId, { type: 'finisher_update', count: room.finishers.length, needed: TOP_FINISHERS }, ws);
            broadcastToSpectators(ws.roomId, { type: 'finisher_update', count: room.finishers.length, needed: TOP_FINISHERS });
            // Master vê o ranking parcial em tempo real
            broadcastToMasters(ws.roomId, { type: 'finishers_update', finishers: room.finishers });

            // ── Atingiu o número de finalistas necessário: encerra para todos ──
            if (room.finishers.length >= TOP_FINISHERS) {
              finishGame(room);
            }
          }
        }

        broadcastToMasters(ws.roomId, roomSnapshot(room, true));
        broadcast(ws.roomId, roomSnapshot(room, false));
        broadcastToSpectators(ws.roomId, spectatorSnapshot(room));
        break;
      }

      case 'announce_winner': {
        // Encerramento manual de emergência pelo Master (caso queira finalizar antes do top 3)
        const room = rooms[ws.roomId];
        if (!room || !ws.isMaster || room.gameStatus !== 'playing') return;
        finishGame(room);
        break;
      }

      case 'master_reset': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isMaster) return;
        room.gameStatus = 'waiting';
        room.winner = null;
        room.finishers = [];
        Object.values(room.players).forEach(p => {
          p.found = []; p.totalClicks = 0; p.wrongStreak = 0;
          p.totalWrong = 0; p.lockedUntil = 0; p.lastClickAt = 0; p.clickLog = [];
        });
        broadcast(ws.roomId, { type: 'game_reset' });
        ws.send(JSON.stringify({ type: 'game_reset' }));
        broadcastToSpectators(ws.roomId, { type: 'game_reset' });
        break;
      }

      case 'kick_player': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isMaster) return;
        const { targetId } = msg;
        if (room.players[targetId]) {
          delete room.players[targetId];
          wss.clients.forEach(c => { if (c.playerId === targetId) c.send(JSON.stringify({ type: 'kicked' })); });
          broadcast(ws.roomId, roomSnapshot(room, false));
          broadcastToMasters(ws.roomId, roomSnapshot(room, true));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;
    const room = rooms[ws.roomId];
    if (!room) return;
    if (!ws.isSpectator && ws.playerId) {
      delete room.players[ws.playerId];
      broadcast(ws.roomId, roomSnapshot(room, false));
      broadcastToMasters(ws.roomId, roomSnapshot(room, true));
    }
    if (Object.keys(room.players).length === 0) delete rooms[ws.roomId];
  });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ── Static / image routes ─────────────────────────────────────────────────────
// Gabarito (com os 7 erros numerados) — acesso só para Master autenticado,
// token de uso único amarrado ao IP que o solicitou, expira em 30min.
app.get('/images/gabarito.png', (req, res) => {
  const token = req.query.t;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const rec = masterTokens.get(token);
  if (!rec) return res.status(403).send('Forbidden');
  if (rec.ip && rec.ip !== ip) return res.status(403).send('Forbidden'); // token vinculado a outro IP
  res.set('Content-Type', 'image/svg+xml');
  res.sendFile(path.join(__dirname, 'public/images/gabarito-annotated.svg'));
});

app.use('/images', express.static(path.join(__dirname, 'public/images'), {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('original.webp') || filePath.endsWith('gabarito-annotated.svg')) {
      res.status(403).end();
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => {
  console.log(`\n⚽ VAR da Qualidade — Copa CX SIEG`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🔑 Senha Master: ${MASTER_PASSWORD}`);
  console.log(`👁  Código Espectador: ${SPECTATOR_PASSWORD}\n`);
});
