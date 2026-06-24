@echo off
REM ============================================================
REM  Unattended weekly run, called by Task Scheduler.
REM
REM  Edit MEETING_URL below (one time): open the Office Hours recap
REM  in the automation Edge, copy the address-bar URL, paste here.
REM
REM  Usage:
REM    run-recap.bat          -> LIVE  (To + full Bcc + send)
REM    run-recap.bat test     -> TEST  (To = mcutillo only, no Bcc, still sends)
REM ============================================================

cd /d "%~dp0"

REM >>> EDIT THIS ONE LINE <<<
set "MEETING_URL=PASTE_THE_TEAMS_RECAP_URL_HERE"

set "DEBUG_PORT=9222"
set "EDGE_PROFILE=%USERPROFILE%\EdgeAutomationProfile"
set "LOGDIR=%~dp0logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set "DT=%%a"
set "STAMP=%DT:~0,8%-%DT:~8,6%"
set "LOG=%LOGDIR%\run-%STAMP%.log"

REM Pick test vs live flags
set "MODEFLAGS=--send"
if /I "%~1"=="test" set "MODEFLAGS=--test --send"

REM Make sure the automation Edge (with the debug port) is up.
set "EDGE_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo [%DATE% %TIME%] starting run (%MODEFLAGS%) > "%LOG%"
echo [%DATE% %TIME%] ensuring Edge debug session on port %DEBUG_PORT% >> "%LOG%"
start "" "%EDGE_EXE%" --remote-debugging-port=%DEBUG_PORT% --user-data-dir="%EDGE_PROFILE%" about:blank
REM give Edge time to come up / restore session
timeout /t 20 /nobreak >nul

echo [%DATE% %TIME%] running send-recap.js >> "%LOG%"
node "%~dp0send-recap.js" --auto --meeting-url "%MEETING_URL%" %MODEFLAGS% >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] send-recap.js exit code = %RC% >> "%LOG%"

REM Exit codes: 0 ok | 2 no Edge | 3 no compose | 4 Teams nav | 5 empty body
exit /b %RC%
