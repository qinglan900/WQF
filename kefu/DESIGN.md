# DESIGN.md — 智能客服前端设计说明

## 1. 设计目标

为「订单查询 / 物流跟踪」客服场景提供一个单页对话界面，视觉风格为**商务青蓝（cyan）**，强调大圆角、柔和阴影（bento）、清晰的信息层级。所有设计令牌集中在 CSS 变量中，组件不出现硬编码颜色/圆角/字体。

## 2. 设计令牌（`src/app/globals.css`）

### 颜色

| 变量 | 取值 | 用途 |
|---|---|---|
| `--color-primary` | `#0891b2` (cyan-600) | 主色：头部、按钮、用户气泡 |
| `--color-primary-hover` | `#0e7490` | 按钮 hover |
| `--color-primary-soft` | `#ecfeff` | 浅色强调背景 |
| `--color-on-primary` | `#ffffff` | 主色上的文字 |
| `--color-bg` | `#f6fafb` | 页面底色（微青灰） |
| `--color-surface` | `#ffffff` | 卡片/气泡表面 |
| `--color-fg` | `#164e63` (cyan-900) | 正文（深色贴合青蓝主题） |
| `--color-muted` | `#64748b` | 次要文字、节点标签 |
| `--color-border` | `#e2e8f0` | 描边 |
| `--color-warn` / `--color-warn-soft` | amber 系 | 错误与 fallback 提示 |

### 圆角

- `--radius-lg: 20px`：卡片、气泡（大圆角，气泡靠用户侧收小形成方向感）
- `--radius-md: 12px`：输入框、按钮

### 阴影（bento）

`--shadow-bento`：三层叠加的浅色柔和阴影（青色调 low-opacity），营造悬浮卡片质感。

### 字体

- `--font-business`：衬线商务字体栈（思源宋体 / Noto Serif SC / SimSun / Georgia），用于标题
- `--font-body`：无衬线正文栈（苹方 / 微软雅黑），用于消息与输入

## 3. 布局结构

```
居中画布 (max-w 520px, 高度 min(720px,90vh))
└── ChatWindow 卡片（圆角 lg + bento 阴影 + 边框）
    ├── header   主色渐变感头部：头像图标 + 标题 + 副标题
    ├── messages 滚动区（bg），消息气泡纵向排列
    └── footer   输入区：textarea + 发送按钮
```

## 4. 消息气泡规则

- **用户气泡**：右对齐，主色底 + 白字，右下收小圆角
- **客服气泡**：左对齐，白底 + 边框，左上收小圆角；顶部显示 `node_title` 小标签（来自 Coze 工作流节点名）
- **警告气泡**：amber 软底 + 警告图标，用于 Error 事件与「未查询到」fallback
- **加载态**：底部「正在思考…」胶囊（Loader2 旋转图标）

## 5. 交互约定

- Enter 发送、Shift+Enter 换行；发送中禁用按钮
- 流式渲染：SSE 帧逐条到达即追加到对应气泡
- 多气泡分组：同一轮内按 `node_title + loop_index` 分组，每组一个气泡
- 中断（Interrupt）：下一次输入自动作为 `resume_data` 恢复工作流
- 自动聚焦输入框、自动滚动到底部（均在 `useEffect` 中执行，符合渲染无副作用约束）

## 6. 数据流

```
ChatWindow ──POST /api/chat {message, eventId?, interruptType?}──▶ route.ts
route.ts ──stream_run / stream_resume──▶ api.coze.cn
route.ts ◀──SSE(Message/Error/Done/Interrupt/PING)──
route.ts ──统一帧 {type:'meta'|'coze_event'|'error'}──▶ ChatWindow 解析渲染
```
