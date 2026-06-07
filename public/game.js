const screens = {
  welcome: document.getElementById('screen-welcome'),
  playing: document.getElementById('screen-playing'),
  gameover: document.getElementById('screen-gameover')
};

const els = {
  btnStart: document.getElementById('btn-start'),
  btnPlayAgain: document.getElementById('btn-play-again'),
  welcomeError: document.getElementById('welcome-error'),
  nikkudWelcome: document.getElementById('nikkud-toggle-welcome'),
  nikkudGame: document.getElementById('nikkud-toggle-game'),
  roundNumber: document.getElementById('round-number'),
  totalRounds: document.getElementById('total-rounds'),
  wordDisplay: document.getElementById('word-display'),
  wordDisplayAr: document.getElementById('word-display-ar'),
  wordFeedback: document.getElementById('word-feedback'),
  wordReveal: document.getElementById('word-reveal'),
  revealEmoji: document.getElementById('reveal-emoji'),
  revealEnglish: document.getElementById('reveal-english'),
  scoreValue1: document.getElementById('score-value-1'),
  scoreValue2: document.getElementById('score-value-2'),
  scorePlayer1: document.getElementById('score-player1'),
  scorePlayer2: document.getElementById('score-player2'),
  timerBar: document.getElementById('timer-bar'),
  confettiContainer: document.getElementById('confetti-container'),
  gameoverTitle: document.getElementById('gameover-title'),
  finalScore1: document.getElementById('final-score-1'),
  finalScore2: document.getElementById('final-score-2'),
  trophy: document.getElementById('trophy')
};

let showNikkud = true;
let currentWord = null;
let audioCtx;
let timerWarningTimeout;
let arabicRevealTimeout;        // delay before the Arabic word appears
const ARABIC_DELAY_MS = 2000;   // show/speak Arabic this long after the Hebrew

// ===== Sound Effects =====

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.3) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playChime() {
  const ctx = getAudioCtx();
  [523, 659, 784].forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.2), i * 120);
  });
}

function playCorrect() {
  playTone(784, 0.15);
  setTimeout(() => playTone(1047, 0.3), 100);
}

function playWrong() {
  playTone(200, 0.3, 'square', 0.15);
}

function playGameOver() {
  const notes = [262, 294, 330, 349, 392, 440, 494, 523];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.15), i * 80);
  });
}

function playTick() {
  playTone(1000, 0.05, 'sine', 0.1);
}

// ===== Speech (read the word aloud) =====
// Uses the browser's built-in speech synthesis. Works offline, but only speaks
// if the device has a voice for that language installed; otherwise it's a no-op.

function pickVoice(langPrefix) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix)) || null;
}

function speak(text, langPrefix, fullLang) {
  if (!text || !('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(langPrefix);
  if (voice) utter.voice = voice;
  utter.lang = voice ? voice.lang : fullLang; // hint the language even without a matched voice
  utter.rate = 0.85;                          // a touch slow, for learners
  try { window.speechSynthesis.speak(utter); } catch (e) { /* ignore */ }
}

function speakHebrew(word) {
  speak(word.hebrew, 'he', 'he-IL');
}

function speakArabic(word) {
  speak(word.arabic, 'ar', 'ar-SA');
}

// ===== Screen Management =====

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ===== Confetti =====

function spawnConfetti() {
  els.confettiContainer.innerHTML = '';
  const colors = ['#FF6B6B', '#4ECDC4', '#FFE066', '#FF8E53', '#2ECC71', '#9B59B6', '#3498DB'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 1.5 + 's';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    piece.style.width = (8 + Math.random() * 12) + 'px';
    piece.style.height = (8 + Math.random() * 12) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
    els.confettiContainer.appendChild(piece);
  }
  setTimeout(() => { els.confettiContainer.innerHTML = ''; }, 4000);
}

// ===== Timer =====

function startTimer(durationMs) {
  clearTimeout(timerWarningTimeout);
  els.timerBar.style.transition = 'none';
  els.timerBar.style.width = '100%';
  els.timerBar.classList.remove('warning');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      els.timerBar.style.transition = `width ${durationMs / 1000}s linear`;
      els.timerBar.style.width = '0%';
    });
  });

  timerWarningTimeout = setTimeout(() => {
    els.timerBar.classList.add('warning');
    for (let i = 0; i < 5; i++) {
      setTimeout(playTick, i * 1000);
    }
  }, durationMs - 5000);
}

function stopTimer() {
  clearTimeout(timerWarningTimeout);
  const currentWidth = els.timerBar.getBoundingClientRect().width;
  const parentWidth = els.timerBar.parentElement.getBoundingClientRect().width;
  els.timerBar.style.transition = 'none';
  els.timerBar.style.width = (currentWidth / parentWidth * 100) + '%';
}

// ===== UI Updates =====

// Render the Hebrew word now; the Arabic word follows after a short delay.
// `withSpeech` controls whether we read the words aloud (true on a fresh round,
// false when just re-rendering after a nikkud toggle).
function updateWord(word, withSpeech = false) {
  currentWord = word;
  clearTimeout(arabicRevealTimeout);

  if (!word) {
    els.wordDisplay.textContent = '';
    els.wordDisplayAr.textContent = '';
    els.wordDisplayAr.classList.add('hidden');
    return;
  }

  els.wordDisplay.textContent = showNikkud ? word.hebrewNikkud : word.hebrew;
  els.wordDisplay.style.animation = 'none';
  requestAnimationFrame(() => {
    els.wordDisplay.style.animation = 'wordAppear 0.5s ease';
  });
  if (withSpeech) {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speakHebrew(word);
  }

  // If the Arabic is already visible (e.g. nikkud toggled mid-round), keep it in
  // sync; otherwise reveal it after the delay.
  const renderArabic = () => {
    els.wordDisplayAr.textContent = showNikkud ? word.arabicNikkud : word.arabic;
  };
  if (!els.wordDisplayAr.classList.contains('hidden')) {
    renderArabic();
  } else {
    arabicRevealTimeout = setTimeout(() => {
      renderArabic();
      els.wordDisplayAr.classList.remove('hidden');
      els.wordDisplayAr.style.animation = 'none';
      requestAnimationFrame(() => {
        els.wordDisplayAr.style.animation = 'wordAppear 0.5s ease';
      });
      if (withSpeech) speakArabic(word);
    }, ARABIC_DELAY_MS);
  }
}

function hideArabic() {
  clearTimeout(arabicRevealTimeout);
  els.wordDisplayAr.classList.add('hidden');
  els.wordDisplayAr.textContent = '';
}

function updateScores(scores) {
  els.scoreValue1.textContent = scores.player1;
  els.scoreValue2.textContent = scores.player2;
}

function showFeedback(text, color) {
  els.wordFeedback.textContent = text;
  els.wordFeedback.style.color = color;
  setTimeout(() => { els.wordFeedback.textContent = ''; }, 2000);
}

function revealWord(word) {
  els.wordReveal.classList.remove('hidden');
  els.revealEmoji.textContent = word.emoji;
  els.revealEnglish.textContent = word.english;
}

function hideReveal() {
  els.wordReveal.classList.add('hidden');
}

function pulseScore(player) {
  const el = player === 'player1' ? els.scorePlayer1 : els.scorePlayer2;
  el.classList.remove('score-pulse');
  requestAnimationFrame(() => el.classList.add('score-pulse'));
  setTimeout(() => el.classList.remove('score-pulse'), 600);
}

function shakeWord() {
  els.wordDisplay.classList.remove('word-shake');
  requestAnimationFrame(() => els.wordDisplay.classList.add('word-shake'));
  setTimeout(() => els.wordDisplay.classList.remove('word-shake'), 600);
}

function highlightWinner(player) {
  const el = player === 'player1' ? els.scorePlayer1 : els.scorePlayer2;
  el.classList.add('player-winner');
  setTimeout(() => el.classList.remove('player-winner'), 3000);
}

// ===== WebSocket =====

// Server -> client push via Server-Sent Events (EventSource auto-reconnects).
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => console.log('Connected to server');
  es.onmessage = (event) => handleEvent(JSON.parse(event.data));
  es.onerror = () => console.log('Disconnected, reconnecting...');
}

// Client -> server actions are plain HTTP POSTs. Each event maps to a route.
const ACTION_ROUTES = {
  startGame: '/api/game/start',
  skipRound: '/api/game/skip',
  toggleNikkud: '/api/nikkud'
};

async function sendEvent(event, payload = {}) {
  const url = ACTION_ROUTES[event];
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    // startGame returns an error here when no words are ready; surface it like
    // the old WebSocket 'startError' event did.
    if (event === 'startGame') {
      const data = await res.json().catch(() => ({}));
      if (data && data.error) showStartError(data.error);
    }
  } catch (err) {
    console.warn('Action failed:', event, err);
  }
}

function handleEvent(data) {
  switch (data.event) {
    case 'connected':
      showNikkud = data.showNikkud;
      els.nikkudWelcome.checked = showNikkud;
      els.nikkudGame.checked = showNikkud;
      if (data.status === 'playing' && data.currentWord) {
        showScreen('playing');
        hideArabic();
        updateWord(data.currentWord);
        updateScores(data.scores);
        els.roundNumber.textContent = data.roundNumber;
        els.totalRounds.textContent = data.totalRounds;
      }
      break;

    case 'gameStarted':
      showScreen('playing');
      els.totalRounds.textContent = data.totalRounds;
      hideReveal();
      break;

    case 'newRound':
      showScreen('playing');
      hideReveal();
      hideArabic();
      els.wordFeedback.textContent = '';
      els.roundNumber.textContent = data.roundNumber;
      els.totalRounds.textContent = data.totalRounds;
      updateWord(data.word, true);
      updateScores(data.scores);
      startTimer(data.roundDurationMs || 30000);
      playChime();
      break;

    case 'wrongAnswer': {
      const name = data.player === 'player1' ? 'Player 1' : 'Player 2';
      showFeedback(`${name} - Try again!`, 'var(--wrong)');
      shakeWord();
      playWrong();
      break;
    }

    case 'roundResult': {
      stopTimer();
      const winnerName = data.winner === 'player1' ? 'Player 1' : 'Player 2';
      showFeedback(`${winnerName} got it! ⭐`, 'var(--correct)');
      updateScores(data.scores);
      pulseScore(data.winner);
      highlightWinner(data.winner);
      revealWord(data.word);
      spawnConfetti();
      playCorrect();
      break;
    }

    case 'roundTimeout':
      stopTimer();
      showFeedback('Time\'s up! ⏰', '#E67E22');
      if (data.word) revealWord(data.word);
      break;

    case 'roundSkipped':
      stopTimer();
      showFeedback('Skipped!', '#95A5A6');
      if (data.word) revealWord(data.word);
      break;

    case 'gameOver': {
      playGameOver();
      setTimeout(() => {
        showScreen('gameover');
        els.finalScore1.textContent = data.scores.player1;
        els.finalScore2.textContent = data.scores.player2;

        if (data.winner === 'tie') {
          els.gameoverTitle.textContent = "It's a Tie! 🤝";
        } else {
          const name = data.winner === 'player1' ? 'Player 1' : 'Player 2';
          els.gameoverTitle.textContent = `${name} Wins! 🎉`;
        }
        spawnConfetti();
      }, 800);
      break;
    }

    case 'nikkudChanged':
      showNikkud = data.show;
      els.nikkudWelcome.checked = showNikkud;
      els.nikkudGame.checked = showNikkud;
      if (currentWord) updateWord(currentWord);
      break;

    case 'cardScanned':
      break;

    case 'startError':
      showStartError(data.message);
      break;
  }
}

function showStartError(message) {
  if (!els.welcomeError) return;
  els.welcomeError.textContent = message;
  els.welcomeError.classList.add('visible');
  clearTimeout(showStartError._t);
  showStartError._t = setTimeout(() => {
    els.welcomeError.classList.remove('visible');
  }, 5000);
}

// ===== Event Listeners =====

els.btnStart.addEventListener('click', () => {
  if (audioCtx) audioCtx.resume();
  getAudioCtx();
  if (els.welcomeError) els.welcomeError.classList.remove('visible');
  sendEvent('startGame');
});

els.btnPlayAgain.addEventListener('click', () => {
  sendEvent('startGame');
});

function handleNikkudToggle(e) {
  showNikkud = e.target.checked;
  els.nikkudWelcome.checked = showNikkud;
  els.nikkudGame.checked = showNikkud;
  sendEvent('toggleNikkud', { show: showNikkud });
  if (currentWord) updateWord(currentWord);
}

els.nikkudWelcome.addEventListener('change', handleNikkudToggle);
els.nikkudGame.addEventListener('change', handleNikkudToggle);

// ===== Init =====

// Warm up the speech voice list — getVoices() is often empty until this fires.
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

document.fonts.ready.then(() => {
  connectEvents();
});
