/*
 * Hebrew RFID Game - Uno: RFID scanner + 433MHz RF transmitter (wireless)
 *
 * This board sits with the card scanner, away from the computer (powered by a
 * battery / power bank / USB charger). Each scanned card UID is transmitted
 * over a 433MHz ASK link to the Leonardo receiver plugged into the PC
 * (see arduino/leonardo_rf_receiver). No WiFi needed.
 *
 * Hardware:
 *   - Arduino Uno
 *   - 1x MFRC522 RFID reader
 *   - 1x 433MHz ASK transmitter (e.g. FS1000A)
 *
 * Wiring:
 *   Reader SPI: SCK=13, MISO=12, MOSI=11
 *   Reader:     SDA=10, RST=9, VCC=3.3V (NOT 5V!), GND
 *   RF TX:      DATA=3, VCC=5V, GND
 *
 * ANTENNA (REQUIRED): solder a 17.3 cm straight wire to the transmitter's
 * antenna pad. Without an antenna these modules have almost no range and the
 * receiver decodes nothing.
 *
 * Libraries (Arduino IDE -> Manage Libraries):
 *   - MFRC522 by GithubCommunity
 *   - RadioHead by Mike McCauley
 */

#include <SPI.h>
#include <MFRC522.h>
#include <RH_ASK.h>

// ===== PINS =====
#define SS_PIN      10    // Reader SS
#define RST_PIN     9     // Reader RST
#define RF_TX_PIN   3     // RF transmitter DATA
// RH_ASK's defaults (rx=11, tx=12, ptt=10) collide with the reader's SPI pins,
// so all pins are set explicitly. RX and PTT are unused on this board.
#define RF_RX_PIN   A0    // unused (no receiver on this board)
#define RF_PTT_PIN  A1    // unused

// ===== RF =====
// 2000 bps is the reliable sweet spot for these ASK modules. Must match the
// speed configured in the Leonardo receiver sketch.
#define RF_SPEED    2000

// Set to 1 to bench-test the radio link by itself: the board transmits "PING"
// every 2 seconds regardless of the reader. Watch the Leonardo's Serial Monitor
// for "PING" to confirm the RF link before worrying about the reader. Set back
// to 0 for normal play.
#define RF_SELFTEST 0

// ===== DEBOUNCE =====
#define DEBOUNCE_MS  2000

MFRC522 reader(SS_PIN, RST_PIN);
RH_ASK rf(RF_SPEED, RF_RX_PIN, RF_TX_PIN, RF_PTT_PIN);

String lastUid = "";
unsigned long lastScanTime = 0;
unsigned long lastPing = 0;

void setup() {
  Serial.begin(115200);

  SPI.begin();
  reader.PCD_Init();
  delay(50);

  // Decisive reader check: read the MFRC522's version register. A healthy
  // reader returns 0x91 or 0x92 (genuine) or 0x12/0x88/0xB2 (clones). 0x00 or
  // 0xFF means the reader is NOT communicating over SPI — check wiring and that
  // VCC is 3.3V, not 5V.
  byte v = reader.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("MFRC522 version: 0x");
  Serial.println(v, HEX);
  if (v == 0x00 || v == 0xFF) {
    Serial.println("WARNING: reader not responding. Check SDA=10, RST=9, SPI 11/12/13, and VCC=3.3V.");
  }

  // Maximise read range/sensitivity.
  reader.PCD_SetAntennaGain(reader.RxGain_max);

  if (!rf.init()) {
    Serial.println("RF init failed!");
  } else {
    Serial.println("RF transmitter ready.");
  }
  Serial.println("Scan a card...");
}

void loop() {
  checkReader();

#if RF_SELFTEST
  if (millis() - lastPing > 2000) {
    lastPing = millis();
    const char *msg = "PING";
    rf.send((const uint8_t *)msg, 4);
    rf.waitPacketSent();
    Serial.println("Sent test PING");
  }
#endif
}

void checkReader() {
  if (!reader.PICC_IsNewCardPresent() || !reader.PICC_ReadCardSerial()) {
    return;
  }

  String uid = getUidString(reader);
  unsigned long now = millis();

  if (uid == lastUid && (now - lastScanTime) < DEBOUNCE_MS) {
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
    return;
  }

  lastUid = uid;
  lastScanTime = now;

  Serial.print("Card detected: ");
  Serial.println(uid);

  sendUid(uid);
  Serial.print("Sent over RF: ");
  Serial.println(uid);

  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
}

// Transmit the UID over RF. RadioHead adds a CRC, so the receiver drops
// corrupted packets instead of forwarding garbage. Sent twice for reliability;
// the receiver de-duplicates repeats.
void sendUid(const String &uid) {
  for (int i = 0; i < 2; i++) {
    rf.send((const uint8_t *)uid.c_str(), uid.length());
    rf.waitPacketSent();
    delay(50);
  }
}

String getUidString(MFRC522 &reader) {
  String uid = "";
  for (byte i = 0; i < reader.uid.size; i++) {
    if (i > 0) uid += " ";
    if (reader.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(reader.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}
