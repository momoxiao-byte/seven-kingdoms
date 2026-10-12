@echo off
chcp 65001 >nul
title Seven Kingdoms Game Server (port 3001)

rem ============================================================
rem  Seven Kingdoms - One-click server launcher for Windows 10
rem  - Always runs from THIS folder (movable / copy-safe)
rem  - Uses bundled node_modules, no internet required
rem  - Listens on 0.0.0.0:3001 (LAN accessible)
rem  - No "press any key" prompts: errors auto-close after 10s
rem ============================================================

cd /d "%~dp0"

echo ============================================================
echo            Seven Kingdoms - Game Server
echo ============================================================
echo.

rem ---- 1. Check Node.js ----
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found on this machine.
    echo.
    echo Please install Node.js LTS first:
    echo     https://nodejs.org/  ^(download the LTS .msi^)
    echo After installing, re-run this file.
    echo.
    echo This window will close automatically in 10 seconds ...
    timeout /t 10 /nobreak >nul
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo [OK] Node.js version: %%v

rem ---- 2. Check bundled dependencies ----
if not exist "node_modules\.bin\tsx.cmd" (
    echo [WARN] Dependencies not found. Running npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Check network or run "1-INSTALL-DEPS.bat".
        echo This window will close automatically in 10 seconds ...
        timeout /t 10 /nobreak >nul
        exit /b 1
    )
) else (
    echo [OK] Dependencies ready ^(bundled^)
)

rem ---- 3. Check built frontend (dist) ----
if not exist "dist\index.html" (
    echo [WARN] Frontend build missing. Building now ...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] Frontend build failed.
        echo This window will close automatically in 10 seconds ...
        timeout /t 10 /nobreak >nul
        exit /b 1
    )
) else (
    echo [OK] Frontend files ready ^(dist folder^)
)

rem ---- 4. Try to open firewall port 3001 (non-fatal if no admin) ----
netsh advfirewall firewall show rule name="SevenKingdoms-3001" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Adding Windows Firewall rule for port 3001 ...
    netsh advfirewall firewall add rule name="SevenKingdoms-3001" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
    if %errorlevel% neq 0 (
        echo [WARN] No admin rights - firewall rule NOT added.
        echo        Other PCs/phones may be blocked. Fix: right-click
        echo        "2-OPEN-FIREWALL-ADMIN.bat" ^> Run as administrator.
    ) else (
        echo [OK] Firewall port 3001 opened
    )
) else (
    echo [OK] Firewall rule already exists
)

rem ---- 5. Show all LAN IPv4 addresses ----
echo.
echo ============================================================
echo  Server starting... Open these URLs in a browser:
echo.
echo   On this machine : http://localhost:3001
echo   From other PCs  : http://[this-server-IP]:3001
echo.
echo  This server's IPv4 addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:3001
echo ============================================================
echo.
echo  Keep THIS WINDOW OPEN. Closing it stops the server.
echo  Press Ctrl+C to stop.
echo.

rem ---- 6. Launch server using the BUNDLED tsx (no npx / no network) ----
set HOST=0.0.0.0
set PORT=3001
call "node_modules\.bin\tsx.cmd" server/index.ts

rem Server exited (Ctrl+C or crashed) - no pause, window closes itself
echo.
echo [INFO] Server has stopped. This window will close in 5 seconds ...
timeout /t 5 /nobreak >nul
