// Zero-dependency server: only Node's built-in modules. No `npm install` needed.
// - HTTP routing and static files are handled with the built-in `http` module.
// - Server -> client push uses Server-Sent Events (SSE) instead of WebSockets.
// - Client -> server actions are plain HTTP POSTs.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORDS_PATH = path.join(__dirname, 'data', 'words.json');
const ROUND_TIMEOUT_MS = 30000;
const ROUND_DELAY_MS = 3000;

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

// Connected SSE clients (the game screen + admin page). Each entry is the
// ServerResponse of an open /api/events stream.
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
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

// `slot` selects which player's card to set: 1 -> cardUidP1, 2 -> cardUidP2.
function cardField(slot) {
  if (slot === 1 || slot === '1') return 'cardUidP1';
  if (slot === 2 || slot === '2') return 'cardUidP2';
  return null;
}

// The snapshot a freshly-connected client needs to render the current screen.
function connectedSnapshot() {
  return {
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
  };
}

// --- HTTP helpers ---

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// Read and JSON-parse a request body. Calls cb(err, obj).
function readJsonBody(req, cb) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1e6) { tooBig = true; req.destroy(); } // guard against floods
  });
  req.on('end', () => {
    if (tooBig) return cb(new Error('Body too large'));
    if (!raw) return cb(null, {});
    try { cb(null, JSON.parse(raw)); } catch (e) { cb(e); }
  });
  req.on('error', (e) => cb(e));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Serve a file from public/, preventing path traversal outside that directory.
function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

// --- Router ---

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // Server-Sent Events stream: server -> client push (replaces WebSocket).
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(connectedSnapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (pathname === '/api/words' && method === 'GET') {
    return sendJson(res, 200, wordsData);
  }

  if (pathname === '/api/status' && method === 'GET') {
    return sendJson(res, 200, {
      status: gameState.status,
      scores: gameState.scores,
      roundNumber: gameState.roundNumber,
      totalRounds: gameState.totalRounds,
      lastScannedUid: gameState.lastScannedUid
    });
  }

  if (pathname === '/api/game/start' && method === 'POST') {
    const result = startGame();
    return sendJson(res, result.error ? 400 : 200, result);
  }

  if (pathname === '/api/game/skip' && method === 'POST') {
    if (gameState.status !== 'playing') {
      return sendJson(res, 400, { error: 'Game is not active' });
    }
    clearTimeout(roundTimer);
    gameState.roundLocked = true;
    gameState.status = 'roundEnd';
    broadcast({ event: 'roundSkipped', word: gameState.currentWord, scores: gameState.scores });
    scheduleNextRound();
    return sendJson(res, 200, { ok: true });
  }

  // Toggle nikkud (replaces the WS 'toggleNikkud' message).
  if (pathname === '/api/nikkud' && method === 'POST') {
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      gameState.showNikkud = !!body.show;
      broadcast({ event: 'nikkudChanged', show: gameState.showNikkud });
      sendJson(res, 200, { ok: true });
    });
  }

  if (pathname === '/api/scan' && method === 'POST') {
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      const { uid } = body;
      if (typeof uid !== 'string' || !uid.trim()) {
        return sendJson(res, 400, { error: 'Missing or invalid uid' });
      }
      sendJson(res, 200, processScan(uid));
    });
  }

  // /api/words/:id/card  (POST to assign, DELETE to clear)
  const cardMatch = pathname.match(/^\/api\/words\/([^/]+)\/card$/);
  if (cardMatch) {
    const wordId = decodeURIComponent(cardMatch[1]);

    if (method === 'POST') {
      return readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const { uid, slot } = body;
        if (typeof uid !== 'string' || !uid.trim()) {
          return sendJson(res, 400, { error: 'Missing or invalid uid' });
        }
        const field = cardField(slot);
        if (!field) return sendJson(res, 400, { error: 'Missing or invalid slot (must be 1 or 2)' });
        const word = wordsData.words.find(w => w.id === wordId);
        if (!word) return sendJson(res, 404, { error: 'Word not found' });

        word[field] = uid.trim().toUpperCase();
        saveWords();
        broadcast({ event: 'cardRegistered', wordId: word.id, slot: field === 'cardUidP1' ? 1 : 2, uid: word[field] });
        sendJson(res, 200, { ok: true, word });
      });
    }

    if (method === 'DELETE') {
      const field = cardField(url.searchParams.get('slot'));
      if (!field) return sendJson(res, 400, { error: 'Missing or invalid slot (must be 1 or 2)' });
      const word = wordsData.words.find(w => w.id === wordId);
      if (!word) return sendJson(res, 404, { error: 'Word not found' });

      word[field] = null;
      saveWords();
      broadcast({ event: 'cardUnregistered', wordId: word.id, slot: field === 'cardUidP1' ? 1 : 2 });
      return sendJson(res, 200, { ok: true });
    }
  }

  // /admin convenience route -> admin.html
  if (pathname === '/admin' && method === 'GET') {
    return serveStatic('/admin.html', res);
  }

  // Static files (GET/HEAD only).
  if (method === 'GET' || method === 'HEAD') {
    return serveStatic(pathname, res);
  }

  res.writeHead(404);
  res.end('Not found');
});

// --- USB serial reader (no WiFi, no npm packages) ---
//
// When an Arduino is connected over USB it prints one card UID per line. We read
// those lines and feed them through the same scan logic as the HTTP API. This
// uses only tools that ship with the OS, so no `npm install` is ever required:
//   - Windows:     Windows PowerShell's built-in .NET SerialPort (serial-bridge.ps1)
//   - Linux/macOS: the serial device is a file; configure it with `stty`, then
//                  read it as a stream.
//
// Enable by setting SERIAL_PORT (e.g. SERIAL_PORT=COM3 on Windows, or
// SERIAL_PORT=/dev/ttyACM0 on Linux/macOS). If it isn't set, the server still
// runs fully for web/curl play.
function initSerial() {
  const portPath = process.env.SERIAL_PORT;
  if (!portPath) {
    const example = process.platform === 'win32' ? 'COM3' : '/dev/ttyACM0';
    console.log(`Serial reader disabled (set SERIAL_PORT=${example} to enable).`);
    return;
  }
  const baud = Number(process.env.SERIAL_BAUD) || 115200;
  if (process.platform === 'win32') {
    initSerialWindows(portPath, baud);
  } else {
    initSerialUnix(portPath, baud);
  }
}

// Run a scanned UID through the game and log the outcome.
function handleSerialUid(uid) {
  const trimmed = uid.trim();
  if (!trimmed) return;
  const result = processScan(trimmed);
  console.log(`[serial] ${trimmed} -> ${result.status}${result.player ? ' (' + result.player + ')' : ''}`);
}

// Split a growing buffer into complete lines, returning the leftover remainder.
function drainLines(buffer, onLine) {
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    onLine(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
  }
  return buffer;
}

// Windows: spawn a small PowerShell bridge that owns the COM port and pipes
// scanned UIDs to stdout.
function initSerialWindows(portName, baud) {
  const { spawn } = require('child_process');
  const script = path.join(__dirname, 'serial-bridge.ps1');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script
  ], { env: { ...process.env, SERIAL_PORT: portName, SERIAL_BAUD: String(baud) } });

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    buffer = drainLines(buffer, (line) => handleSerialUid(line));
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { const m = d.trim(); if (m) console.log(`[serial] ${m}`); });

  child.on('error', (err) => {
    console.warn(`Could not start PowerShell serial bridge: ${err.message}`);
    console.warn('Is PowerShell available? The game still runs for web/curl play.');
  });
  child.on('close', (code) => {
    console.warn(`Serial bridge exited (code ${code}), retrying in 3s...`);
    setTimeout(initSerial, 3000);
  });
}

// Linux/macOS: the serial device is a file. Configure it once with `stty`, then
// read it as a stream.
function initSerialUnix(portPath, baud) {
  const { execFileSync } = require('child_process');

  // Put the tty into raw mode at the right baud so we read clean lines.
  try {
    execFileSync('stty', ['-F', portPath, String(baud), 'raw', '-echo']);
  } catch (err) {
    console.warn(`Could not configure ${portPath} with stty: ${err.message}`);
    console.warn('Is the Arduino plugged in and is SERIAL_PORT correct? Serial disabled.');
    return;
  }

  const stream = fs.createReadStream(portPath, { encoding: 'utf8' });
  let buffer = '';

  stream.on('open', () => console.log(`Serial reader connected on ${portPath} @ ${baud}`));
  stream.on('data', (chunk) => {
    buffer += chunk;
    buffer = drainLines(buffer, (line) => handleSerialUid(line));
  });
  stream.on('error', (err) => console.warn(`Serial error: ${err.message}`));
  stream.on('close', () => {
    console.warn('Serial port closed, retrying in 3s...');
    setTimeout(initSerial, 3000);
  });
}

server.listen(PORT, () => {
  console.log(`Hebrew RFID Game server running on http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
  initSerial();
});
