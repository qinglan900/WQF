@echo off
chcp 65001 >nul
set "TOOLS=%~dp0tools"
cd /d "%TOOLS%"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%TOOLS%\node_modules" (
  echo 首次运行，正在安装依赖...
  call npm.cmd install
)

echo.
node "%TOOLS%\sync.js"
echo.
pause
