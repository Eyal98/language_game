# Windows serial bridge for the Hebrew RFID Game (no installs required).
#
# Reads the Arduino's COM port using the .NET SerialPort class that ships with
# Windows PowerShell, and bridges it to the Node server:
#   - Each line received from the Arduino (a card UID) is written to stdout.
#   - Each line received on stdin ("correct"/"wrong") is written to the Arduino
#     so its LEDs can light up.
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
  $port.Open()
} catch {
  [Console]::Error.WriteLine("Could not open $portName @ $baud : $($_.Exception.Message)")
  exit 1
}

[Console]::Error.WriteLine("Serial reader connected on $portName @ $baud")

# Optional LED feedback path: a background runspace reads status lines from the
# Node server (this process's stdin) and writes them to the Arduino. Sharing the
# SerialPort across a read thread and a write thread is supported.
$shared = [hashtable]::Synchronized(@{ Port = $port })
$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$rs.SessionStateProxy.SetVariable('shared', $shared)
$bg = [powershell]::Create()
$bg.Runspace = $rs
[void]$bg.AddScript({
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
  while ($true) {
    $status = $reader.ReadLine()
    if ($null -eq $status) { break }        # stdin closed -> server gone
    $status = $status.Trim()
    if ($status) { try { $shared.Port.WriteLine($status) } catch {} }
  }
})
[void]$bg.BeginInvoke()

# Critical path: forward each UID line from the Arduino to stdout.
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
