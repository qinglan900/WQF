'use client';

// 侧栏「常见问题快捷入口」：纯展示组件，点击后把问题文本回传给 ChatWindow 发送。
// 注意：条目文案需能被 Coze 工作流的意图识别节点命中；调整工作流后同步修改此处即可。

import { Search, Truck, MapPin, RotateCcw, Receipt, FileText, Trash2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickQuestion {
  label: string;
  prompt: string;
  icon: LucideIcon;
}

interface QuickGroup {
  title: string;
  items: QuickQuestion[];
}

const QUICK_GROUPS: QuickGroup[] = [
  {
    title: '订单与物流',
    items: [
      { label: '查询我的订单', prompt: '帮我查询我的订单状态', icon: Search },
      { label: '我的快递到哪了', prompt: '我的快递现在到哪了？', icon: Truck },
      { label: '修改收货地址', prompt: '我想修改订单的收货地址', icon: MapPin },
    ],
  },
  {
    title: '售后与发票',
    items: [
      { label: '申请退换货', prompt: '我想申请退换货', icon: RotateCcw },
      { label: '查询退款进度', prompt: '帮我查询退款进度', icon: Receipt },
      { label: '开具发票', prompt: '我需要开具发票', icon: FileText },
    ],
  },
];

interface QuickQuestionsProps {
  /** 点击快捷问题时回传的提问文本 */
  onPick: (prompt: string) => void;
  /** 清空当前对话 */
  onClear: () => void;
  disabled?: boolean;
}

export default function QuickQuestions({ onPick, onClear, disabled }: QuickQuestionsProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] px-4 py-4">
        <h2 className="font-[var(--font-business)] text-sm font-semibold text-[var(--color-fg)]">常见问题</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">点击即可直接提问</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {QUICK_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="px-2 pb-2 text-[11px] font-medium tracking-wide text-[var(--color-muted)]">
              {group.title}
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onPick(item.prompt)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[13px] text-[var(--color-fg)] transition',
                        'hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary)]',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <Icon size={15} className="shrink-0 text-[var(--color-muted)]" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <button
          type="button"
          onClick={onClear}
          className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-warn-soft)] hover:text-[var(--color-warn)]"
        >
          <Trash2 size={14} />
          清空对话
        </button>
      </div>
    </div>
  );
}