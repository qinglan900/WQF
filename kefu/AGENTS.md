<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 智能客服项目说明

基于 Next.js（App Router）+ TypeScript + Tailwind CSS 的智能客服前端，调用 Coze 工作流实现订单查询、物流跟踪。

## 目录结构

- `src/app/api/chat/route.ts` — Coze 工作流代理路由（Token 只在服务端）
- `src/app/page.tsx` — 整页外壳（居中两栏容器：侧栏 + 聊天区）
- `src/components/chat/chat-window.tsx` — 聊天窗口（流式渲染 / 气泡分组 / Interrupt 恢复 / 未查到 fallback / 转人工卡片 / 复制 / 停止生成）
- `src/components/chat/quick-questions.tsx` — 侧栏「常见问题快捷入口」，点击直接作为用户消息发送
- `src/lib/chat-session.ts` — 单会话状态 + localStorage 持久化（`useSyncExternalStore` 外部 store）
- `src/lib/coze-stream.ts` — 共享类型与 SSE 解析工具
- `src/lib/utils.ts` — clsx 封装的 `cn()`
- `scripts/dev.mjs`、`scripts/start.mjs` — 端口读取脚本

## 环境变量（`.env.local`）

- `COZE_PAT`、`COZE_WORKFLOW_ID`、`COZE_INPUT_KEY`（默认 `input`）、`DEPLOY_RUN_PORT`

## 约定

- 端口禁止硬编码，一律通过 `DEPLOY_RUN_PORT` 读取。
- 颜色 / 字体 / 圆角 / 阴影使用 `src/app/globals.css` 中的 CSS 变量，不在组件里写死。
- JSX 渲染逻辑中禁止使用 `Math.random()` / `Date.now()`；消息 key 用 `nextKey()`（`src/lib/chat-session.ts`）生成。
- 校验命令：`pnpm ts-check`、`pnpm lint`、`pnpm build`。

## 交互设计约定

- **单会话**：这是 C 端单商家用户端，只保留一通对话，**不做多会话列表**。刷新不丢由 `src/lib/chat-session.ts` 写入 localStorage（key `kefu:conversation:v1`）；从本地恢复时 key 计数器会自动接续，避免重复 key。
- **转人工**：工作流通过意图识别节点输出带「转接人工客服」字样的普通 `Message` 文本，前端按关键词在**气泡累计全文**后识别（不逐 chunk 匹配，避免关键词被流式分片切断），并在气泡下方插入卡片。只匹配「明确转接」措辞（转接人工 / 为您转接 / 正在为您接入 / 已转接人工），**不匹配**「如有疑问，请联系人工客服」这类通用结尾语。
- **快捷问题**：`src/components/chat/quick-questions.tsx` 的 `QUICK_GROUPS` 文案需能被工作流的意图识别节点命中；调整工作流后同步修改该常量。

## 本地启动

```bash
cd d:\AI\kefu
pnpm dev
```

- 启动后打开 `http://localhost:3000`（端口取自 `.env.local` 的 `DEPLOY_RUN_PORT`，要换端口改这里即可）。
- `localhost:3000` 不是常驻网站：**必须先跑起 dev server，再打开浏览器**，否则打不开。
- 新机器首次运行先执行 `pnpm install`；`.env.local` 必须存在（内含 Coze 配置），否则 `/api/chat` 会报错。
- 改代码会自动热更新，无需重启；终端里按 `Ctrl+C` 停止。

## Coze API 要点

- 无 `eventId` → `POST /v1/workflow/stream_run`，body: `{ workflow_id, parameters }`
- 有 `eventId` → `POST /v1/workflow/stream_resume`，body: `{ workflow_id, event_id, interrupt_type, resume_data }`
- SSE 事件：`Message` / `Error` / `Done` / `Interrupt` / `PING`；中断信息在 `data.interrupt_data.event_id` 与 `.type`。

## 部署与发布

线上部署在 **EdgeOne Pages**（腾讯云），已构建成功、对话可正常使用。

- 关联方式：GitHub 仓库 `qinglan900/WQF` + `main` 分支，控制台**根目录设为 `./kefu`**（项目在仓库的子目录里）
- `edgeone.json`：本目录下已有，声明 `installCommand: pnpm install`、`buildCommand: pnpm run build`、`nodeVersion: 22.21.1`。
  必须用 `pnpm run build` 而非裸 `next build`——后者在构建机上不在 PATH，会报 `next: command not found`（exit 127）。
- 环境变量在 EdgeOne 控制台配置（`COZE_PAT` / `COZE_WORKFLOW_ID` / `COZE_INPUT_KEY`），不写入代码。
- 访问地址：见 EdgeOne 控制台的生产/预览域名。
- 备用线路：Vercel 项目 `kefu-sigma.vercel.app`（国内直连不稳定，仅作海外备用）。

### 本地与仓库的关系（重要）

- `d:\AI\kefu` 是**独立 git 仓库，未配置 remote**，与 GitHub 上的 `WQF/kefu` 是两份独立副本，没有自动同步。
- 因此**本地改代码不会影响线上**：`pnpm dev` 本地调试即可，不 push 就完全不涉及部署。
- 需要发布时，把改动文件同步到 WQF 的克隆目录的 `kefu/` 子目录下再推送，会触发 EdgeOne 自动构建。

### 已知干扰（可忽略）

仓库 `WQF` 里 `red_book/export.bat` 会每天向 `main` 推送数据，同样会触发本项目的重建。实测构建产物一致、无副作用；免费额度 500 次/月，实际约 30 次/月，无需处理。若要彻底隔离，可拆分独立仓库。

