// 单会话状态 + 本地持久化（轻量外部 store）
// C 端单商家客服：用户与同一商家只保留一通对话，不做多会话列表。
// 通过 useSyncExternalStore 读取，服务端快照恒定，保证 SSR 与客户端首帧一致（不会 hydration 失配）。

export interface ChatMessage {
  /** 稳定 key；由非渲染逻辑生成，避免在 JSX 中使用随机/时间 */
  key: string;
  role: 'user' | 'bot';
  content: string;
  /** 分组标题（node_title），bot 消息用于分组展示 */
  nodeTitle?: string;
  /** 分组气泡内是否为错误/提示态 */
  tone?: 'normal' | 'warn';
  /** 该气泡是否需要在下方展示「转人工」卡片 */
  showTransfer?: boolean;
}

export interface PendingResume {
  eventId: string;
  interruptType: number;
}

export interface StoredSession {
  version: number;
  messages: ChatMessage[];
  pendingResume: PendingResume | null;
}

const STORAGE_KEY = 'kefu:conversation:v1';
const VERSION = 1;
const WELCOME_TEXT = '您好，我是智能客服。请提供您的订单号或手机号，我可以帮您查询订单与物流。';

let idSeq = 0;

/** 生成稳定唯一 key：模块级自增计数器，禁止使用随机数/时间戳 */
export function nextKey(): string {
  idSeq += 1;
  return `m_${idSeq}`;
}

/** 从已有消息中取出 m_<数字> 的最大序号，供计数器接续，避免恢复后 key 冲突 */
function maxKeySeq(messages: ChatMessage[]): number {
  let max = 0;
  for (const m of messages) {
    const matched = /^m_(\d+)$/.exec(m.key);
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return max;
}

function createWelcome(): ChatMessage {
  return { key: nextKey(), role: 'bot', content: WELCOME_TEXT };
}

function emptySession(): StoredSession {
  return { version: VERSION, messages: [], pendingResume: null };
}

/** 服务端/首帧快照：恒定引用（不含消息），避免 SSR 与客户端首帧不一致 */
const SERVER_SESSION: StoredSession = emptySession();

let cached: StoredSession | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): StoredSession {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed?.version !== VERSION || !Array.isArray(parsed.messages)) return emptySession();
    return {
      version: VERSION,
      messages: parsed.messages,
      pendingResume: parsed.pendingResume ?? null,
    };
  } catch {
    return emptySession();
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** 订阅：供 useSyncExternalStore 使用 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 客户端快照：首次读取时从 localStorage 恢复；无数据则用欢迎语初始化 */
export function getSnapshot(): StoredSession {
  if (cached) return cached;
  if (typeof window === 'undefined') return SERVER_SESSION;
  const stored = readFromStorage();
  if (stored.messages.length === 0) stored.messages = [createWelcome()];
  // 计数器接续本地已有 key，避免恢复后冲突
  idSeq = Math.max(idSeq, maxKeySeq(stored.messages));
  cached = stored;
  return cached;
}

/** 服务端快照 */
export function getServerSnapshot(): StoredSession {
  return SERVER_SESSION;
}

function commit(next: StoredSession): void {
  cached = next;
  emit();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默降级，不影响聊天
  }
}

/** 更新消息列表（函数式更新，语义同 setState） */
export function updateMessages(updater: (prev: ChatMessage[]) => ChatMessage[]): void {
  const cur = getSnapshot();
  commit({ ...cur, messages: updater(cur.messages) });
}

/** 更新未完成的中断态 */
export function updatePendingResume(value: PendingResume | null): void {
  const cur = getSnapshot();
  if (value === null && cur.pendingResume === null) return;
  commit({ ...cur, pendingResume: value });
}

/** 清空对话：重置为仅含欢迎语的新会话 */
export function resetSession(): void {
  cached = { version: VERSION, messages: [createWelcome()], pendingResume: null };
  emit();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}