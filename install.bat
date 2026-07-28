@echo off
setlocal
REM ============================================================
REM  Modelica VSCode extension installer / updater
REM    no args     : show interactive menu
REM    --install   : build, then install or update (idempotent)
REM    --uninstall : remove the installed extension
REM
REM  The extension itself lives in app\. Installing compiles the
REM  TypeScript sources to app\out\ (npm required), removes ALL
REM  installed east.modelica-vscode-* versions, then copies app\ in.
REM  Same command for first install and for refreshing after edits.
REM  Restart VSCode afterwards to load it.
REM  Run this from the repository root. See README.md.
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SRC=%ROOT%\app"
REM Keep in sync with app\package.json "version".
set "NAME=east.modelica-vscode-0.15.1"
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
REM ---- build TypeScript -> app\out ----
REM Nothing is removed or copied until the build succeeds, so a failed build
REM leaves any previously installed version untouched.
where npm >nul 2>nul
if errorlevel 1 goto no_npm
echo Building TypeScript...
pushd "%SRC%"
if not exist "node_modules" (
  echo   installing dev dependencies...
  call npm install --no-audit --no-fund
)
if errorlevel 1 goto build_failed_pop
REM Clean rebuild: tsc leaves stale .js in out\ when a source is renamed or
REM deleted, and those would otherwise be shipped.
call npm run rebuild
if errorlevel 1 goto build_failed_pop
popd
if not exist "%SRC%\out\src\extension.js" goto build_failed
echo   built: %SRC%\out

if not exist "%EXTDIR%" mkdir "%EXTDIR%"

REM ---- remove every installed version (handles updates / version bumps) ----
if exist "%EXTDIR%\east.modelica-vscode-*" (
  echo Removing previously installed versions...
  for /d %%D in ("%EXTDIR%\east.modelica-vscode-*") do (
    echo   - %%~nxD
    rmdir /s /q "%%D"
  )
)

REM ---- copy current build ----
echo Installing Modelica extension...
echo   from: %SRC%
echo   to  : %DEST%
REM modelicaGraphics is vendored under app\ and compiles into out\, so out\ has it.
REM TS sources / build config / dev deps are not needed at runtime; the source dirs
REM are excluded by full path so out\modelicaGraphics (same basename) still gets copied.
"%ROBOCOPY%" "%SRC%" "%DEST%" /E /R:2 /W:1 ^
  /XD node_modules .git .vscode "%SRC%\src" "%SRC%\modelicaGraphics" ^
  /XF *.map *.ts tsconfig.json package-lock.json
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
echo [ERROR] Extension source not found: %SRC%
echo         Run this script from the repository root.
pause
exit /b 1

:no_npm
echo [ERROR] npm not found in PATH.
echo         Node.js is required to build the TypeScript sources.
echo         Install Node.js, or build manually with:
echo           cd app ^&^& npm install ^&^& npm run compile
pause
exit /b 1

:build_failed_pop
popd
:build_failed
echo [ERROR] TypeScript build failed. See the messages above.
pause
exit /b 1

:copy_failed
echo [ERROR] Copy failed (robocopy code %RC%).
pause
exit /b 1
