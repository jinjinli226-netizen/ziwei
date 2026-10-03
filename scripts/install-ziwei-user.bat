@echo off
setlocal
set "ROOT=%~dp0.."
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请先安装 Node.js 24 或更高版本。
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 node。请先安装 Node.js 24 或更高版本。
  exit /b 1
)
for /f "tokens=1 delims=." %%V in ('node --version') do set "NODE_MAJOR=%%V"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if not defined NODE_MAJOR (
  echo 无法读取 Node.js 版本，请安装 Node.js 24 或更高版本。
  exit /b 1
)
if %NODE_MAJOR% LSS 24 (
  echo 需要 Node.js 24 或更高版本，当前版本为 %NODE_MAJOR%。
  exit /b 1
)
pushd "%ROOT%"
if not exist "%ROOT%\node_modules\vue" (
  echo 正在安装紫薇依赖...
  call npm ci --ignore-scripts
  if errorlevel 1 (
    set "CODE=%ERRORLEVEL%"
    goto :done
  )
)
call npm run ziwei:setup -- %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto :done
call node scripts/start-ziwei-user.mjs
set "CODE=%ERRORLEVEL%"
:done
popd
exit /b %CODE%
