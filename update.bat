@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Update Claude Code Personal OS
echo ============================================
echo.

if not exist ".git" (
    echo Bukan git repo. Skip git pull.
) else (
    echo git pull...
    git pull --ff-only
)

echo Update dependencies...
for %%D in (whatsapp-bot telegram-bot futsal-mcp) do (
    if exist "%%D\package.json" (
        echo   %%D...
        pushd "%%D"
        call npm install --silent --no-audit --no-fund
        popd
    )
)

echo.
echo Update selesai. Restart bot via start.bat
pause
