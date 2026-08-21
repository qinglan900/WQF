// 笔记数据趋势分析 - 本地一键同步脚本
// 功能：解析 excel 目录下的 Excel -> 生成 data/*.json -> 提交并推送到 GitHub
// 用法：node sync.js  （或双击 sync.bat）

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const EXCEL_DIR = path.join(ROOT, 'excel');

// 与前端一致的 10 个数值指标
const METRICS = ['曝光', '观看量', '封面点击率', '点赞', '评论', '收藏', '涨粉', '分享', '人均观看时长', '弹幕'];

function normKey(s) { return String(s).replace(/\s+/g, ''); }

// 解析单个 Excel（逻辑与前端 parseFile 保持一致）
function parseExcel(filePath) {
  const fileName = path.basename(filePath);
  const date = (fileName.match(/(\d{8})/) || [])[1];
  if (!date) throw new Error('文件名未识别到 8 位日期：' + fileName);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.some(c => c === '笔记标题') && r.some(c => c === '首次发布时间')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('未找到表头行：' + fileName);
  const header = rows[headerIdx].map(c => (c == null ? '' : String(c).trim()));

  const col = (name) => header.indexOf(name);
  const iTitle = col('笔记标题');
  const iPublish = col('首次发布时间');
  const iGenre = col('体裁');
  const metricIdx = {};
  METRICS.forEach(m => { metricIdx[m] = col(m); });

  const rowMap = new Map();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const publish = r[iPublish];
    if (publish == null || publish === '') continue;
    const key = normKey(publish);
    const metrics = {};
    METRICS.forEach(m => {
      const idx = metricIdx[m];
      const v = idx >= 0 ? r[idx] : null;
      metrics[m] = (v === null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
    });
    rowMap.set(key, {
      key,
      title: r[iTitle] != null ? String(r[iTitle]) : '',
      publish: String(publish),
      genre: iGenre >= 0 && r[iGenre] != null ? String(r[iGenre]) : '',
      metrics
    });
  }
  return { date, rows: Array.from(rowMap.values()) };
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) throw new Error('未找到 git 命令，请先安装 Git：https://git-scm.com/');
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git 执行失败').trim());
  return r.stdout;
}

function main() {
  // 1. 扫描 excel 目录下的 Excel（跳过 ~$ 临时锁文件）
  if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });
  const excelFiles = fs.readdirSync(EXCEL_DIR)
    .filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .map(f => path.join(EXCEL_DIR, f));

  if (excelFiles.length === 0) {
    console.log('未找到 Excel 文件。请把「笔记列表明细表-YYYYMMDD.xlsx」放到 excel 文件夹。');
    return;
  }

  // 2. 清空并重新生成 data 目录，保证与根目录 Excel 完全一致
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR);

  const dates = [];
  for (const fp of excelFiles) {
    try {
      const { date, rows } = parseExcel(fp);
      fs.writeFileSync(path.join(DATA_DIR, date + '.json'), JSON.stringify({ date, rows }, null, 2));
      dates.push({ date, file: date + '.json' });
      console.log(`解析完成：${path.basename(fp)} -> ${date}.json（${rows.length} 条笔记）`);
    } catch (e) {
      console.error(`解析失败：${path.basename(fp)} - ${e.message}`);
    }
  }

  dates.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify({ dates }, null, 2));

  // 3. 提交并推送
  try {
    git(['add', 'data', 'excel', 'index.html', 'sync.bat', 'README.md', '.gitignore', 'tools/sync.js', 'tools/package.json', 'tools/package-lock.json']);
    const status = git(['status', '--porcelain']).trim();
    if (!status) {
      console.log('没有新变化，无需提交。');
      return;
    }
    const msg = 'update data ' + dates.map(d => d.date).join(',');
    git(['commit', '-m', msg]);
    git(['push']);
    console.log('已同步到 GitHub。');
  } catch (e) {
    console.error('git 操作失败：' + e.message);
    console.error('请确认：1) 当前目录已是 git 仓库；2) 已配置远程并已 clone 过仓库。');
  }
}

main();
