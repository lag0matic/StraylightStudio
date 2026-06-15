param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [string]$Output = "",
  [switch]$FrameworkDependent
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$projectPath = Join-Path $repoRoot "agents\Starrunner.Agent\Starrunner.Agent.csproj"

if ($Output -eq "") {
  $Output = Join-Path $repoRoot "dist\starrunner-agent"
}

$resolvedOutput = [System.IO.Path]::GetFullPath($Output)

$publishArgs = @(
  "publish",
  $projectPath,
  "-c", $Configuration,
  "-r", $Runtime,
  "-o", $resolvedOutput,
  "-p:PublishSingleFile=true",
  "-p:IncludeNativeLibrariesForSelfExtract=true",
  "-p:EnableCompressionInSingleFile=true"
)

if ($FrameworkDependent) {
  $publishArgs += "--self-contained"
  $publishArgs += "false"
} else {
  $publishArgs += "--self-contained"
  $publishArgs += "true"
}

Write-Host "Publishing Starrunner.Agent to $resolvedOutput"
dotnet @publishArgs

$startupScript = Join-Path $PSScriptRoot "install-starrunner-agent-startup.ps1"
$fakeFitsScript = Join-Path $PSScriptRoot "drop-fake-fits.ps1"
$sampleSettings = Join-Path $repoRoot "agents\Starrunner.Agent\appsettings.Starrunner.sample.json"

Copy-Item -LiteralPath $startupScript -Destination (Join-Path $resolvedOutput "install-starrunner-agent-startup.ps1") -Force
Copy-Item -LiteralPath $fakeFitsScript -Destination (Join-Path $resolvedOutput "drop-fake-fits.ps1") -Force
Copy-Item -LiteralPath $sampleSettings -Destination (Join-Path $resolvedOutput "appsettings.Starrunner.sample.json") -Force

$exePath = Join-Path $resolvedOutput "Starrunner.Agent.exe"
if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Publish completed, but Starrunner.Agent.exe was not found at $exePath"
}

Write-Host ""
Write-Host "Published:"
Write-Host "  $exePath"
Write-Host ""
Write-Host "Copy the contents of this folder to Starrunner, then run:"
Write-Host "  .\Starrunner.Agent.exe"
