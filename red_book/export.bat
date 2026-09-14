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

if not exist "%TOOLS%\node_modules\playwright" (
  echo 首次运行，正在安装 Playwright...
  call npm.cmd install playwright
)

if not exist "E:\tools\playwright-browsers\chromium-*" (
  echo 首次运行，正在下载浏览器（国内镜像，约 300MB，请耐心等待）...
  set "PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright"
  call npx.cmd playwright install chromium
)

echo.
node "%TOOLS%\export.js"
echo.

echo 是否立即执行 sync.bat 同步数据？（5 秒无输入则默认执行）
choice /C YN /T 5 /D Y /M "[Y/N]"
if errorlevel 2 (
  echo 已跳过同步。
  pause
) else (
  call "%~dp0sync.bat"
)
