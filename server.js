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

let wordsData;
try {
  wordsData = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  if (!wordsData || !Array.isArray(wordsData.words)) {
    throw new Error('words.json must contain a "words" array');
  }
} catch (err) {
  console.error(`Failed to load word data from ${WORDS_PATH}: ${err.message}`);
  process.exit(1);
}

const maxRounds = Math.max(wordsData.words.length, DEFAULT_MAX_ROUNDS);

let gameState = {
  status: 'waiting',
  currentWord: null,
  scores: { player1: 0, player2: 0 },
  roundNumber: 0,
  totalRounds: maxRounds,
  usedWords: [],
  shuffledWords: [],
  roundLocked: false,
  showNikkud: true,
  lastScannedUid: null
};

let roundTimer = null;
// Timer for the delay between rounds. Tracked so it can be cleared on
// restart, otherwise an orphaned timer could advance a freshly started game.
let nextRoundTimer = null;

function scheduleNextRound() {
  clearTimeout(nextRoundTimer);
  nextRoundTimer = setTimeout(startNewRound, ROUND_DELAY_MS);
}

function clearTimers() {
  clearTimeout(roundTimer);
  clearTimeout(nextRoundTimer);
}

// Atomic save: write to a temp file then rename, so a crash mid-write can't
// corrupt the existing word data.
function saveWords() {
  const tmpPath = `${WORDS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(wordsData, null, 2), 'utf8');
  fs.renameSync(tmpPath, WORDS_PATH);
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
    scores: gameState.scores,
    roundDurationMs: ROUND_TIMEOUT_MS
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
  const registeredWords = wordsData.words.filter(w => w.cardUid !== null);
  const count = Math.min(registeredWords.length, maxRounds);
  if (count === 0) {
    return { error: 'No cards registered. Use /admin to register cards first.' };
  }

  // Cancel any pending timers from a previous game so they can't fire into
  // this fresh state.
  clearTimers();

  gameState.status = 'playing';
  gameState.scores = { player1: 0, player2: 0 };
  gameState.roundNumber = 0;
  gameState.totalRounds = count;
  gameState.usedWords = [];
  gameState.shuffledWords = shuffleArray(registeredWords);
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

app.post('/api/scan', (req, res) => {
  const { reader, uid } = req.body;
  if (typeof uid !== 'string' || !uid.trim() || (reader !== 1 && reader !== 2)) {
    return res.status(400).json({ error: 'Missing or invalid reader (must be 1 or 2) or uid' });
  }

  const normalizedUid = uid.trim().toUpperCase();
  gameState.lastScannedUid = normalizedUid;

  const player = reader === 1 ? 'player1' : 'player2';

  if (gameState.status !== 'playing' || gameState.roundLocked) {
    broadcast({ event: 'cardScanned', uid: normalizedUid, player });
    return res.json({ status: 'ignored' });
  }

  const isCorrect = gameState.currentWord.cardUid === normalizedUid;

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
    return res.json({ status: 'correct', player });
  }

  broadcast({ event: 'wrongAnswer', player });
  return res.json({ status: 'wrong' });
});

app.post('/api/words/:id/card', (req, res) => {
  const { uid } = req.body;
  if (typeof uid !== 'string' || !uid.trim()) {
    return res.status(400).json({ error: 'Missing or invalid uid' });
  }
  const word = wordsData.words.find(w => w.id === req.params.id);
  if (!word) return res.status(404).json({ error: 'Word not found' });

  const normalizedUid = uid.trim().toUpperCase();

  word.cardUid = normalizedUid;
  saveWords();

  broadcast({ event: 'cardRegistered', wordId: word.id, uid: normalizedUid });
  res.json({ ok: true, word });
});

app.delete('/api/words/:id/card', (req, res) => {
  const word = wordsData.words.find(w => w.id === req.params.id);
  if (!word) return res.status(404).json({ error: 'Word not found' });

  word.cardUid = null;
  saveWords();

  broadcast({ event: 'cardUnregistered', wordId: word.id });
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
      if (result.error && ws.readyState === WebSocket.OPEN) {
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

server.listen(PORT, () => {
  console.log(`Hebrew RFID Game server running on http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
});
