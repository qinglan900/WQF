# 笔记数据趋势分析

一个多人共享的笔记数据趋势分析工具。前端部署在 GitHub Pages，数据通过 git 仓库共享，团队成员打开同一网址即可看到同一份趋势数据。

## 目录结构

```
├── index.html              # 前端页面（GitHub Pages 托管）
├── sync.bat                # 每日双击（Windows）
├── excel/                  # 原始 Excel（每天放这里）
│   └── 笔记列表明细表-YYYYMMDD.xlsx
├── data/                   # 共享数据（脚本自动生成，请勿手动修改）
│   ├── index.json          # 日期清单
│   └── YYYYMMDD.json       # 每天的数据
├── tools/                  # 脚本幕后文件（无需直接操作）
│   ├── sync.js
│   ├── package.json
│   └── package-lock.json
├── README.md
└── .gitignore
```

## 首次搭建（一次性）

1. 安装环境：[Node.js](https://nodejs.org/) 和 [Git](https://git-scm.com/)。
2. 在 GitHub 新建一个仓库（例如 `note-trend`，建议公开仓库以便 Pages 免费使用）。
3. 把本项目所有文件放进该仓库并推送：

   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/你的用户名/note-trend.git
   git push -u origin main
   ```

4. 启用 GitHub Pages：仓库页 → `Settings` → `Pages` → Source 选 `main` 分支、根目录 → `Save`。
5. 打开生成的网址（形如 `https://你的用户名.github.io/note-trend/`），全团队访问此地址即可。

## 每日使用（3 步）

1. 导出当天的「笔记列表明细表」Excel，放到 `excel/` 文件夹。
2. 双击 `sync.bat`，脚本自动解析 `excel/` 里的 Excel、生成 `data/` 并推送到 GitHub（首次会自动安装依赖）。
3. 刷新页面，全团队即可看到最新趋势。

## 说明

- 数据存于 `data/*.json`，由脚本自动生成，请勿手动修改。
- `excel/` 需**保留所有历史 Excel**，脚本每次全量重新生成 `data/`，保证数据一致。
- Excel 文件名必须包含 8 位日期，如 `笔记列表明细表-20260819.xlsx`。
- `excel/` 和 `data/` 都会提交到 git 仓库，方便追溯与多人协作。
- 前端也支持手动上传 Excel（仅本地临时查看，不影响共享数据）。
- 发布新数据后，页面刷新即可看到；如遇浏览器缓存，可用 `Ctrl + F5` 强制刷新。
