@echo off
REM Start Opera GX with remote debugging on port 9333

echo.
echo Starting Opera GX with remote debugging...
echo.

REM Find Opera GX installation
set "OPERA_PATH=%LocalAppData%\Programs\Opera GX\opera.exe"
if not exist "%OPERA_PATH%" (
    set "OPERA_PATH=%ProgramFiles%\Opera GX\opera.exe"
)

if not exist "%OPERA_PATH%" (
    set "OPERA_PATH=%ProgramFiles(x86)%\Opera GX\opera.exe"
)

if not exist "%OPERA_PATH%" (
    echo ERROR: Opera GX not found
    echo Checked:
    echo   - %LocalAppData%\Programs\Opera GX\opera.exe
    echo   - %ProgramFiles%\Opera GX\opera.exe
    echo   - %ProgramFiles(x86)%\Opera GX\opera.exe
    pause
    exit /b 1
)

REM Start Opera GX with remote debugging on port 9333
start "" "%OPERA_PATH%" --remote-debugging-port=9333 --no-first-run

echo.
echo ✓ Opera GX started with remote debugging on port 9333
echo.
echo Next steps:
echo 1. Navigate to the UFC analyzer page (opera-extension://...../analyzer.html)
echo 2. Make sure UFC London event is loaded
echo 3. Wait for fighter data to load
echo 4. Run: node fetch-london-data.js
echo.
pause
