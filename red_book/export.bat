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

REM 依赖检查：playwright（导出用）和 xlsx（sync 解析用）缺一不可
REM 直接按 package.json 安装全部依赖，避免只装 playwright 导致后续 sync 缺 xlsx 崩溃
if not exist "%TOOLS%\node_modules\playwright" (
  echo 首次运行，正在安装依赖（playwright + xlsx）...
  call npm.cmd install
)
if not exist "%TOOLS%\node_modules\xlsx" (
  echo 正在补装依赖（xlsx）...
  call npm.cmd install
)

REM Playwright 在 Windows 的官方默认浏览器缓存目录是 %LOCALAPPDATA%\ms-playwright
REM （跨电脑、跨盘符通用；不再写死某台电脑的 E:\tools 路径）
if not exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
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
