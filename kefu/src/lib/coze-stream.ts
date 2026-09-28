// Coze 工作流流式事件与统一帧格式的共享类型 / 解析工具
// 服务端（route.ts）与客户端（chat-window.tsx）均从此文件导入类型，避免 any

/** Coze stream_run / stream_resume 返回的事件名 */
export type CozeEventName = 'Message' | 'Error' | 'Done' | 'Interrupt' | 'PING' | string;

/** Message 事件的 data 结构 */
export interface CozeMessageData {
  content?: string;
  node_title?: string;
  node_seq_id?: string;
  node_is_finish?: boolean;
  /** 循环节点中的迭代序号，用于气泡分组；部分工作流通过 ext 传递 */
  loop_index?: number;
  ext?: Record<string, string>;
  node_id?: string;
  node_execute_uuid?: string;
  error_code?: number;
  error_message?: string;
}

/** Interrupt 事件的中断内容 */
export interface CozeInterruptPayload {
  event_id?: string;
  type?: number;
  data?: string;
  required_parameters?: Record<string, unknown>;
}

/** Interrupt 事件的 data 结构 */
export interface CozeInterruptData {
  interrupt_data?: CozeInterruptPayload;
  node_title?: string;
}

/** Error 事件的 data 结构 */
export interface CozeErrorData {
  error_code?: number;
  error_message?: string;
}

/** 单条 Coze 事件（解析后） */
export interface CozeEvent {
  id?: number | string;
  event: CozeEventName;
  data: CozeMessageData | CozeInterruptData | CozeErrorData | Record<string, unknown> | null;
}

/** 代理路由向前端透出的统一帧格式 */
export type StreamFrame =
  | { type: 'meta'; data: { workflow_id: string; mode: 'run' | 'resume' } }
  | { type: 'coze_event'; data: CozeEvent }
  | { type: 'error'; data: { message: string } };

/** 从 Message data 中解析 loop_index：优先 data.loop_index，其次 ext.loop_index，最后 0 */
export function resolveLoopIndex(data: CozeMessageData): number {
  if (typeof data.loop_index === 'number') return data.loop_index;
  const fromExt = data.ext?.loop_index;
  if (fromExt != null) {
    const n = Number(fromExt);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/**
 * 将一段 SSE 文本按空行切分为若干事件块，返回已完成的块与未完成的尾部。
 * 适用于 Coze 原始 SSE 与统一帧 SSE 两种格式。
 */
export function splitSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = buffer;
  let idx: number;
  // SSE 事件以空行分隔，兼容 \n\n 与 \r\n\r\n
  while ((idx = rest.search(/\r?\n\r?\n/)) >= 0) {
    const sepLen = rest.slice(idx).startsWith('\r\n\r\n') ? 4 : 2;
    blocks.push(rest.slice(0, idx));
    rest = rest.slice(idx + sepLen);
  }
  return { blocks, rest };
}

/** 解析单个 SSE 事件块，提取 event 名与 data 字符串（多行 data 会被拼接） */
export function parseSseBlock(block: string): { event: string; data: string; id?: string } {
  let event = '';
  let data = '';
  let id: string | undefined;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += (data ? '\n' : '') + line.slice(5).trim();
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    }
  }
  return { event, data, id };
}
