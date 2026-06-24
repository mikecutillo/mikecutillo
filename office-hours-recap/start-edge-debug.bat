@echo off
REM ============================================================
REM  Launches Microsoft Edge with a DEDICATED automation profile
REM  and the DevTools/CDP debug port so Playwright can attach.
REM
REM  First run: sign into Teams + Outlook in this window (MFA once).
REM  The profile lives in %USERPROFILE%\EdgeAutomationProfile and
REM  persists, so you stay signed in for future weeks.
REM
REM  This does NOT touch your normal Edge profile.
REM ============================================================

set EDGE_PROFILE=%USERPROFILE%\EdgeAutomationProfile
set DEBUG_PORT=9222

REM Try the standard install locations for msedge.exe
set EDGE_EXE=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe

if "%EDGE_EXE%"=="" (
  echo Could not find msedge.exe in the usual locations.
  echo Edit this .bat and set EDGE_EXE to your Edge path.
  pause
  exit /b 1
)

echo Launching Edge on debug port %DEBUG_PORT% with profile:
echo   %EDGE_PROFILE%
echo.
start "" "%EDGE_EXE%" --remote-debugging-port=%DEBUG_PORT% --user-data-dir="%EDGE_PROFILE%" https://teams.microsoft.com
