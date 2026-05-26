@echo off
REM Start Chrome with remote debugging on port 9222
REM This allows automated tools to connect and control Chrome

echo.
echo Starting Chrome with remote debugging...
echo.

REM Find Chrome installation
set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_PATH%" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)

if not exist "%CHROME_PATH%" (
    echo ERROR: Chrome not found
    pause
    exit /b 1
)

REM Start Chrome with remote debugging on port 9222
start "" "%CHROME_PATH%" --remote-debugging-port=9222 --no-first-run

echo.
echo ✓ Chrome started with remote debugging on port 9222
echo.
echo Next steps:
echo 1. Navigate to the UFC analyzer page (chrome-extension://...../analyzer.html)
echo 2. Load UFC London event
echo 3. Wait for fighter data to load
echo 4. Run: node fetch-london-data.js
echo.
pause
