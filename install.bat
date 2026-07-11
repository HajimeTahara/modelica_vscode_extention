@echo off
setlocal
REM ============================================================
REM  Modelica VSCode extension installer / updater
REM    no args     : install or update (idempotent)
REM    --uninstall : remove the installed extension
REM
REM  Removes ALL installed east.modelica-vscode-* versions, then
REM  copies the current source in. Same command for first install
REM  and for refreshing after edits / version bumps.
REM  Restart VSCode afterwards to load it.
REM  Run this from inside the extension folder. See README.md.
REM ============================================================

set "SRC=%~dp0"
set "NAME=east.modelica-vscode-0.14.1"
set "EXTDIR=%USERPROFILE%\.vscode\extensions"
set "DEST=%EXTDIR%\%NAME%"

if not exist "%SRC%\package.json" goto no_src

if /i "%~1"=="--uninstall" goto uninstall

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
REM  modelicaGraphics は拡張フォルダ直下に vendor 済みのため、この robocopy で一緒にコピーされる。
robocopy "%SRC%" "%DEST%" /E /XD node_modules .git .vscode /XF *.map >nul
REM robocopy exit codes 0-7 mean success
if %ERRORLEVEL% GEQ 8 goto copy_failed

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

:no_src
echo [ERROR] Source not found: %SRC%
echo         Run this script from inside the extension folder.
pause
exit /b 1

:copy_failed
echo [ERROR] Copy failed (robocopy code %ERRORLEVEL%).
pause
exit /b 1
