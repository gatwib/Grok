@echo off
title WangLinS GAC - Grok Auto Signup
cd /d "%~dp0"
echo ============================================
echo   WangLinS GAC - Grok Auto Signup Runner
echo ============================================
echo.
echo Menjalankan: npm run dev
echo (Pilih [1] Create akun, [2] Add ke 9Router, [0] Exit)
echo.
call npm run dev
echo.
echo ============================================
echo   Program selesai / berhenti.
echo ============================================
pause
