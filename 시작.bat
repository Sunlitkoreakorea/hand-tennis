@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Hand Tennis - local server on http://localhost:8765/
echo   Close this window to stop.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8765/"
python -m http.server 8765
