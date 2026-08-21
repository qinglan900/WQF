// 小红书「导出数据」自动下载脚本
// 功能：打开创作者后台 -> 等待登录 -> 点击「导出数据」-> 下载到 excel/ 并加日期后缀
// 首次运行需手动登录一次（手机号 + 短信验证码），登录态保存在 tools/.profile 中复用

const path = require('path');
const fs = require('fs');
// 指定浏览器下载目录为项目内（避免写入系统目录受限）
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, 'ms-playwright');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXCEL_DIR = path.join(ROOT, 'excel');
const PROFILE_DIR = path.join(__dirname, '.profile');

function today8() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

(async () => {
  if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN'
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('正在打开小红书创作服务平台...');
  await page.goto('https://creator.xiaohongshu.com/statistics/data-analysis?source=official', { waitUntil: 'domcontentloaded' });

  // 等待登录完成：以出现「导出」相关按钮为信号（未登录会被 401 重定向到登录页）
  console.log('若未登录，请在弹出的浏览器中完成登录（手机号 + 短信验证码）。');

  let exportBtn = null;
  for (const text of ['导出数据', '导出']) {
    const loc = page.locator(`text=${text}`).first();
    try {
      await loc.waitFor({ timeout: 180000 }); // 最长等 3 分钟供登录
      exportBtn = loc;
      console.log(`找到导出按钮：${text}`);
      break;
    } catch (e) {
      console.log(`未匹配到「${text}」`);
    }
  }

  if (!exportBtn) {
    console.error('未找到「导出数据」按钮。请确认已登录并打开的是数据分析页，然后重试。');
    await context.close();
    process.exit(1);
  }

  // 点击导出并等待下载
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
  console.log('点击「导出数据」...');
  await exportBtn.click();
  const download = await downloadPromise;

  if (download) {
    const suggested = download.suggestedFilename();
    const ext = path.extname(suggested) || '.xlsx';
    const base = path.basename(suggested, ext);
    const target = path.join(EXCEL_DIR, `${base}-${today8()}${ext}`);
    await download.saveAs(target);
    console.log(`已下载并保存为：${target}`);
  } else {
    console.log('未检测到直接下载。可能弹出了日期选择等对话框，请在浏览器中手动完成操作后重新运行本脚本。');
  }

  await context.close();
})();
