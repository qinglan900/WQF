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

REM 依赖检查：playwright 和 xlsx 缺一不可（不能只看 node_modules 文件夹是否存在，
REM 因为 export.bat 可能只装过 playwright，文件夹在但 xlsx 缺失会导致 sync.js 崩溃）
if not exist "%TOOLS%\node_modules\playwright" (
  echo 首次运行，正在安装依赖...
  call npm.cmd install
)
if not exist "%TOOLS%\node_modules\xlsx" (
  echo 正在补装依赖（xlsx）...
  call npm.cmd install
)

echo.
node "%TOOLS%\sync.js"
echo.
pause
