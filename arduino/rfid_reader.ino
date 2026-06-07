/*
 * Hebrew RFID Game - Single Reader over USB Serial (no WiFi)
 *
 * Race mode on ONE reader: each word has two cards (one per player). The card
 * UID itself tells the server which player scanned, so both players race on the
 * same reader. This sketch just reports each scanned UID over USB serial; the
 * Node server (with SERIAL_PORT set) reads the line and runs the game.
 *
 * Hardware:
 *   - Arduino Uno/Leonardo connected to the PC over USB
 *   - 1x MFRC522 RFID reader
 *
 * Wiring:
 *   Reader SPI: SCK=13, MOSI=11, MISO=12
 *   Reader:     SDA=10, RST=9
 */

#include <SPI.h>
#include <MFRC522.h>

// ===== PINS =====
#define SS_PIN      10    // Reader SS
#define RST_PIN     9     // Reader RST

// ===== DEBOUNCE =====
#define DEBOUNCE_MS  2000

// Must match SERIAL_BAUD on the server (default 115200).
#define SERIAL_BAUD  115200

MFRC522 reader(SS_PIN, RST_PIN);

String lastUid = "";
unsigned long lastScanTime = 0;

void setup() {
  Serial.begin(SERIAL_BAUD);

  SPI.begin();
  reader.PCD_Init();
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

  // One UID per line — this is all the server needs.
  Serial.println(uid);

  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
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
