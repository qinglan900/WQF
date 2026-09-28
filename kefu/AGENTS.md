<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 智能客服项目说明

基于 Next.js（App Router）+ TypeScript + Tailwind CSS 的智能客服前端，调用 Coze 工作流实现订单查询、物流跟踪。

## 目录结构

- `src/app/api/chat/route.ts` — Coze 工作流代理路由（Token 只在服务端）
- `src/components/chat/chat-window.tsx` — 聊天窗口（流式渲染 / 气泡分组 / Interrupt 恢复 / 未查到 fallback）
- `src/lib/coze-stream.ts` — 共享类型与 SSE 解析工具
- `src/lib/utils.ts` — clsx 封装的 `cn()`
- `scripts/dev.mjs`、`scripts/start.mjs` — 端口读取脚本

## 环境变量（`.env.local`）

- `COZE_PAT`、`COZE_WORKFLOW_ID`、`COZE_INPUT_KEY`（默认 `input`）、`DEPLOY_RUN_PORT`

## 约定

- 端口禁止硬编码，一律通过 `DEPLOY_RUN_PORT` 读取。
- 颜色 / 字体 / 圆角 / 阴影使用 `src/app/globals.css` 中的 CSS 变量，不在组件里写死。
- JSX 渲染逻辑中禁止使用 `Math.random()` / `Date.now()`；消息 key 用模块级自增计数器 `nextKey()` 生成。
- 校验命令：`pnpm ts-check`、`pnpm lint`、`pnpm build`。

## Coze API 要点

- 无 `eventId` → `POST /v1/workflow/stream_run`，body: `{ workflow_id, parameters }`
- 有 `eventId` → `POST /v1/workflow/stream_resume`，body: `{ workflow_id, event_id, interrupt_type, resume_data }`
- SSE 事件：`Message` / `Error` / `Done` / `Interrupt` / `PING`；中断信息在 `data.interrupt_data.event_id` 与 `.type`。

