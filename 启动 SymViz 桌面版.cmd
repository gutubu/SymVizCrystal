@echo off
setlocal
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
set "ELECTRON=%ROOT%\node_modules\electron\dist\electron.exe"
set "APP_BUILD=%ROOT%\dist\server\index.js"

rem pnpm may preserve a previously complete Electron runtime under .ignored
rem when it encounters dependencies installed by another package manager.
if not exist "%ELECTRON%" set "ELECTRON=%ROOT%\node_modules\.ignored\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo SymViz desktop runtime is missing.
  echo Please keep the complete node_modules folder beside this launcher.
  echo Checked: node_modules\electron and node_modules\.ignored\electron
  pause
  exit /b 1
)

if not exist "%APP_BUILD%" (
  echo SymViz desktop build is missing.
  echo Please ask Codex to rebuild the desktop application.
  pause
  exit /b 1
)

pushd "%ROOT%"
start "" "%ELECTRON%" .
popd
exit /b 0
