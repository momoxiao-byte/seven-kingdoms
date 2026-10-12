@echo off
chcp 65001 >nul
title Install Dependencies (only needed once)

rem ============================================================
rem  Run this ONLY if node_modules is missing or corrupted.
rem  Normally you do NOT need it - dependencies are bundled.
rem  No "press any key" prompts: auto-closes after finishing.
rem ============================================================

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install LTS from https://nodejs.org/ first.
    echo This window will close automatically in 10 seconds ...
    timeout /t 10 /nobreak >nul
    exit /b 1
)

echo Installing dependencies in %CD% ...
echo.
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Install failed.
    echo This window will close automatically in 10 seconds ...
    timeout /t 10 /nobreak >nul
    exit /b 1
)

echo.
echo [OK] Dependencies installed. Building frontend ...
call npm run build
echo.
echo [OK] Done. You can now start the server with START-SERVER.bat
echo This window will close automatically in 8 seconds ...
timeout /t 8 /nobreak >nul
