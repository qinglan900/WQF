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

if not exist "%TOOLS%\ms-playwright" (
  echo 首次运行，正在下载浏览器（国内镜像，约 300MB，请耐心等待）...
  set "PLAYWRIGHT_BROWSERS_PATH=%TOOLS%\ms-playwright"
  set "PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright"
  call npx.cmd playwright install chromium
)

echo.
node "%TOOLS%\export.js"
echo.
pause
