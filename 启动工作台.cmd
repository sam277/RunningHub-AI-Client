@echo off
chcp 65001 >nul
setlocal
set "RH_APP_ROOT=%~dp0"
set "npm_config_cache=%~dp0.npm-cache"
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更新版本。
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('需要 Node.js 24 或更新版本');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm ci --cache .npm-cache
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath 'node.exe' -WorkingDirectory $env:RH_APP_ROOT -ArgumentList @('scripts/start-local.mjs','--open') -WindowStyle Hidden"
endlocal
