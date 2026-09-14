// 小红书「导出数据」自动下载脚本
// 功能：打开创作者后台 -> 等待登录 -> 选择「笔记首发时间」（START_DATE 至当天）-> 等数据刷新 -> 点击「导出数据」-> 下载到 excel/ 并加日期后缀
// 首次运行需手动登录一次（手机号 + 短信验证码），登录态保存在 tools/.profile 中复用

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXCEL_DIR = path.join(ROOT, 'excel');
const PROFILE_DIR = path.join(__dirname, '.profile');

// 笔记首发时间的起始日期（固定），结束日期为当天
const START_DATE = '2026-08-07';

function pad(n) { return String(n).padStart(2, '0'); }

function today8() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

// 打开日期范围选择面板
async function openDatePanel(page) {
  await page.locator('.d-daterangepicker-prefix').first().click();
  await page.locator('.d-daterangepicker-body .d-datepicker-calendar').first().waitFor({ timeout: 10000 });
}

// 读取面板中各月份日历显示的 [年, 月]
async function panelMonths(page) {
  const calendars = page.locator('.d-daterangepicker-body .d-datepicker-calendar');
  const count = await calendars.count();
  const infos = [];
  for (let i = 0; i < count; i++) {
    const texts = await calendars.nth(i).locator('.d-datepicker-selector h6').allTextContents();
    const y = parseInt(((texts[0] || '').match(/\d{4}/) || [])[0] || '0');
    const m = parseInt(((texts[1] || '').match(/\d+/) || [])[0] || '0');
    infos.push({ y, m });
  }
  return infos;
}

// 用左面板的箭头翻月（step=1 下个月，-1 上个月）
async function goMonth(page, step) {
  const left = page.locator('.d-daterangepicker-body .d-datepicker-calendar').first();
  // header 中图标顺序：上一年、上个月、下个月、下一年
  await left.locator('.d-datepicker-header .d-icon').nth(step < 0 ? 1 : 2).click();
  await page.waitForTimeout(250);
}

// 翻页直到目标年月出现在面板中，返回其面板序号
async function navigateToMonth(page, y, m) {
  for (let i = 0; i < 36; i++) {
    const infos = await panelMonths(page);
    if (!infos.length) throw new Error('未找到日期面板');
    const idx = infos.findIndex(p => p.y === y && p.m === m);
    if (idx >= 0) return idx;
    const diff = (y * 12 + m) - (infos[0].y * 12 + infos[0].m);
    await goMonth(page, diff > 0 ? 1 : -1);
  }
  throw new Error(`翻月失败，未找到 ${y}-${m}`);
}

// 在指定面板中点击某日（排除非本月的占位日期）
async function clickDay(page, panelIndex, day) {
  const cell = page.locator('.d-daterangepicker-body .d-datepicker-calendar')
    .nth(panelIndex)
    .locator('div.d-datepicker-cell:not([class*="placeholder"])')
    .filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) })
    .first();
  await cell.waitFor({ timeout: 5000 });
  await cell.click();
  await page.waitForTimeout(300);
}

// 选择笔记首发时间范围
async function pickDateRange(page, start, end) {
  await openDatePanel(page);
  const idx1 = await navigateToMonth(page, start.y, start.m);
  await clickDay(page, idx1, start.d);
  const idx2 = await navigateToMonth(page, end.y, end.m);
  await clickDay(page, idx2, end.d);
  // 选完结束日期后面板会自动收起，等待其消失
  await page.locator('.d-daterangepicker-body').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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

  let found = false;
  for (const text of ['导出数据', '导出']) {
    try {
      await page.locator(`text=${text}`).first().waitFor({ timeout: 180000 }); // 最长等 3 分钟供登录
      found = true;
      console.log(`找到导出按钮：${text}`);
      break;
    } catch (e) {
      console.log(`未匹配到「${text}」`);
    }
  }

  if (!found) {
    console.error('未找到「导出数据」按钮。请确认已登录并打开的是数据分析页，然后重试。');
    await context.close();
    process.exit(1);
  }

  // 选择笔记首发时间：START_DATE 至当天
  const now = new Date();
  const start = parseYMD(START_DATE);
  const end = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  console.log(`选择笔记首发时间：${START_DATE} ~ ${end.y}-${pad(end.m)}-${pad(end.d)}`);
  try {
    await pickDateRange(page, start, end);
  } catch (e) {
    console.error('日期选择失败：' + e.message);
    console.error('请确认已打开的是数据分析页且页面加载完成，然后重试。');
    await context.close();
    process.exit(1);
  }

  // 校验输入框中的日期范围
  const sv = await page.locator('.d-daterangepicker-input-start input').first().inputValue().catch(() => '');
  const ev = await page.locator('.d-daterangepicker-input-end input').first().inputValue().catch(() => '');
  console.log(`当前日期范围：${sv} ~ ${ev}`);
  if (sv !== START_DATE || ev !== `${end.y}-${pad(end.m)}-${pad(end.d)}`) {
    console.warn('警告：日期与预期不一致，请留意浏览器中的实际筛选结果。');
  }

  // 等待表格数据刷新（后台是 SPA，持续有网络请求，不能用 networkidle，会长时间挂住）
  console.log('等待数据刷新...');
  await page.waitForTimeout(1200);

  // 点击导出并等待下载（重新定位按钮，防止 DOM 刷新后失效）
  const downloadPromise = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
  console.log('点击「导出数据」...');
  await page.locator('text=导出数据').first().click();
  const download = await downloadPromise;

  if (download) {
    const suggested = download.suggestedFilename();
    const ext = path.extname(suggested) || '.xlsx';
    const base = path.basename(suggested, ext);
    let target = path.join(EXCEL_DIR, `${base}-${today8()}${ext}`);
    try {
      await download.saveAs(target);
    } catch (e) {
      // 目标文件可能被 Excel 打开占用，换个带时间戳的文件名保存
      if (e && /EBUSY|EPERM|resource busy/i.test(String(e.message))) {
        const d = new Date();
        target = path.join(EXCEL_DIR, `${base}-${today8()}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ext}`);
        console.warn('目标文件被占用（可能正在 Excel 中打开），改用新文件名保存。');
        await download.saveAs(target);
      } else {
        throw e;
      }
    }
    console.log(`已下载并保存为：${target}`);
  } else {
    console.log('未检测到直接下载。可能弹出了其他对话框，请在浏览器中手动完成操作后重新运行本脚本。');
  }

  await context.close();
})();
