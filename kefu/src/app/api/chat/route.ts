// Coze 工作流代理路由
// - 无 eventId：POST /v1/workflow/stream_run
// - 有 eventId：POST /v1/workflow/stream_resume
// 将 Coze 原始 SSE 转换为统一帧：{ type: 'meta' | 'coze_event' | 'error', data }
import { NextRequest } from 'next/server';
import {
  type CozeEvent,
  type StreamFrame,
  parseSseBlock,
  splitSseBlocks,
} from '@/lib/coze-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel 部署：SSE 流式回复需要较长执行时间（Hobby 计划上限 60s）
export const maxDuration = 60;

interface ChatRequestBody {
  message?: string;
  eventId?: string;
  interruptType?: number;
}

function sseFrame(frame: StreamFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

function fail(message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const pat = process.env.COZE_PAT;
  const workflowId = process.env.COZE_WORKFLOW_ID;
  const inputKey = process.env.COZE_INPUT_KEY || 'input';

  if (!pat) return fail('服务端缺少 COZE_PAT 配置');
  if (!workflowId) return fail('服务端缺少 COZE_WORKFLOW_ID 配置');

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return fail('请求体不是合法 JSON');
  }

  const message = (body.message ?? '').trim();
  if (!message) return fail('message 不能为空');

  const isResume = Boolean(body.eventId);
  const endpoint = isResume
    ? 'https://api.coze.cn/v1/workflow/stream_resume'
    : 'https://api.coze.cn/v1/workflow/stream_run';

  const payload: Record<string, unknown> = isResume
    ? {
        workflow_id: workflowId,
        event_id: body.eventId,
        interrupt_type: body.interruptType ?? 2,
        resume_data: message,
      }
    : {
        workflow_id: workflowId,
        parameters: { [inputKey]: message },
      };

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return fail(`无法连接 Coze API：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return fail(`Coze API 返回 ${upstream.status}：${text || '无响应体'}`);
  }

  const mode: 'run' | 'resume' = isResume ? 'resume' : 'run';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseFrame({ type: 'meta', data: { workflow_id: workflowId, mode } })));
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { blocks, rest } = splitSseBlocks(buffer);
          buffer = rest;
          for (const block of blocks) {
            const { event, data } = parseSseBlock(block);
            if (!event || event === 'PING') continue;
            let parsed: unknown = null;
            if (data) {
              try {
                parsed = JSON.parse(data) as unknown;
              } catch {
                parsed = data;
              }
            }
            const cozeEvent: CozeEvent = { event, data: parsed as CozeEvent['data'] };
            controller.enqueue(encoder.encode(sseFrame({ type: 'coze_event', data: cozeEvent })));
          }
        }
        // 处理可能残留的最后一个不完整块（通常为空）
        if (buffer.trim()) {
          const { event, data } = parseSseBlock(buffer);
          if (event && event !== 'PING') {
            let parsed: unknown = null;
            if (data) {
              try {
                parsed = JSON.parse(data) as unknown;
              } catch {
                parsed = data;
              }
            }
            controller.enqueue(
              encoder.encode(sseFrame({ type: 'coze_event', data: { event, data: parsed as CozeEvent['data'] } })),
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(sseFrame({ type: 'error', data: { message: msg } })));
      } finally {
        controller.close();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
