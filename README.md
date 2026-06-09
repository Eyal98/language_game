# Hebrew Word Game 🎮

A two-player Hebrew vocabulary **race** game using RFID cards — on a single reader, no WiFi required. Each word has **two** matching cards: one belonging to Player 1, one to Player 2. The screen shows a Hebrew word and both players race to scan their own matching picture card. The card's UID tells the server who scanned, so the first correct scan wins the round. Most points after all rounds wins!

> **Earlier versions:** the two-reader racing version is preserved at the `two-scanners-v1` tag; a single-reader turn-based variant exists in git history.

---

## How It Works

1. Each word has two physical cards with the same picture — one for each player
2. The screen shows a Hebrew word
3. Both players race to find and scan their matching picture card on the shared reader
4. The scanned card's UID identifies the picture **and** which player scanned it
5. First correct scan wins the round and scores a point
6. Most points after all rounds wins!

---

## Requirements

### Software
- [Node.js](https://nodejs.org) (v16 or later) — that's it, no other packages

### Hardware (optional — game works without it for testing)
- 1× MFRC522 RFID reader module (shared by both players)
- Two RFID cards/fobs per word you want to play (one per player), 13.56 MHz / MIFARE
- **Wired option:** one Arduino (Uno or Leonardo) connected to the PC over USB
- **Wireless option:** an Arduino Uno with the reader + a 433MHz RF transmitter
  (e.g. FS1000A), and an Arduino Leonardo at the PC with a 433MHz RF receiver
  (e.g. XY-MK-5V) — no WiFi needed either way

---

## Quick Start

No dependencies to install — the server uses only Node's built-in modules.

```bash
# 1. Start the server (no `npm install` needed)
npm start          # or: node server.js

# 2. Open the game
http://localhost:3000

# 3. Open the admin page to register cards
http://localhost:3000/admin
```

> **Zero-dependency:** the server runs on plain Node — HTTP via the built-in
> `http` module and live updates via Server-Sent Events. There is nothing in
> `node_modules` to install, so it works fully offline.

---

## Word List

The game includes 14 words across four categories. Add or edit them in
[`data/words.json`](data/words.json) — no code changes needed.

| Category | Words |
|----------|-------|
| Animal | Dog, Cat, Fish, Bird, Horse |
| Color | Red, Blue, Green, Yellow |
| Food | Apple, Banana, Bread |
| Nature | Flower, Sun |

Each word is **bilingual**: it stores Hebrew and Arabic (both with and without
vowel marks), transliterations, and an emoji. During a round the Hebrew word
shows first and is read aloud; about 2 seconds later the Arabic word appears
below it and is read aloud too.

### Read-aloud

Each word can be read aloud from two sources, tried in order:

1. **Pre-recorded MP3s** in `public/audio/` — the recommended way. They play in
   **any browser, with no installed voices and no internet** on the game device.
2. The browser's built-in **speech synthesis**, used only for words that have no
   recording (and only if the OS has a voice for that language).

The welcome screen shows a 🔇 hint only when a language has *neither* recordings
nor an installed voice. Use **`/speech-test.html`** to diagnose audio.

#### Generate the recordings (one time)

On any machine with **internet** (uses Node built-ins, nothing to install):

```bash
node tools/generate-audio.mjs
```

This creates `public/audio/<id>_he.mp3` and `<id>_ar.mp3` for every word and
updates `public/audio/manifest.json`. Commit the `public/audio/` folder; after
that the game speaks every word offline, on any device. Re-run it after adding
or changing words (existing files are skipped — delete one to regenerate it).

#### Alternative: install OS voices instead

If you'd rather not bundle recordings, install Hebrew/Arabic voices on the
device: **Settings → Time & Language → Speech → Add voices** → add **עברית** and
**العربية**, then fully restart the browser. On Windows, **Microsoft Edge** sees
these voices far more reliably than Chrome.

---

## Playing Without Hardware

You can test the full game using `curl` to simulate card scans. Each word needs
**two** cards registered (one per player) before it can be played.

**1. Register both cards for a word (use any made-up UIDs):**
```bash
# Player 1's "dog" card  (slot 1)
curl -X POST http://localhost:3000/api/words/dog/card \
  -H "Content-Type: application/json" \
  -d "{\"uid\": \"AA BB CC 01\", \"slot\": 1}"

# Player 2's "dog" card  (slot 2)
curl -X POST http://localhost:3000/api/words/dog/card \
  -H "Content-Type: application/json" \
  -d "{\"uid\": \"AA BB CC 02\", \"slot\": 2}"
```

**2. Start the game:**
```bash
curl -X POST http://localhost:3000/api/game/start
```

**3. Simulate a scan.** The card UID alone identifies both the word and the
player — there is no separate player/reader field:
```bash
# Player 2 scans their dog card — wins the round if "dog" is showing
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d "{\"uid\": \"AA BB CC 02\"}"
```

**4. Skip a round:**
```bash
curl -X POST http://localhost:3000/api/game/skip
```

---

## Arduino Setup (no WiFi)

Two hardware options. Both speak the same protocol — one UID per line over USB
serial — so the server works identically with either.

### Option A — Wired: one Arduino at the PC

The Arduino connects to the PC over USB and prints each scanned card UID.

```
Arduino Uno
───────────────────────────────────────────────
Pin 13 ───── SCK  (Reader)
Pin 12 ───── MISO (Reader)
Pin 11 ───── MOSI (Reader)
Pin 10 ───── SDA  (Reader)
Pin  9 ───── RST  (Reader)
3.3V   ───── VCC  (Reader) ⚠️ NOT 5V!
GND    ───── GND  (Reader)
```

Library: `MFRC522` by GithubCommunity. Upload `arduino/rfid_reader.ino`. The
sketch uses serial at **115200 baud** (matching the server default). Open the
Serial Monitor at 115200 to confirm a UID line prints on each scan.

### Option B — Wireless: Uno scanner + RF link + Leonardo at the PC

The **Uno** sits with the RFID scanner anywhere in the room (powered by a
battery / power bank) and transmits each scan over a cheap **433MHz RF link**.
The **Leonardo** plugs into the PC over USB with the RF receiver and forwards
the UIDs to the server.

```
[card] → Uno + reader + RF transmitter  ~~433MHz~~>  RF receiver + Leonardo → USB → server
```

**Uno (transmitter side)** — upload `arduino/uno_rfid_transmitter/`:
```
Arduino Uno
───────────────────────────────────────────────
Pin 13 ───── SCK  (Reader)
Pin 12 ───── MISO (Reader)
Pin 11 ───── MOSI (Reader)
Pin 10 ───── SDA  (Reader)
Pin  9 ───── RST  (Reader)
3.3V   ───── VCC  (Reader) ⚠️ NOT 5V!
GND    ───── GND  (Reader)

Pin  3 ───── DATA (RF transmitter, e.g. FS1000A)
5V     ───── VCC  (RF transmitter)
GND    ───── GND  (RF transmitter)
```

**Leonardo (receiver side, USB to the PC)** — upload `arduino/leonardo_rf_receiver/`:
```
Arduino Leonardo
───────────────────────────────────────────────
Pin 11 ───── DATA (RF receiver, e.g. XY-MK-5V)
5V     ───── VCC  (RF receiver)
GND    ───── GND  (RF receiver)
```

Libraries: `MFRC522` by GithubCommunity (Uno only) and `RadioHead` by Mike
McCauley (both boards). Notes:

- Solder a **~17 cm wire antenna** to both RF modules — without it the range is
  under a meter; with it, comfortably across a room.
- The RF link includes a CRC (RadioHead), so corrupted packets are dropped, and
  each UID is sent twice with the receiver de-duplicating repeats.
- Set `SERIAL_PORT` to the **Leonardo's** COM port (the Uno doesn't connect to
  the PC at all).

### Connect the server to the reader

The serial bridge is built into the server (using only what ships with the OS —
no packages) but **off by default**. Enable it by telling the server which port
the Arduino is on.

**Windows** (PowerShell or Command Prompt):
```bat
set SERIAL_PORT=COM3
npm start
```
```powershell
# PowerShell equivalent
$env:SERIAL_PORT="COM3"; npm start
```
On Windows the server launches `serial-bridge.ps1`, which reads the COM port via
the .NET `SerialPort` class built into Windows PowerShell — nothing to install.
To find the port: **Device Manager → Ports (COM & LPT)**, or in the Arduino IDE
under **Tools → Port**.

**Linux/macOS:**
```bash
SERIAL_PORT=/dev/ttyACM0 npm start
# (on macOS the port often looks like /dev/tty.usbmodemXXXX)
```

If `SERIAL_PORT` is not set, the server runs normally for web/`curl` play.
Override the baud rate with `SERIAL_BAUD` (default 115200).

---

## Registering Cards

1. Start the server (`npm start`, with `SERIAL_PORT` set if using hardware)
2. Open `http://localhost:3000/admin`
3. Scan a card on the reader — its UID appears as "Last Scanned Card UID"
4. Click **Use Last Scan** under the **Player 1** or **Player 2** slot of the
   word you want to assign it to. Each word needs both slots filled to be playable.
5. Repeat for all cards — only words with both slots filled are used in a game.

> **Tip:** A word card on the admin page turns green once both players' cards are
> assigned. The "Ready words" counter shows how many words can be played.

---

## Game Options

### Nikkud toggle
The Nikkud toggle (vowel marks) on the welcome screen and during gameplay shows/hides the small dots and dashes that indicate how to pronounce Hebrew words. Turn it off to make the game harder.

---

## File Structure

```
├── server.js          # Game server (Node built-in http + Server-Sent Events, no deps)
├── serial-bridge.ps1  # Windows COM-port reader (Windows PowerShell, no installs)
├── package.json
├── data/
│   └── words.json     # Word list and card UID mappings (auto-updated)
├── public/
│   ├── index.html     # Game UI
│   ├── style.css      # Styling
│   ├── game.js        # Frontend game logic
│   ├── admin.html     # Card registration page
│   ├── admin.js       # Admin logic
│   ├── speech-test.html  # Audio diagnostic page
│   └── audio/         # Pre-recorded word clips + manifest.json
├── tools/
│   └── generate-audio.mjs  # One-time recorder (run with internet)
└── arduino/
    ├── rfid_reader.ino           # Option A: wired reader at the PC
    ├── uno_rfid_transmitter/     # Option B: Uno + reader + 433MHz RF transmitter
    └── leonardo_rf_receiver/     # Option B: Leonardo + RF receiver at the PC
```

---

## Troubleshooting

**Port 3000 already in use**
```powershell
# Windows — find and kill the process
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Server isn't reading the Arduino**
- Make sure you started the server with `SERIAL_PORT` set to the right port
  (Windows: `COM3`; Linux: `/dev/ttyACM0`; macOS: `/dev/tty.usbmodemXXXX`)
- Close the Arduino IDE Serial Monitor — only one program can hold the port
- Confirm the baud rates match (sketch `SERIAL_BAUD` and server `SERIAL_BAUD`, both 115200 by default)
- **Windows:** the server uses `serial-bridge.ps1` via Windows PowerShell. If it
  won't start, check `[serial]` lines in the server console; the game still runs
  for web/`curl` play regardless.
- **Linux:** permission denied on the port? Add your user to the `dialout` group
  (`sudo usermod -aG dialout $USER`, then log out/in), or run with `sudo`. The
  reader relies on the `stty` command (standard on Linux/macOS).

**Card not recognized**
- Check the UID shown on the admin page matches what's registered
- Make sure the card is held still and flat against the reader
- A scan only scores if that card is assigned to the word currently on screen, in the matching player's slot

**Game won't start**
- Each playable word needs **both** the Player 1 and Player 2 cards assigned
- If no word is fully assigned, the welcome screen shows an error explaining why

**Wireless (RF) scans don't arrive**
- Set `SERIAL_PORT` to the **Leonardo's** COM port, not the Uno's
- Both RF modules need a ~17 cm wire antenna for usable range
- Power the Uno well (weak batteries shrink RF range); the transmitter runs on 5V
- Open the Serial Monitor on the Uno (115200): it prints `Sent: <UID>` per scan —
  if that works but nothing arrives, the issue is the RF link or receiver wiring
- The RF speed (2000 bps) must match between the two sketches

**Can't hear the words**
- **Best fix:** generate the recorded clips — `node tools/generate-audio.mjs`
  (needs internet once), then commit `public/audio/`. After that, audio works on
  any browser/device with no installed voices. See [Read-aloud](#read-aloud).
- If you instead rely on OS voices: this PC may simply have no Hebrew/Arabic
  voice installed. Chrome on Windows also often can't see voices that **Edge**
  can — try Edge, or just bundle the recordings above.
- Diagnose with **`http://localhost:3000/speech-test.html`**: it plays a test
  beep, tries English/Hebrew/Arabic, and lists every voice the browser sees.
- Speech/audio starts only after the first click on the page (clicking **Start
  Game** counts), per browser autoplay rules.

---

## Configuration

A few behaviors can be tuned with environment variables when starting the server:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port (also serves the live event stream) |
| `MAX_ROUNDS` | number of words in `words.json` | Caps how many rounds a game runs |
| `SERIAL_PORT` | _(unset — serial disabled)_ | Serial port of the USB Arduino (`COM3` on Windows, `/dev/ttyACM0` on Linux/macOS) |
| `SERIAL_BAUD` | `115200` | Serial baud rate (must match the sketch) |

```bash
# Example: run on port 8080 with at most 5 rounds
PORT=8080 MAX_ROUNDS=5 npm start

# Example: read the Arduino on Linux/macOS
SERIAL_PORT=/dev/ttyACM0 npm start
```
```bat
:: Example: read the Arduino on Windows (COM3)
set SERIAL_PORT=COM3
npm start
```

---

## License

Licensed under the [Apache License 2.0](LICENSE).
