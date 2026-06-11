/*
 * Hebrew RFID Game - Leonardo: 433MHz RF receiver -> USB serial (wireless)
 *
 * This board plugs into the computer over USB. It receives card UIDs sent by
 * the Uno transmitter (see arduino/uno_rfid_transmitter) and prints one UID
 * per line over serial — exactly what the game server expects. Point the
 * server at this board's port: SERIAL_PORT=COM4 (check Device Manager).
 *
 * Hardware:
 *   - Arduino Leonardo (USB to the PC)
 *   - 1x 433MHz ASK receiver (e.g. XY-MK-5V)
 *
 * Wiring:
 *   RF RX: DATA=11, VCC=5V, GND
 *
 * ANTENNA (REQUIRED): solder a 17.3 cm straight wire to the receiver's antenna
 * pad. Without it these modules pick up almost nothing.
 *
 * Library (Arduino IDE -> Manage Libraries):
 *   - RadioHead by Mike McCauley
 */

#include <RH_ASK.h>
#include <SPI.h>  // required by RadioHead's build even though unused here

// ===== PINS =====
#define RF_RX_PIN   11    // RF receiver DATA
#define RF_TX_PIN   12    // unused (no transmitter on this board)
#define RF_PTT_PIN  10    // unused

// Must match the transmitter sketch.
#define RF_SPEED    2000

// Set to 1 for bench testing: prints a startup banner, a "listening" heartbeat,
// and every packet received (with length). Leave at 0 for normal play so the
// game server only sees clean UID lines.
#define RX_DEBUG 0

// The transmitter sends each UID twice for reliability; ignore the repeat.
#define DUPLICATE_WINDOW_MS  1000

RH_ASK rf(RF_SPEED, RF_RX_PIN, RF_TX_PIN, RF_PTT_PIN);

String lastMsg = "";
unsigned long lastMsgTime = 0;
unsigned long packetCount = 0;
unsigned long lastBeat = 0;

void setup() {
  Serial.begin(115200);
  // Leonardo: wait briefly for the USB serial connection, but don't hang
  // forever if the port isn't open yet.
  unsigned long start = millis();
  while (!Serial && millis() - start < 3000) { }

  if (!rf.init()) {
#if RX_DEBUG
    Serial.println("RF init failed!");
#endif
  } else {
#if RX_DEBUG
    Serial.println("RF receiver ready. Listening @ 2000bps on pin 11.");
#endif
  }
}

void loop() {
#if RX_DEBUG
  if (millis() - lastBeat > 2000) {
    lastBeat = millis();
    Serial.print("listening... packets received so far: ");
    Serial.println(packetCount);
  }
#endif

  uint8_t buf[RH_ASK_MAX_MESSAGE_LEN];
  uint8_t len = sizeof(buf) - 1;

  // recv() returns true only for packets that pass RadioHead's CRC check, so
  // corrupted transmissions are dropped rather than forwarded.
  if (!rf.recv(buf, &len)) {
    return;
  }

  buf[len] = '\0';
  packetCount++;
  String uid = String((char *)buf);
  uid.trim();
  if (!uid.length()) return;

#if RX_DEBUG
  Serial.print("[rx] got \"");
  Serial.print(uid);
  Serial.print("\" (len ");
  Serial.print(len);
  Serial.println(")");
#endif

  unsigned long now = millis();
  if (uid == lastMsg && (now - lastMsgTime) < DUPLICATE_WINDOW_MS) {
    return;  // repeat of the double-send, ignore
  }
  lastMsg = uid;
  lastMsgTime = now;

#if !RX_DEBUG
  // One UID per line — same protocol as the wired reader (what the server reads).
  Serial.println(uid);
#endif
}
