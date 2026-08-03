@echo off
setlocal
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
set "ELECTRON=%ROOT%\node_modules\electron\dist\electron.exe"
set "APP_BUILD=%ROOT%\dist\server\index.js"

if not exist "%ELECTRON%" (
  echo SymViz desktop runtime is missing.
  echo Please keep the node_modules folder beside this launcher.
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
