@echo off
chcp 65001 >nul
title Open Firewall Port 3001 (Administrator)

rem ============================================================
rem  Opens Windows Firewall TCP 3001 so other PCs/phones can join.
rem  Auto-elevates to administrator (UAC prompt will appear).
rem  No "press any key" prompts: auto-closes after finishing.
rem ============================================================

rem --- Self-elevate to admin ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission ...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ============================================================
echo   Adding firewall rule: inbound TCP port 3001
echo ============================================================
netsh advfirewall firewall delete rule name="SevenKingdoms-3001" >nul 2>&1
netsh advfirewall firewall add rule name="SevenKingdoms-3001" dir=in action=allow protocol=TCP localport=3001
if %errorlevel% equ 0 (
    echo.
    echo [OK] Firewall opened. Other devices can now access this server.
) else (
    echo.
    echo [ERROR] Failed to add rule.
)
echo.
echo This window will close automatically in 5 seconds ...
timeout /t 5 /nobreak >nul
