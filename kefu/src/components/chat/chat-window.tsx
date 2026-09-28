'use client';

// 智能客服聊天窗口
// - 流式渲染：fetch + body.getReader() 逐帧解析统一 SSE 格式
// - 多气泡分组：按 node_title + loop_index 分组 Message 事件
// - Interrupt 处理：记录 event_id / interrupt_type 到 pendingResume，下次发送时携带
// - 未查到 fallback：输入像订单号/手机号但工作流无订单结果时提示

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Headset, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type CozeEvent,
  type CozeInterruptData,
  type CozeMessageData,
  type StreamFrame,
  parseSseBlock,
  resolveLoopIndex,
  splitSseBlocks,
} from '@/lib/coze-stream';

interface ChatMessage {
  /** 稳定 key；由非渲染逻辑生成，避免在 JSX 中使用随机/时间 */
  key: string;
  role: 'user' | 'bot';
  content: string;
  /** 分组标题（node_title），bot 消息用于分组展示 */
  nodeTitle?: string;
  /** 分组气泡内是否为错误/提示态 */
  tone?: 'normal' | 'warn';
}

interface PendingResume {
  eventId: string;
  interruptType: number;
}

let idSeq = 0;
function nextKey(): string {
  idSeq += 1;
  return `m_${idSeq}`;
}

const ORDER_OR_PHONE_RE = /(\d{11}|[A-Za-z]{0,3}\d{8,})/;
const ORDER_RESULT_RE = /(订单|物流|快递|运单|发货|签收|状态|单号|order|tracking|logistics)/i;

export default function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { key: nextKey(), role: 'bot', content: '您好，我是智能客服。请提供您的订单号或手机号，我可以帮您查询订单与物流。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 客户端守卫：滚动到底部放在 effect 中，避免在渲染逻辑里做副作用
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const appendOrUpdateBotBubble = useCallback(
    (groupKey: string, nodeTitle: string, chunk: string) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.key === groupKey);
        if (idx >= 0) {
          const copy = prev.slice();
          const cur = copy[idx];
          copy[idx] = { ...cur, content: cur.content + chunk, nodeTitle };
          return copy;
        }
        return [
          ...prev,
          { key: groupKey, role: 'bot', content: chunk, nodeTitle, tone: 'normal' },
        ];
      });
    },
    [],
  );

  const handleCozeEvent = useCallback(
    (evt: CozeEvent, groupKeys: Map<string, string>, collector: { hasOrderResult: boolean }) => {
      if (evt.event === 'Message') {
        const data = (evt.data ?? {}) as CozeMessageData;
        const nodeTitle = data.node_title ?? '';
        const loopIndex = resolveLoopIndex(data);
        const groupKey = `g:${nodeTitle}:${loopIndex}`;
        let assigned = groupKeys.get(groupKey);
        if (!assigned) {
          assigned = nextKey();
          groupKeys.set(groupKey, assigned);
        }
        const content = data.content ?? '';
        if (content && ORDER_RESULT_RE.test(content)) collector.hasOrderResult = true;
        if (content) appendOrUpdateBotBubble(assigned, nodeTitle, content);
        return;
      }
      if (evt.event === 'Interrupt') {
        const data = (evt.data ?? {}) as CozeInterruptData;
        const eventId = data.interrupt_data?.event_id;
        const interruptType = data.interrupt_data?.type ?? 2;
        if (eventId) setPendingResume({ eventId, interruptType });
        return;
      }
      if (evt.event === 'Error') {
        const data = (evt.data ?? {}) as { error_message?: string };
        const msg = data.error_message || '工作流执行出错';
        setMessages((prev) => [
          ...prev,
          { key: nextKey(), role: 'bot', content: msg, tone: 'warn' },
        ]);
      }
    },
    [appendOrUpdateBotBubble],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const resume = pendingResume;
    setMessages((prev) => [...prev, { key: nextKey(), role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    const groupKeys = new Map<string, string>();
    const collector = { hasOrderResult: false };
    const looksLikeOrder = ORDER_OR_PHONE_RE.test(text);

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          eventId: resume?.eventId,
          interruptType: resume?.interruptType,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`请求失败 ${resp.status}：${errText}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { blocks, rest } = splitSseBlocks(buffer);
        buffer = rest;
        for (const block of blocks) {
          const { data } = parseSseBlock(block);
          if (!data) continue;
          let frame: StreamFrame;
          try {
            frame = JSON.parse(data) as StreamFrame;
          } catch {
            continue;
          }
          if (frame.type === 'coze_event') {
            handleCozeEvent(frame.data, groupKeys, collector);
          } else if (frame.type === 'error') {
            setMessages((prev) => [
              ...prev,
              { key: nextKey(), role: 'bot', content: frame.data.message, tone: 'warn' },
            ]);
          }
        }
      }

      // 消费掉本次使用的 resume，避免重复恢复
      if (resume) setPendingResume(null);

      // 未查到 fallback：用户输入像订单号/手机号，但本轮 bot 没有任何订单结果
      if (looksLikeOrder && !collector.hasOrderResult && groupKeys.size === 0) {
        setMessages((prev) => [
          ...prev,
          { key: nextKey(), role: 'bot', content: '未查询到，请检查手机号或快递号', tone: 'warn' },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { key: nextKey(), role: 'bot', content: msg, tone: 'warn' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, pendingResume, handleCozeEvent]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-bento)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-primary)] px-5 py-4 text-[var(--color-on-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
          <Headset size={22} />
        </span>
        <div>
          <h1 className="font-[var(--font-business)] text-base font-semibold leading-tight">智能客服</h1>
          <p className="text-xs opacity-90">订单查询 · 物流跟踪 · 由 Coze 工作流驱动</p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-bg)] px-4 py-5">
        {messages.map((m) => (
          <div key={m.key} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] px-4 py-2.5 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'rounded-br-sm bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                  : 'rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]',
                m.role === 'bot' && m.tone === 'warn' && 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]',
              )}
            >
              {m.role === 'bot' && m.nodeTitle ? (
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  {m.nodeTitle}
                </div>
              ) : null}
              {m.tone === 'warn' ? (
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle size={14} className="shrink-0 text-[var(--color-warn)]" />
                  {m.content}
                </span>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
              <Loader2 size={14} className="animate-spin" />
              正在思考…
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex items-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="请输入订单号 / 手机号或问题…"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-on-primary)] transition hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} />
          发送
        </button>
      </footer>
    </div>
  );
}
