param([switch]$Force)

$src = $PSScriptRoot
$dst = Join-Path (Split-Path $src -Parent) "paper-trading-public"

Write-Host "Source: $src"
Write-Host "Target: $dst"

if (Test-Path $dst) {
    if (-not $Force) {
        $resp = Read-Host "Target exists. Remove? (y/N)"
        if ($resp -ne "y") { exit 0 }
    }
    Remove-Item -Recurse -Force $dst
}
New-Item -ItemType Directory -Path $dst -Force | Out-Null

$excludeDirs = @("node_modules", "data", "backups", ".git", "src.v3-backup", "out", "dist", ".vscode", ".idea", "__pycache__", "auth", "files", "calendar", "generated")
$excludeFiles = @(".env", "sessions.json", "cwds.json", "models.json", "*.db", "*.db-wal", "*.db-shm", "*.log", "*.pid")

$argList = @($src, $dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS")
foreach ($d in $excludeDirs) { $argList += "/XD"; $argList += $d }
foreach ($f in $excludeFiles) { $argList += "/XF"; $argList += $f }

Write-Host "Copying..."
& robocopy @argList | Out-Null

Write-Host "Removing leftover .env (keep .env.example)..."
Get-ChildItem -Path $dst -Filter ".env" -Recurse -Force | Where-Object { $_.Name -eq ".env" } | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Scrubbing sensitive strings..."
$patterns = @{
    "YOUR_TELEGRAM_BOT_TOKEN" = "YOUR_TELEGRAM_BOT_TOKEN"
    "YOUR_GROQ_API_KEY" = "YOUR_GROQ_API_KEY"
    "YOUR_PHONE_NUMBER" = "YOUR_PHONE_NUMBER"
    "YOUR_TELEGRAM_CHAT_ID" = "YOUR_TELEGRAM_CHAT_ID"
    "YOUR_BOSS_SECRET_CODE" = "YOUR_BOSS_SECRET_CODE"
    "your-email@example.com" = "your-email@example.com"
}

Get-ChildItem -Path $dst -Include "*.js","*.mjs","*.json","*.md","*.html","*.sh","*.ps1","*.bat","*.example" -Recurse | ForEach-Object {
    try {
        $content = Get-Content $_.FullName -Raw -ErrorAction Stop
        if (-not $content) { return }
        $modified = $false
        foreach ($pattern in $patterns.Keys) {
            if ($content.Contains($pattern)) {
                $content = $content.Replace($pattern, $patterns[$pattern])
                $modified = $true
            }
        }
        if ($modified) {
            Set-Content -Path $_.FullName -Value $content -NoNewline
            Write-Host ("  scrubbed: " + $_.FullName.Substring($dst.Length))
        }
    } catch {}
}

$size = (Get-ChildItem $dst -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ""
Write-Host "DONE"
Write-Host "Location: $dst"
Write-Host ("Size: " + [math]::Round($size, 2) + " MB")
