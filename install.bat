@echo off
setlocal
REM ============================================================
REM  Modelica VSCode extension installer / updater
REM    no args     : show interactive menu
REM    --install   : build a .vsix, then install or update
REM    --package   : build a .vsix only
REM    --uninstall : remove the installed extension
REM
REM  The extension itself lives in app\. Installing compiles the
REM  TypeScript sources to app\out\ (npm required), packages a .vsix
REM  with the repository LICENSE file, then installs it through the
REM  VS Code command-line interface.
REM  Same command for first install and for refreshing after edits.
REM  Restart VSCode afterwards to load it.
REM  Run this from the repository root. See README.md.
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SRC=%ROOT%\app"
set "EXT_ID=helion.modelica-vscode"
set "VSIXDIR=%ROOT%\.vsix-build"
set "TEMP_LICENSE=%SRC%\LICENSE"

if not exist "%SRC%\package.json" goto no_src
set "PACKAGE_JSON=%SRC%\package.json"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$pkg = ConvertFrom-Json -InputObject (Get-Content -Raw -Encoding UTF8 -LiteralPath $env:PACKAGE_JSON); $pkg.version"`) do set "VERSION=%%V"
if not defined VERSION goto version_failed
set "NAME=%EXT_ID%-%VERSION%"
set "VSIX=%VSIXDIR%\%NAME%.vsix"
set "VSCE=%SRC%\node_modules\.bin\vsce.cmd"

if /i "%~1"=="--install" goto install
if /i "%~1"=="--package" goto package
if /i "%~1"=="--uninstall" goto uninstall
if not "%~1"=="" goto usage

:menu
echo.
echo Modelica VSCode extension
echo.
echo   1. Install / update
echo   2. Build VSIX only
echo   3. Uninstall
echo   Q. Quit
echo.
set "CHOICE="
set /p "CHOICE=Select an option [1/2/3/Q]: "
if /i "%CHOICE%"=="1" goto install
if /i "%CHOICE%"=="2" goto package
if /i "%CHOICE%"=="3" goto uninstall
if /i "%CHOICE%"=="Q" goto quit
echo.
echo [INFO] Invalid option.
goto menu

:install
set "INSTALL_AFTER_PACKAGE=1"
goto build_package

:package
set "INSTALL_AFTER_PACKAGE="

:build_package
REM ---- install dev dependencies if needed ----
where npm >nul 2>nul
if errorlevel 1 goto no_npm
echo Preparing package tools...
pushd "%SRC%"
if not exist "node_modules" (
  echo   installing dev dependencies...
  call npm install --no-audit --no-fund
)
if errorlevel 1 goto build_failed_pop
popd
if not exist "%VSCE%" goto no_vsce

if not exist "%VSIXDIR%" mkdir "%VSIXDIR%"

REM ---- temporarily include repository LICENSE in the app package root ----
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
if not exist "%ROOT%\LICENSE" goto license_missing
copy /Y "%ROOT%\LICENSE" "%TEMP_LICENSE%" >nul
if errorlevel 1 goto license_copy_failed

REM ---- package and install VSIX ----
if exist "%VSIX%" del /q "%VSIX%"
echo Packaging VSIX...
pushd "%SRC%"
call "%VSCE%" package --no-dependencies --out "%VSIX%"
if errorlevel 1 goto package_failed_pop
popd
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
if not exist "%VSIX%" goto package_failed
if not exist "%SRC%\out\src\extension.js" goto build_failed

if not defined INSTALL_AFTER_PACKAGE goto package_done
where code >nul 2>nul
if errorlevel 1 goto no_code

echo Installing VSIX...
echo   %VSIX%
call code --install-extension "%VSIX%" --force
if errorlevel 1 goto install_failed

echo.
echo Done. Created and installed:
echo   %VSIX%
echo Restart all VSCode windows, then open any .mo file.
pause
exit /b 0

:package_done
echo.
echo Done. Created:
echo   %VSIX%
pause
exit /b 0

:uninstall
where code >nul 2>nul
if errorlevel 1 goto no_code
echo Uninstalling %EXT_ID% ...
call code --uninstall-extension "%EXT_ID%"
if errorlevel 1 goto uninstall_failed
echo.
echo Uninstalled. Restart all VSCode windows to apply.
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
echo   install.bat --package
echo   install.bat --uninstall
pause
exit /b 1

:no_src
echo [ERROR] Extension source not found: %SRC%
echo         Run this script from the repository root.
pause
exit /b 1

:version_failed
echo [ERROR] Could not read extension version from: %PACKAGE_JSON%
pause
exit /b 1

:no_npm
echo [ERROR] npm not found in PATH.
echo         Node.js is required to build the TypeScript sources.
echo         Install Node.js, or build manually with:
echo           cd app ^&^& npm install ^&^& npm run compile
pause
exit /b 1

:no_code
echo [ERROR] VS Code command-line tool "code" was not found in PATH.
echo         In VS Code, run "Shell Command: Install 'code' command in PATH",
echo         or add VS Code's bin directory to PATH.
pause
exit /b 1

:no_vsce
echo [ERROR] vsce was not found under app\node_modules.
echo         Run install again after npm install completes, or run:
echo           cd app ^&^& npm install
pause
exit /b 1

:build_failed_pop
popd
:build_failed
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
echo [ERROR] TypeScript build failed. See the messages above.
pause
exit /b 1

:license_missing
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
echo [ERROR] Repository LICENSE file was not found.
pause
exit /b 1

:license_copy_failed
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
echo [ERROR] Failed to copy repository LICENSE into app.
pause
exit /b 1

:package_failed_pop
popd
:package_failed
if exist "%TEMP_LICENSE%" del /q "%TEMP_LICENSE%"
echo [ERROR] VSIX packaging failed.
pause
exit /b 1

:install_failed
echo [ERROR] VSIX installation failed.
pause
exit /b 1

:uninstall_failed
echo [ERROR] Extension uninstall failed.
pause
exit /b 1
