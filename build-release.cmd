@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1" %*
set "build_exit=%ERRORLEVEL%"
if not "%build_exit%"=="0" echo Release build failed. Exit code: %build_exit%
pause
exit /b %build_exit%
