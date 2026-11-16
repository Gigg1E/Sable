import type { ProviderConfig } from '../settings.js';
import { httpError, readLines, safeToolId, type ChatMessage, type ChatRequest, type LlmProvider, type StreamPart, type ToolCall } from './types.js';

function toOllama(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant')
      out.push({
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ function: { name: t.name, arguments: t.args } })) } : {}),
      });
    else out.push({ role: 'tool', content: m.content, tool_name: m.name });
  }
  return out;
}

export function ollamaProvider(cfg: ProviderConfig): LlmProvider {
  const base = (cfg.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

  async function* chat(req: ChatRequest, withTools = true): AsyncGenerator<StreamPart> {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages: toOllama(req.system, req.messages),
        ...(withTools && req.tools.length
          ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
        stream: true,
        ...(req.temperature != null || req.contextLength
          ? { options: { ...(req.temperature != null ? { temperature: req.temperature } : {}), ...(req.contextLength ? { num_ctx: req.contextLength } : {}) } }
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const err = await httpError(res, 'Ollama');
      if (withTools && /does not support tools/i.test(err.message)) {
        yield { type: 'notice', text: `${req.model} can't call tools, so it's answering without them. Pick a tool-capable model (e.g. qwen3, llama3.1, mistral-nemo) for full agent abilities.` };
        yield* chat(req, false);
        return;
      }
      throw err;
    }
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
      const msg = chunk.message ?? {};
      if (msg.thinking) {
        thinking += msg.thinking;
        yield { type: 'thinking', text: msg.thinking };
      }
      if (msg.content) {
        content += msg.content;
        yield { type: 'text', text: msg.content };
      }
      for (const tc of msg.tool_calls ?? []) {
        let args = tc.function?.arguments ?? {};
        if (typeof args === 'string') args = JSON.parse(args || '{}');
        toolCalls.push({ id: safeToolId(tc.id, toolCalls.length), name: tc.function?.name, args });
      }
      if (chunk.done) {
        yield {
          type: 'done',
          stopReason: chunk.done_reason,
          message: { role: 'assistant', content, thinking: thinking || undefined, toolCalls: toolCalls.length ? toolCalls : undefined },
        };
        return;
      }
    }
    yield { type: 'done', message: { role: 'assistant', content, thinking: thinking || undefined, toolCalls: toolCalls.length ? toolCalls : undefined } };
  }

  return {
    chat: (req) => chat(req),
    async listModels() {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw await httpError(res, 'Ollama');
      const data = (await res.json()) as { models?: { name: string }[] };
      return (data.models ?? []).map((m) => m.name).sort();
    },
  };
}
