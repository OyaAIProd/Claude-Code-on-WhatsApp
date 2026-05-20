# Update script for Windows PowerShell
Set-Location $PSScriptRoot
Write-Host "Starting update..." -ForegroundColor Cyan

if (-not (Test-Path .git)) {
  Write-Host "Not a git repo. Init: git init && git remote add origin <url>" -ForegroundColor Red
  exit 1
}

$old = git rev-parse HEAD
git pull --ff-only
$new = git rev-parse HEAD

if ($old -eq $new) {
  Write-Host "Already up-to-date" -ForegroundColor Green
  exit 0
}

Write-Host "Update detected: $old -> $new" -ForegroundColor Yellow

foreach ($dir in @("paper-trading-mcp", "whatsapp-bot", "telegram-bot", "futsal-mcp")) {
  if (Test-Path "$dir\package.json") {
    Write-Host "npm install in $dir..." -ForegroundColor Cyan
    Push-Location $dir
    npm install --silent --no-audit --no-fund
    Pop-Location
  }
}

Write-Host "Update complete: $new" -ForegroundColor Green
