let words = [];
let lastScannedUid = null;
let ws;

const grid = document.getElementById('words-grid');
const lastScanEl = document.getElementById('last-scan-uid');
const registeredCountEl = document.getElementById('registered-count');
const totalCountEl = document.getElementById('total-count');

async function loadWords() {
  const res = await fetch('/api/words');
  const data = await res.json();
  words = data.words;
  totalCountEl.textContent = words.length;
  render();
}

// A word is "ready" to play only when both players' cards are assigned.
function isReady(w) {
  return !!w.cardUidP1 && !!w.cardUidP2;
}

function slotMarkup(w, slot) {
  const uid = slot === 1 ? w.cardUidP1 : w.cardUidP2;
  const label = slot === 1 ? 'Player 1' : 'Player 2';
  const cls = slot === 1 ? 'slot-p1' : 'slot-p2';
  return `
    <div class="card-slot ${cls} ${uid ? 'assigned' : ''}">
      <div class="slot-label">${label}</div>
      <div class="card-uid-display ${uid ? '' : 'none'}">
        ${uid ? uid : 'No card'}
      </div>
      <div class="slot-actions">
        <button class="btn btn-use-last" onclick="assignLastScan('${w.id}', ${slot})"
          ${lastScannedUid ? '' : 'disabled'}>
          Use Last Scan
        </button>
        ${uid
          ? `<button class="btn btn-remove" onclick="removeCard('${w.id}', ${slot})">Remove</button>`
          : ''
        }
      </div>
    </div>`;
}

function render() {
  const ready = words.filter(isReady).length;
  registeredCountEl.textContent = ready;

  grid.innerHTML = words.map(w => `
    <div class="word-card ${isReady(w) ? 'registered' : ''}" id="card-${w.id}">
      <div class="word-header">
        <span class="word-emoji">${w.emoji}</span>
        <div class="word-info">
          <h3>${w.english}</h3>
          <div class="word-hebrew">${w.hebrewNikkud}</div>
        </div>
      </div>
      <div class="word-category">${w.category}</div>
      <div class="card-slots">
        ${slotMarkup(w, 1)}
        ${slotMarkup(w, 2)}
      </div>
    </div>
  `).join('');
}

async function assignLastScan(wordId, slot) {
  if (!lastScannedUid) return;

  const res = await fetch(`/api/words/${wordId}/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: lastScannedUid, slot })
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Failed to register card');
    return;
  }

  const word = words.find(w => w.id === wordId);
  if (word) word[slot === 1 ? 'cardUidP1' : 'cardUidP2'] = lastScannedUid;
  render();
}

async function removeCard(wordId, slot) {
  const res = await fetch(`/api/words/${wordId}/card?slot=${slot}`, { method: 'DELETE' });
  if (!res.ok) {
    alert('Failed to remove card');
    return;
  }

  const word = words.find(w => w.id === wordId);
  if (word) word[slot === 1 ? 'cardUidP1' : 'cardUidP2'] = null;
  render();
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.event === 'cardScanned') {
      lastScannedUid = data.uid;
      lastScanEl.textContent = data.uid;
      lastScanEl.style.animation = 'none';
      requestAnimationFrame(() => {
        lastScanEl.style.animation = 'listenPulse 0.5s ease';
      });
      render();
    }

    if (data.event === 'cardRegistered') {
      const word = words.find(w => w.id === data.wordId);
      if (word) word[data.slot === 1 ? 'cardUidP1' : 'cardUidP2'] = data.uid;
      render();
    }

    if (data.event === 'cardUnregistered') {
      const word = words.find(w => w.id === data.wordId);
      if (word) word[data.slot === 1 ? 'cardUidP1' : 'cardUidP2'] = null;
      render();
    }
  };

  ws.onclose = () => setTimeout(connectWebSocket, 2000);
}

async function init() {
  await loadWords();

  const statusRes = await fetch('/api/status');
  const status = await statusRes.json();
  if (status.lastScannedUid) {
    lastScannedUid = status.lastScannedUid;
    lastScanEl.textContent = lastScannedUid;
    render();
  }

  connectWebSocket();
}

init();
