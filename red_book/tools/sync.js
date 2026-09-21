// 笔记数据趋势分析 - 本地一键同步脚本
// 功能：先拉取远程最新数据（补全其他机器上传的 excel/data）-> 解析 excel 目录下的 Excel -> 生成 data/*.json -> 提交并推送到 GitHub
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

// 不抛异常的 git 调用，用于 pull 等需要区分失败原因的场景
function gitTry(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) return { ok: false, msg: '未找到 git 命令，请先安装 Git：https://git-scm.com/' };
  return { ok: r.status === 0, msg: (r.stderr || r.stdout || '').trim() };
}

// 前置校验 1：当前 red_book 必须位于一个 git 仓库内（.git 可能在 red_book 的上层目录）
// 典型错误场景：直接把文件夹从别的电脑 copy 过来，没有 .git，git pull/commit 全部会失败
function checkGitRepo() {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0 || (r.stdout || '').trim() !== 'true') {
    console.error('='.repeat(60));
    console.error('[错误] 当前目录不是一个 git 仓库（缺少 .git）。');
    console.error('你可能是把 red_book 文件夹从另一台电脑直接 copy 过来的。');
    console.error('请在 git 仓库根目录（含 .git 的那一层，例如 D:\\AI\\AI_test）重新 clone：');
    console.error('    git clone git@github.com:qinglan900/WQF.git');
    console.error('='.repeat(60));
    return false;
  }
  return true;
}

// 前置校验 2：必须已配置提交身份，否则 git commit 会报 Author identity unknown
function checkGitIdentity() {
  const name = spawnSync('git', ['config', '--get', 'user.name'], { cwd: ROOT, encoding: 'utf8' });
  const email = spawnSync('git', ['config', '--get', 'user.email'], { cwd: ROOT, encoding: 'utf8' });
  if (name.error || email.error || !(name.stdout || '').trim() || !(email.stdout || '').trim()) {
    console.error('='.repeat(60));
    console.error('[错误] 未配置 git 提交身份，请先执行（只需一次）：');
    console.error('    git config --global user.name "qinglan900"');
    console.error('    git config --global user.email "920568696@qq.com"');
    console.error('='.repeat(60));
    return false;
  }
  return true;
}

function main() {
  // ---- 前置校验（跨电脑 copy 后最常见的两个坑，提前给出明确提示）----
  if (!checkGitRepo()) return;
  if (!checkGitIdentity()) return;

  // 0. 先拉取远程最新数据（多人协作：本地可能缺其他机器上传的 excel/data，先补全再重建）
  //    --autostash：本地有未提交改动时自动暂存，拉取后再恢复，避免 "unstaged changes" 报错
  const pull = gitTry(['pull', '--rebase', '--autostash']);
  if (!pull.ok) {
    const conflict = /could not apply|would be overwritten|untracked working tree|CONFLICT|Auto-merging|Merge conflict/i.test(pull.msg);
    if (conflict) {
      console.error('git pull 失败（本地与远程存在冲突）：' + pull.msg);
      console.error('请先手动处理冲突（如 excel/ 下有与远程同名的文件），或回退本地修改后重试。');
      return;
    }
    console.warn('git pull 未成功，继续尝试同步：' + pull.msg);
  } else {
    console.log('已拉取远程最新数据。');
  }

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
    git(['add', 'data', 'excel', 'index.html', 'sync.bat', 'export.bat', 'README.md', '.gitignore', 'tools/sync.js', 'tools/export.js', 'tools/package.json', 'tools/package-lock.json']);
    // 只检查本项目暂存区是否有变化（status --porcelain 会包含仓库内其他无关目录）
    const staged = gitTry(['diff', '--cached', '--quiet']);
    if (staged.ok) {
      console.log('没有新变化，无需提交。');
      return;
    }
    const msg = 'update data ' + dates.map(d => d.date).join(',');
    git(['commit', '-m', msg]);
  } catch (e) {
    console.error('git 操作失败：' + e.message);
    console.error('请确认：1) 当前目录已是 git 仓库；2) 已配置远程并已 clone 过仓库。');
    return;
  }

  try {
    git(['push']);
    console.log('已同步到 GitHub。');
  } catch (e) {
    console.error('推送失败：' + e.message);
    console.error('可能远程刚被其他成员更新，请重新运行 sync 后再试。');
  }
}

main();
