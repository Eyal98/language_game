# Windows serial bridge for the Hebrew RFID Game (no installs required).
#
# Reads the Arduino's COM port using the .NET SerialPort class that ships with
# Windows PowerShell, and writes each line received from the Arduino (a card
# UID) to stdout, where the Node server picks it up.
#
# The Node server spawns this automatically when SERIAL_PORT is set on Windows;
# you normally don't run it by hand. It reads SERIAL_PORT and SERIAL_BAUD from
# the environment.

$ErrorActionPreference = 'Stop'

$portName = $env:SERIAL_PORT
if (-not $portName) { [Console]::Error.WriteLine('SERIAL_PORT not set'); exit 1 }
$baud = 115200
if ($env:SERIAL_BAUD) { $baud = [int]$env:SERIAL_BAUD }

try {
  $port = New-Object System.IO.Ports.SerialPort $portName, $baud, 'None', 8, 'One'
  $port.NewLine = "`n"
  $port.ReadTimeout = [System.IO.Ports.SerialPort]::InfiniteTimeout
  # Assert DTR/RTS. Native-USB boards (Arduino Leonardo/Micro, ATmega32u4) only
  # stream serial to a host that has raised DTR — without this the Arduino IDE
  # Serial Monitor sees data but this bridge gets nothing. Harmless on Uno.
  $port.DtrEnable = $true
  $port.RtsEnable = $true
  $port.Open()
} catch {
  [Console]::Error.WriteLine("Could not open $portName @ $baud : $($_.Exception.Message)")
  exit 1
}

# A Leonardo/Micro may briefly re-enumerate when the port opens; give it a moment.
Start-Sleep -Milliseconds 300
$port.DtrEnable = $true
$port.RtsEnable = $true
try { $port.DiscardInBuffer() } catch { }

[Console]::Error.WriteLine("Serial reader connected on $portName @ $baud")

# Forward each UID line from the Arduino to stdout.
try {
  while ($true) {
    $line = $port.ReadLine()
    if ($null -ne $line) {
      $line = $line.Trim()
      if ($line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
    }
  }
} finally {
  if ($port -and $port.IsOpen) { $port.Close() }
}
