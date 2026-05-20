@echo off
cd /d "%~dp0"
echo Starting Paper Trading Worker in background...
start "PaperTradingWorker" /min cmd /c "node src/worker.js > data\worker.log 2>&1"
timeout /t 2 /nobreak >nul
if exist data\worker.pid (
  type data\worker.pid
  echo Worker started. Log: data\worker.log
) else (
  echo Failed to start worker. Check data\worker.log
)
