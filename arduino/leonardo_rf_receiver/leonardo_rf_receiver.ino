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
 *          (a ~17cm wire antenna on the receiver improves range)
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

// The transmitter sends each UID twice for reliability; ignore the repeat.
#define DUPLICATE_WINDOW_MS  1000

RH_ASK rf(RF_SPEED, RF_RX_PIN, RF_TX_PIN, RF_PTT_PIN);

String lastMsg = "";
unsigned long lastMsgTime = 0;

void setup() {
  Serial.begin(115200);
  // Leonardo: wait briefly for the USB serial connection, but don't hang
  // forever if the port isn't open yet.
  unsigned long start = millis();
  while (!Serial && millis() - start < 3000) { }

  if (!rf.init()) {
    Serial.println("RF init failed!");
  }
}

void loop() {
  uint8_t buf[RH_ASK_MAX_MESSAGE_LEN];
  uint8_t len = sizeof(buf) - 1;

  // recv() returns true only for packets that pass RadioHead's CRC check, so
  // corrupted transmissions are dropped rather than forwarded.
  if (!rf.recv(buf, &len)) {
    return;
  }

  buf[len] = '\0';
  String uid = String((char *)buf);
  uid.trim();
  if (!uid.length()) return;

  unsigned long now = millis();
  if (uid == lastMsg && (now - lastMsgTime) < DUPLICATE_WINDOW_MS) {
    return;  // repeat of the double-send, ignore
  }
  lastMsg = uid;
  lastMsgTime = now;

  // One UID per line — same protocol as the wired reader.
  Serial.println(uid);
}
