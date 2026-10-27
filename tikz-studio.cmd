@echo off
rem Compatibility wrapper: the real launcher is "TikZ Studio.vbs" (no console window).
start "" wscript.exe "%~dp0TikZ Studio.vbs"
exit /b 0