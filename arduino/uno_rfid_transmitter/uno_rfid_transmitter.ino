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
 *   Reader:     SDA=10, RST=9, VCC=3.3V (NOT 5V), GND
 *   RF TX:      DATA=3, VCC=5V, GND
 *               (a ~17cm wire soldered to the TX antenna pad improves range)
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
// RH_ASK's defaults (rx=11, ptt=10) collide with the reader's SPI pins, so all
// pins are set explicitly. RX and PTT are unused on this board.
#define RF_RX_PIN   A0    // unused (no receiver on this board)
#define RF_PTT_PIN  A1    // unused

// ===== RF =====
// 2000 bps is the reliable sweet spot for these ASK modules. Must match the
// speed configured in the Leonardo receiver sketch.
#define RF_SPEED    2000

// ===== DEBOUNCE =====
#define DEBOUNCE_MS  2000

MFRC522 reader(SS_PIN, RST_PIN);
RH_ASK rf(RF_SPEED, RF_RX_PIN, RF_TX_PIN, RF_PTT_PIN);

String lastUid = "";
unsigned long lastScanTime = 0;

void setup() {
  Serial.begin(115200);   // optional: USB debug output if connected to a PC

  SPI.begin();
  reader.PCD_Init();

  if (!rf.init()) {
    Serial.println("RF init failed!");
  } else {
    Serial.println("RFID + RF transmitter ready.");
  }
}

void loop() {
  checkReader();
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

  sendUid(uid);

  Serial.print("Sent: ");
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
