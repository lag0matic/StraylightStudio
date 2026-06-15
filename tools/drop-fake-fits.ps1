param(
  [string]$OutputRoot = "",
  [string]$Target = "M31",
  [string]$ImageType = "Light",
  [string]$DateFolder = "",
  [double]$SensorTemp = -15,
  [double]$ExposureSeconds = 10.21,
  [int]$FrameNumber = 1,
  [int]$SizeBytes = 4096
)

$ErrorActionPreference = "Stop"

if ($OutputRoot -eq "") {
  $OutputRoot = Join-Path $PSScriptRoot "..\tmp\nina-output"
}

if ($DateFolder -eq "") {
  $DateFolder = Get-Date -Format "yyyy-MM-dd"
}

if ($SizeBytes -lt 2880) {
  throw "FITS test files should be at least 2880 bytes."
}

$safeTarget = $Target -replace '[\\/:*?"<>|]', ''
$safeImageType = ($ImageType -replace '[\\/:*?"<>|]', '').ToUpperInvariant()
$safeDateFolder = $DateFolder -replace '[\\/:*?"<>|]', ''
$folder = Join-Path (Join-Path (Join-Path $OutputRoot $safeDateFolder) $safeTarget) $safeImageType
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$tempToken = "{0:0.##}" -f $SensorTemp
$exposureToken = "{0:0.##}" -f $ExposureSeconds
$fileName = "{0}_{1}_{2}_{3}_{4:D4}.fits" -f $safeTarget, $tempToken, $exposureToken, $safeImageType, $FrameNumber
$path = Join-Path $folder $fileName

$header = @(
  "SIMPLE  =                    T",
  "BITPIX  =                    8",
  "NAXIS   =                    0",
  "EXTEND  =                    T",
  "OBJECT  = '$safeTarget'",
  "IMAGETYP= '$safeImageType'",
  "END"
) -join ""

$bytes = New-Object byte[] $SizeBytes
$headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
[Array]::Copy($headerBytes, $bytes, [Math]::Min($headerBytes.Length, $bytes.Length))

for ($index = $headerBytes.Length; $index -lt $bytes.Length; $index++) {
  $bytes[$index] = [byte](32 + ($index % 64))
}

[System.IO.File]::WriteAllBytes($path, $bytes)

Write-Host "Created fake FITS frame:"
Write-Host "  $path"
