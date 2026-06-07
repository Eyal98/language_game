const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const WORDS_PATH = path.join(__dirname, 'data', 'words.json');
const ROUND_TIMEOUT_MS = 30000;
const ROUND_DELAY_MS = 3000;
// Cap on how many rounds a single game can run. Derived from the data when
// possible, falling back to this value.
const DEFAULT_MAX_ROUNDS = 8;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load word data defensively — a malformed file shouldn't leave a half-started server.
let wordsData;
try {
  wordsData = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
} catch (err) {
  console.error(`Failed to read/parse ${WORDS_PATH}: ${err.message}`);
  process.exit(1);
}
if (!wordsData || !Array.isArray(wordsData.words)) {
  console.error('words.json must contain a "words" array.');
  process.exit(1);
}

// Round cap derives from the data (override with MAX_ROUNDS) so adding words just works.
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS, 10) || wordsData.words.length;

let gameState = {
  status: 'waiting',
  currentWord: null,
  scores: { player1: 0, player2: 0 },
  roundNumber: 0,
  totalRounds: 0,
  usedWords: [],
  shuffledWords: [],
  roundLocked: false,
  showNikkud: true,
  lastScannedUid: null
};

// A word is playable only when both players' cards are registered, so a single
// reader can tell the racers apart by which card UID was scanned.
function isWordReady(w) {
  return !!w.cardUidP1 && !!w.cardUidP2;
}

// Identify which player owns a scanned card by searching both card slots of
// every word. Returns { player, word } or null for an unknown card.
function identifyCard(uid) {
  for (const w of wordsData.words) {
    if (w.cardUidP1 === uid) return { player: 'player1', word: w };
    if (w.cardUidP2 === uid) return { player: 'player2', word: w };
  }
  return null;
}

let roundTimer = null;     // the in-round countdown (ROUND_TIMEOUT_MS)
let nextRoundTimer = null; // the inter-round delay before the next word (ROUND_DELAY_MS)

// Atomic save: write to a temp file then rename, so a crash mid-write can't corrupt words.json.
function saveWords() {
  const tmp = `${WORDS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(wordsData, null, 2), 'utf8');
  fs.renameSync(tmp, WORDS_PATH);
}

// Schedule the next round, replacing any pending one so a stale timer can't fire into a new game.
function scheduleNextRound() {
  clearTimeout(nextRoundTimer);
  nextRoundTimer = setTimeout(startNewRound, ROUND_DELAY_MS);
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startNewRound() {
  if (gameState.roundNumber >= gameState.totalRounds) {
    gameState.status = 'gameOver';
    let winner = 'tie';
    if (gameState.scores.player1 > gameState.scores.player2) winner = 'player1';
    else if (gameState.scores.player2 > gameState.scores.player1) winner = 'player2';
    broadcast({
      event: 'gameOver',
      scores: gameState.scores,
      winner
    });
    return;
  }

  gameState.currentWord = gameState.shuffledWords[gameState.roundNumber];
  gameState.roundNumber++;
  gameState.roundLocked = false;
  gameState.status = 'playing';

  broadcast({
    event: 'newRound',
    roundNumber: gameState.roundNumber,
    totalRounds: gameState.totalRounds,
    word: {
      id: gameState.currentWord.id,
      hebrew: gameState.currentWord.hebrew,
      hebrewNikkud: gameState.currentWord.hebrewNikkud,
      category: gameState.currentWord.category
    },
    showNikkud: gameState.showNikkud,
    roundDurationMs: ROUND_TIMEOUT_MS,
    scores: gameState.scores
  });

  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    if (gameState.status === 'playing' && !gameState.roundLocked) {
      gameState.roundLocked = true;
      gameState.status = 'roundEnd';
      broadcast({
        event: 'roundTimeout',
        word: gameState.currentWord,
        scores: gameState.scores
      });
      scheduleNextRound();
    }
  }, ROUND_TIMEOUT_MS);
}

function startGame() {
  // Only words with BOTH players' cards registered can be raced on one reader.
  const readyWords = wordsData.words.filter(isWordReady);
  const count = Math.min(readyWords.length, MAX_ROUNDS);
  if (count === 0) {
    return { error: 'No words ready. In /admin, assign both a Player 1 and a Player 2 card to at least one word.' };
  }

  // Cancel any pending timers from a previous game so they can't corrupt this fresh one.
  clearTimeout(roundTimer);
  clearTimeout(nextRoundTimer);

  gameState.status = 'playing';
  gameState.scores = { player1: 0, player2: 0 };
  gameState.roundNumber = 0;
  gameState.totalRounds = count;
  gameState.usedWords = [];
  gameState.shuffledWords = shuffleArray(readyWords);
  gameState.roundLocked = false;

  broadcast({
    event: 'gameStarted',
    totalRounds: gameState.totalRounds
  });

  startNewRound();
  return { ok: true };
}

// --- REST API ---

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/words', (req, res) => {
  res.json(wordsData);
});

app.get('/api/status', (req, res) => {
  res.json({
    status: gameState.status,
    scores: gameState.scores,
    roundNumber: gameState.roundNumber,
    totalRounds: gameState.totalRounds,
    lastScannedUid: gameState.lastScannedUid
  });
});

app.post('/api/game/start', (req, res) => {
  const result = startGame();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/game/skip', (req, res) => {
  if (gameState.status !== 'playing') {
    return res.status(400).json({ error: 'Game is not active' });
  }
  clearTimeout(roundTimer);
  gameState.roundLocked = true;
  gameState.status = 'roundEnd';
  broadcast({
    event: 'roundSkipped',
    word: gameState.currentWord,
    scores: gameState.scores
  });
  scheduleNextRound();
  res.json({ ok: true });
});

// Shared scan handler used by both the HTTP endpoint and the USB serial reader.
// Returns { status, player } describing the outcome.
function processScan(rawUid) {
  const normalizedUid = String(rawUid).trim().toUpperCase();
  if (!normalizedUid) return { status: 'invalid' };

  gameState.lastScannedUid = normalizedUid;

  // Single shared reader, race mode: the scanned card identifies BOTH the
  // picture and which player owns it. First correct card scanned wins.
  const match = identifyCard(normalizedUid);
  const player = match ? match.player : null;

  if (gameState.status !== 'playing' || gameState.roundLocked) {
    broadcast({ event: 'cardScanned', uid: normalizedUid, player });
    return { status: 'ignored', player };
  }

  // An unknown card (not assigned to any word) can't score, but still surfaces
  // for the admin "last scan" registration flow.
  if (!match) {
    broadcast({ event: 'cardScanned', uid: normalizedUid, player: null });
    return { status: 'unknown', player: null };
  }

  const isCorrect = match.word.id === gameState.currentWord.id;

  if (isCorrect) {
    gameState.roundLocked = true;
    gameState.scores[player]++;
    gameState.status = 'roundEnd';
    clearTimeout(roundTimer);

    broadcast({
      event: 'roundResult',
      winner: player,
      word: gameState.currentWord,
      scores: gameState.scores
    });

    scheduleNextRound();
    return { status: 'correct', player };
  }

  broadcast({ event: 'wrongAnswer', player });
  return { status: 'wrong', player };
}

app.post('/api/scan', (req, res) => {
  const { uid } = req.body;
  if (typeof uid !== 'string' || !uid.trim()) {
    return res.status(400).json({ error: 'Missing or invalid uid' });
  }
  const result = processScan(uid);
  res.json(result);
});

// `slot` selects which player's card to set: 1 -> cardUidP1, 2 -> cardUidP2.
function cardField(slot) {
  if (slot === 1 || slot === '1') return 'cardUidP1';
  if (slot === 2 || slot === '2') return 'cardUidP2';
  return null;
}

app.post('/api/words/:id/card', (req, res) => {
  const { uid, slot } = req.body;
  if (typeof uid !== 'string' || !uid.trim()) {
    return res.status(400).json({ error: 'Missing or invalid uid' });
  }
  const field = cardField(slot);
  if (!field) {
    return res.status(400).json({ error: 'Missing or invalid slot (must be 1 or 2)' });
  }
  const word = wordsData.words.find(w => w.id === req.params.id);
  if (!word) return res.status(404).json({ error: 'Word not found' });

  const normalizedUid = uid.trim().toUpperCase();

  word[field] = normalizedUid;
  saveWords();

  broadcast({ event: 'cardRegistered', wordId: word.id, slot: field === 'cardUidP1' ? 1 : 2, uid: normalizedUid });
  res.json({ ok: true, word });
});

app.delete('/api/words/:id/card', (req, res) => {
  const field = cardField(req.query.slot);
  if (!field) {
    return res.status(400).json({ error: 'Missing or invalid slot (must be 1 or 2)' });
  }
  const word = wordsData.words.find(w => w.id === req.params.id);
  if (!word) return res.status(404).json({ error: 'Word not found' });

  word[field] = null;
  saveWords();

  broadcast({ event: 'cardUnregistered', wordId: word.id, slot: field === 'cardUidP1' ? 1 : 2 });
  res.json({ ok: true });
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    event: 'connected',
    status: gameState.status,
    scores: gameState.scores,
    roundNumber: gameState.roundNumber,
    totalRounds: gameState.totalRounds,
    showNikkud: gameState.showNikkud,
    currentWord: gameState.status === 'playing' ? {
      id: gameState.currentWord.id,
      hebrew: gameState.currentWord.hebrew,
      hebrewNikkud: gameState.currentWord.hebrewNikkud,
      category: gameState.currentWord.category
    } : null
  }));

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.event === 'startGame') {
      const result = startGame();
      if (result.error) {
        ws.send(JSON.stringify({ event: 'startError', message: result.error }));
      }
    } else if (data.event === 'toggleNikkud') {
      gameState.showNikkud = data.show;
      broadcast({ event: 'nikkudChanged', show: data.show });
    } else if (data.event === 'skipRound') {
      if (gameState.status === 'playing') {
        clearTimeout(roundTimer);
        gameState.roundLocked = true;
        gameState.status = 'roundEnd';
        broadcast({
          event: 'roundSkipped',
          word: gameState.currentWord,
          scores: gameState.scores
        });
        scheduleNextRound();
      }
    }
  });
});

// --- USB serial reader (no WiFi needed) ---
//
// When an Arduino is connected over USB, it prints one card UID per line. We
// read those lines and feed them through the same scan logic as the HTTP API.
// `serialport` is an OPTIONAL dependency: if it isn't installed, or no port is
// configured, the server still runs fully for web/curl play. Enable by setting
// SERIAL_PORT (e.g. SERIAL_PORT=/dev/ttyACM0 or COM3).
function initSerial() {
  const portPath = process.env.SERIAL_PORT;
  if (!portPath) {
    console.log('Serial reader disabled (set SERIAL_PORT=/dev/ttyACM0 or COM3 to enable).');
    return;
  }

  let SerialPort, ReadlineParser;
  try {
    ({ SerialPort } = require('serialport'));
    ({ ReadlineParser } = require('@serialport/parser-readline'));
  } catch (err) {
    console.warn('SERIAL_PORT is set but "serialport" is not installed. Run: npm install serialport');
    return;
  }

  const baud = Number(process.env.SERIAL_BAUD) || 115200;

  function open() {
    const port = new SerialPort({ path: portPath, baudRate: baud });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('open', () => console.log(`Serial reader connected on ${portPath} @ ${baud}`));

    parser.on('data', (line) => {
      const uid = line.trim();
      if (!uid) return;
      const result = processScan(uid);
      console.log(`[serial] ${uid} -> ${result.status}${result.player ? ' (' + result.player + ')' : ''}`);
      // Send the outcome back so the Arduino LEDs can show correct/wrong.
      if (result.status === 'correct' || result.status === 'wrong') {
        port.write(`${result.status}\n`);
      }
    });

    port.on('error', (err) => console.warn(`Serial error: ${err.message}`));
    port.on('close', () => {
      console.warn('Serial port closed, retrying in 3s...');
      setTimeout(open, 3000);
    });
  }

  open();
}

server.listen(PORT, () => {
  console.log(`Hebrew RFID Game server running on http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
  initSerial();
});
