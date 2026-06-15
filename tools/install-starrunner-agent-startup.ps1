param(
  [string]$AgentPath = ""
)

$ErrorActionPreference = "Stop"

if ($AgentPath -eq "") {
  $AgentPath = Join-Path $PSScriptRoot "..\dist\starrunner-agent\Starrunner.Agent.exe"
}

$resolvedAgent = Resolve-Path -LiteralPath $AgentPath
$workingDirectory = Split-Path -Parent $resolvedAgent.Path
$startupFolder = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupFolder "Starrunner Agent.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $resolvedAgent.Path
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.WindowStyle = 7
$shortcut.Description = "Starts the Straylight Studio telescope-side frame transfer agent."
$shortcut.Save()

Write-Host "Created Startup shortcut:"
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "Target:"
Write-Host "  $($resolvedAgent.Path)"
