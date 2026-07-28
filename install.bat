@echo off
setlocal
REM ============================================================
REM  Modelica VSCode extension installer / updater
REM    no args     : show interactive menu
REM    --install   : install or update (idempotent)
REM    --uninstall : remove the installed extension
REM
REM  Removes ALL installed east.modelica-vscode-* versions, then
REM  copies the current source in. Same command for first install
REM  and for refreshing after edits / version bumps.
REM  Restart VSCode afterwards to load it.
REM  Run this from inside the extension folder. See README.md.
REM ============================================================

set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "NAME=east.modelica-vscode-0.15.0"
set "EXTDIR=%USERPROFILE%\.vscode\extensions"
set "DEST=%EXTDIR%\%NAME%"
set "ROBOCOPY=%SystemRoot%\System32\robocopy.exe"

if not exist "%SRC%\package.json" goto no_src

if /i "%~1"=="--install" goto install
if /i "%~1"=="--uninstall" goto uninstall
if not "%~1"=="" goto usage

:menu
echo.
echo Modelica VSCode extension
echo.
echo   1. Install / update
echo   2. Uninstall
echo   Q. Quit
echo.
set "CHOICE="
set /p "CHOICE=Select an option [1/2/Q]: "
if /i "%CHOICE%"=="1" goto install
if /i "%CHOICE%"=="2" goto uninstall
if /i "%CHOICE%"=="Q" goto quit
echo.
echo [INFO] Invalid option.
goto menu

:install
if not exist "%EXTDIR%" mkdir "%EXTDIR%"

REM ---- remove every installed version (handles updates / version bumps) ----
if exist "%EXTDIR%\east.modelica-vscode-*" (
  echo Removing previously installed versions...
  for /d %%D in ("%EXTDIR%\east.modelica-vscode-*") do (
    echo   - %%~nxD
    rmdir /s /q "%%D"
  )
)

REM ---- copy current source ----
echo Installing Modelica extension...
echo   from: %SRC%
echo   to  : %DEST%
REM modelicaGraphics is vendored under the extension folder, so this copy includes it.
"%ROBOCOPY%" "%SRC%" "%DEST%" /E /R:2 /W:1 /XD node_modules .git .vscode /XF *.map
set "RC=%ERRORLEVEL%"
REM robocopy exit codes 0-7 mean success
if %RC% GEQ 8 goto copy_failed

echo.
echo Done. Restart VSCode, then open any .mo file.
pause
exit /b 0

:uninstall
set "FOUND="
for /d %%D in ("%EXTDIR%\east.modelica-vscode-*") do (
  set "FOUND=1"
  echo Removing %%~nxD ...
  rmdir /s /q "%%D"
)
if not defined FOUND goto not_installed
echo.
echo Uninstalled. Restart VSCode to apply.
pause
exit /b 0

:not_installed
echo [INFO] Extension is not installed.
pause
exit /b 0

:quit
echo.
echo Cancelled.
exit /b 0

:usage
echo [ERROR] Unknown option: %~1
echo.
echo Usage:
echo   install.bat
echo   install.bat --install
echo   install.bat --uninstall
pause
exit /b 1

:no_src
echo [ERROR] Source not found: %SRC%
echo         Run this script from inside the extension folder.
pause
exit /b 1

:copy_failed
echo [ERROR] Copy failed (robocopy code %RC%).
pause
exit /b 1
