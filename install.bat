@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo.
echo ============================================
echo   Claude Code Personal OS - Installer
echo   Windows Edition
echo ============================================
echo.

cd /d "%~dp0"
set ROOT=%cd%

REM ── Check Node.js ───────────────────────────────
echo [1/6] Check Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js belum terinstall.
    echo Download dari: https://nodejs.org/en/download
    echo Pilih LTS version. Setelah install, jalankan installer ini lagi.
    start https://nodejs.org/en/download
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo   Node.js !NODE_VER! OK

REM ── Check Claude Code CLI ───────────────────────
echo [2/6] Check Claude Code CLI...
where claude >nul 2>nul
if errorlevel 1 (
    echo Claude Code CLI belum ada. Install via npm...
    call npm install -g @anthropic-ai/claude-code
    if errorlevel 1 (
        echo Install gagal. Coba jalan PowerShell as Admin lalu: npm i -g @anthropic-ai/claude-code
        pause
        exit /b 1
    )
)
echo   Claude Code OK

REM ── Login Claude Code ───────────────────────────
echo [3/6] Login Claude Code...
echo Browser akan kebuka untuk login subscription.
echo Login dengan akun Claude.ai lo, authorize, balik kesini.
echo.
choice /c YN /m "Lanjut login sekarang"
if errorlevel 2 goto skip_login
start cmd /c "claude login && pause"
echo Setelah login berhasil, tekan tombol apa aja...
pause >nul
:skip_login

REM ── npm install all ─────────────────────────────
echo [4/6] Install dependencies...
for %%D in (whatsapp-bot telegram-bot futsal-mcp) do (
    if exist "%%D\package.json" (
        echo   Installing %%D...
        pushd "%%D"
        call npm install --silent --no-audit --no-fund
        popd
    )
)
if exist "package.json" (
    echo   Installing root...
    call npm install --silent --no-audit --no-fund
)
echo   Dependencies OK

REM ── Buat Desktop Shortcut ───────────────────────
echo [5/6] Buat shortcut di Desktop...
set "SHORTCUT=%USERPROFILE%\Desktop\Claude Code Personal OS.lnk"
set "PS_CMD=$WshShell = New-Object -ComObject WScript.Shell; $sc = $WshShell.CreateShortcut('!SHORTCUT!'); $sc.TargetPath = '%ROOT%\start.bat'; $sc.WorkingDirectory = '%ROOT%'; $sc.IconLocation = '%SystemRoot%\System32\shell32.dll,13'; $sc.Description = 'Start Claude Code Personal OS'; $sc.Save()"
powershell -NoProfile -Command "!PS_CMD!" >nul 2>&1
if exist "!SHORTCUT!" (
    echo   Shortcut dibuat: !SHORTCUT!
) else (
    echo   Warning: shortcut gagal dibuat. Manual: double-click start.bat
)

REM ── Done ────────────────────────────────────────
echo [6/6] Install selesai!
echo.
echo ============================================
echo   SETUP SELESAI
echo ============================================
echo.
echo Langkah selanjutnya:
echo   1. Double-click shortcut "Claude Code Personal OS" di Desktop
echo      atau jalankan: start.bat
echo   2. Browser akan otomatis buka setup wizard
echo   3. Isi 5 form (~3 menit)
echo   4. Scan QR WhatsApp yang muncul di terminal
echo.
choice /c YN /m "Start sekarang"
if errorlevel 2 exit /b 0
call "%ROOT%\start.bat"
