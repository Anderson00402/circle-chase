@echo off
rem Double-click to play Circle Chase at http://localhost:8090 (only this computer can open it).
rem It serves whatever branch is checked out in GitHub Desktop: switch branch, then refresh the page.
rem Needs Python (python.org). Without it you can still double-click index.html to play.
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py
echo Circle Chase at http://localhost:8090/
echo Leave this window open while you play. Close it to stop.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8090/"
%PY% -m http.server 8090 --bind 127.0.0.1
echo.
echo The server stopped. If it says Python was not found, install Python or double-click index.html instead.
pause
