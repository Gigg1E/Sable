import type { ProviderConfig } from '../settings.js';
import { httpError, readLines, safeToolId, type ChatMessage, type ChatRequest, type LlmProvider, type StreamPart, type ToolCall } from './types.js';

/** OpenAI Chat Completions — also used for llama.cpp's server, LM Studio, vLLM and other compatible APIs. */
function toOpenAI(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant')
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) }
          : {}),
      });
    else out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

export function openaiProvider(cfg: ProviderConfig): LlmProvider {
  const defaultBase = cfg.type === 'openai' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:8080/v1';
  const base = (cfg.baseUrl || defaultBase).replace(/\/+$/, '');
  const label = cfg.name || cfg.type;
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  });

  async function* chat(req: ChatRequest): AsyncGenerator<StreamPart> {
    if (cfg.type === 'openai' && !cfg.apiKey) throw new Error('OpenAI needs an API key — add it in Settings → Models.');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages: toOpenAI(req.system, req.messages),
        ...(req.tools.length
          ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
        ...(cfg.type === 'openai' && req.effort ? { reasoning_effort: req.effort === 'xhigh' || req.effort === 'max' ? 'high' : req.effort } : {}),
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw await httpError(res, label);

    let content = '';
    let thinking = '';
    let stopReason: string | undefined;
    const partial = new Map<number, { id?: string; name: string; args: string }>();
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data);
      if (chunk.error) throw new Error(`${label}: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        thinking += reasoning;
        yield { type: 'thinking', text: reasoning };
      }
      if (delta.content) {
        content += delta.content;
        yield { type: 'text', text: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? partial.size;
        const cur = partial.get(idx) ?? { name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(idx, cur);
      }
      if (choice.finish_reason) stopReason = choice.finish_reason;
    }
    const toolCalls: ToolCall[] = [...partial.values()].map((p, i) => {
      let args: Record<string, unknown> = {};
      try {
        args = p.args ? JSON.parse(p.args) : {};
      } catch {
        args = { __invalid_json: p.args };
      }
      return { id: safeToolId(p.id, i), name: p.name, args };
    });
    if (stopReason === 'length' && toolCalls.length) throw new Error('The model ran out of output tokens in the middle of a tool call.');
    yield {
      type: 'done',
      stopReason,
      message: { role: 'assistant', content, thinking: thinking || undefined, toolCalls: toolCalls.length ? toolCalls : undefined },
    };
  }

  return {
    chat,
    async listModels() {
      const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw await httpError(res, label);
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data ?? []).map((m) => m.id).sort();
    },
  };
}
