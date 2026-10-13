'use client';

// 智能客服聊天窗口
// - 流式渲染：fetch + body.getReader() 逐帧解析统一 SSE 格式
// - 多气泡分组：按 node_title + loop_index 分组 Message 事件
// - Interrupt 处理：记录 event_id / interrupt_type 到 pendingResume，下次发送时携带
// - 未查到 fallback：输入像订单号/手机号但工作流无订单结果时提示
// - 单会话持久化：消息与 pendingResume 存 localStorage（C 端单商家，不做多会话列表）
// - 转人工卡片：气泡累计全文后识别「明确转接」措辞，在气泡下方插入卡片
// - 可停止生成：发送中可通过 AbortController 中断

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Headset, Loader2, Menu, Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import QuickQuestions from '@/components/chat/quick-questions';
import {
  getServerSnapshot,
  getSnapshot,
  nextKey,
  resetSession,
  subscribe,
  updateMessages,
  updatePendingResume,
} from '@/lib/chat-session';
import {
  type CozeEvent,
  type CozeInterruptData,
  type CozeMessageData,
  type StreamFrame,
  parseSseBlock,
  resolveLoopIndex,
  splitSseBlocks,
} from '@/lib/coze-stream';

const ORDER_OR_PHONE_RE = /(\d{11}|[A-Za-z]{0,3}\d{8,})/;
const ORDER_RESULT_RE = /(订单|物流|快递|运单|发货|签收|状态|单号|order|tracking|logistics)/i;
// 仅匹配「明确转接」措辞；不含「如有疑问，请联系人工客服」这类通用结尾语，避免误报
const TRANSFER_RE = /(转接人工|为您转接|正在为您接入|已转接人工|转人工客服)/;

interface TurnCollector {
  hasOrderResult: boolean;
  /** 每个气泡已累计的全文，用于流结束后做整体匹配（避免关键词被分片切断） */
  textByKey: Map<string, string>;
}

export default function ChatWindow() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const messages = session.messages;
  const pendingResume = session.pendingResume;

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 滚动到底部放在 effect 中，避免在渲染逻辑里做副作用
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const appendOrUpdateBotBubble = useCallback(
    (groupKey: string, nodeTitle: string, chunk: string) => {
      updateMessages((prev) => {
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
    (evt: CozeEvent, groupKeys: Map<string, string>, collector: TurnCollector) => {
      if (evt.event === 'Message') {
        const data = (evt.data ?? {}) as CozeMessageData;
        const nodeTitle = data.node_title ?? '';
        const loopIndex = resolveLoopIndex(data);
        const groupKey = `g:${nodeTitle}:${loopIndex}`;
        let assigned = groupKeys.get(groupKey);
        if (!assigned) {
          assigned = nextKey();
          groupKeys.set(groupKey, assigned);
          collector.textByKey.set(assigned, '');
        }
        const content = data.content ?? '';
        if (content) {
          // 累计整段文本后再判断，避免关键词/正则被流式分片切断
          const full = (collector.textByKey.get(assigned) ?? '') + content;
          collector.textByKey.set(assigned, full);
          if (ORDER_RESULT_RE.test(full)) collector.hasOrderResult = true;
          appendOrUpdateBotBubble(assigned, nodeTitle, content);
        }
        return;
      }
      if (evt.event === 'Interrupt') {
        const data = (evt.data ?? {}) as CozeInterruptData;
        const eventId = data.interrupt_data?.event_id;
        const interruptType = data.interrupt_data?.type ?? 2;
        if (eventId) updatePendingResume({ eventId, interruptType });
        return;
      }
      if (evt.event === 'Error') {
        const data = (evt.data ?? {}) as { error_message?: string };
        const msg = data.error_message || '工作流执行出错';
        updateMessages((prev) => [
          ...prev,
          { key: nextKey(), role: 'bot', content: msg, tone: 'warn' },
        ]);
      }
    },
    [appendOrUpdateBotBubble],
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || loading) return;

      const resume = pendingResume;
      updateMessages((prev) => [...prev, { key: nextKey(), role: 'user', content: text }]);
      setInput('');
      setLoading(true);
      setSidebarOpen(false);

      const groupKeys = new Map<string, string>();
      const collector: TurnCollector = { hasOrderResult: false, textByKey: new Map() };
      const looksLikeOrder = ORDER_OR_PHONE_RE.test(text);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
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
              updateMessages((prev) => [
                ...prev,
                { key: nextKey(), role: 'bot', content: frame.data.message, tone: 'warn' },
              ]);
            }
          }
        }

        // 消费掉本次使用的 resume，避免重复恢复
        if (resume) updatePendingResume(null);

        // 转人工识别：对每个气泡的累计全文整体匹配一次
        const transferKeys = [...collector.textByKey.entries()]
          .filter(([, full]) => TRANSFER_RE.test(full))
          .map(([key]) => key);
        if (transferKeys.length > 0) {
          updateMessages((prev) =>
            prev.map((m) => (transferKeys.includes(m.key) ? { ...m, showTransfer: true } : m)),
          );
        }

        // 未查到 fallback：用户输入像订单号/手机号，但本轮 bot 没有任何订单结果
        if (looksLikeOrder && !collector.hasOrderResult && groupKeys.size === 0) {
          updateMessages((prev) => [
            ...prev,
            { key: nextKey(), role: 'bot', content: '未查询到，请检查手机号或快递号', tone: 'warn' },
          ]);
        }
      } catch (e) {
        // 用户主动停止时不报错，保留已生成内容
        if (!controller.signal.aborted) {
          const msg = e instanceof Error ? e.message : String(e);
          updateMessages((prev) => [...prev, { key: nextKey(), role: 'bot', content: msg, tone: 'warn' }]);
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [input, loading, pendingResume, handleCozeEvent],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleQuickPick = useCallback(
    (prompt: string) => {
      setSidebarOpen(false);
      void send(prompt);
    },
    [send],
  );

  const handleClear = useCallback(() => {
    resetSession();
    setSidebarOpen(false);
  }, []);

  const handleTransfer = useCallback((key: string) => {
    updateMessages((prev) => [
      ...prev.map((m) => (m.key === key ? { ...m, showTransfer: false } : m)),
      { key: nextKey(), role: 'bot', content: '已为您记录需求，人工客服会尽快与您联系。' },
    ]);
  }, []);

  const copyMessage = useCallback((key: string, content: string) => {
    // 立即给出反馈，不依赖剪贴板 Promise（无权限/非安全上下文时也不会毫无反应）
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(content).catch(() => undefined);
      return;
    }
    // 兜底：clipboard API 不可用时（如非 https/localhost）用临时 textarea 复制
    const helper = document.createElement('textarea');
    helper.value = content;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    document.body.removeChild(helper);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-bento)]">
      {/* 桌面端常驻侧栏 */}
      <aside className="hidden w-[260px] shrink-0 border-r border-[var(--color-border)] md:block">
        <QuickQuestions onPick={handleQuickPick} onClear={handleClear} disabled={loading} />
      </aside>

      {/* 移动端抽屉 */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] max-w-[80%] border-r border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-bento)]">
            <QuickQuestions onPick={handleQuickPick} onClear={handleClear} disabled={loading} />
          </aside>
        </div>
      ) : null}

      {/* 聊天列 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-primary)] px-4 py-4 text-[var(--color-on-primary)]">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开常见问题"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition hover:bg-white/15 md:hidden"
          >
            <Menu size={20} />
          </button>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
            <Headset size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-[var(--font-business)] text-base font-semibold leading-tight">智能客服</h1>
            <p className="truncate text-xs opacity-90">订单查询 · 物流跟踪 · 由 Coze 工作流驱动</p>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-bg)] px-4 py-5">
          {messages.map((m, idx) => (
            <div key={m.key} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'group flex max-w-[80%] flex-col gap-1.5',
                  m.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    'whitespace-pre-wrap break-words rounded-[var(--radius-lg)] px-4 py-2.5 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'rounded-br-sm bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                      : 'rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]',
                    m.role === 'bot' && m.tone === 'warn' && 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]',
                  )}
                >
                  {m.role === 'bot' && m.nodeTitle ? (
                    <div className="mb-1 text-[11px] font-medium tracking-wide text-[var(--color-muted)]">
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
                  {m.role === 'bot' && loading && idx === messages.length - 1 ? (
                    <span className="ml-0.5 inline-block animate-pulse text-[var(--color-primary)]">▍</span>
                  ) : null}
                </div>

                {m.role === 'bot' && m.content ? (
                  <button
                    type="button"
                    onClick={() => copyMessage(m.key, m.content)}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] opacity-0 transition hover:text-[var(--color-primary)] focus:opacity-100 group-hover:opacity-100"
                  >
                    {copiedKey === m.key ? (
                      <>
                        <Check size={12} />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        复制
                      </>
                    )}
                  </button>
                ) : null}

                {m.role === 'bot' && m.showTransfer ? (
                  <div className="w-full rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)] p-3">
                    <p className="text-xs text-[var(--color-fg)]">已为您准备人工客服通道</p>
                    <button
                      type="button"
                      onClick={() => handleTransfer(m.key)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] transition hover:bg-[var(--color-primary)] hover:text-[var(--color-on-primary)]"
                    >
                      <Headset size={14} />
                      转接人工客服
                    </button>
                  </div>
                ) : null}
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
          {loading ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-fg)] transition hover:border-[var(--color-warn)]/40 hover:text-[var(--color-warn)]"
            >
              <Square size={14} />
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim()}
              className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-on-primary)] transition hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={16} />
              发送
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}