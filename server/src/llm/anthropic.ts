import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig } from '../settings.js';
import type { ChatMessage, ChatRequest, LlmProvider, StreamPart, ToolCall } from './types.js';

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type Param = Anthropic.Beta.Messages.BetaMessageParam;

/** Models that take adaptive thinking + `output_config.effort`. */
const ADAPTIVE = /^claude-(fable|mythos|opus|sonnet|haiku)-(5|4-[6-9])/;
/** Models where Anthropic recommends server-side refusal fallbacks. */
const FALLBACK_MODELS = /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/;

function toAnthropic(messages: ChatMessage[], model: string, allowRaw: boolean): Param[] {
  const out: Param[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) (last.content as Block[]).push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      const images: Block[] = (m.images ?? []).map((i) => ({
        type: 'image',
        source: { type: 'base64', media_type: i.mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: i.data },
      }));
      push('user', [...images, { type: 'text', text: m.content || (images.length ? 'See the attached image.' : '(empty message)') }]);
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '(no output)', is_error: m.isError || undefined }]);
    } else {
      // Replay Claude's own blocks unchanged (thinking stays valid); convert anything else.
      if (allowRaw && m.raw && m.rawModel === model && Array.isArray(m.raw)) {
        push('assistant', m.raw as Block[]);
        continue;
      }
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const t of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args });
      if (!blocks.length) blocks.push({ type: 'text', text: '(no response)' });
      push('assistant', blocks);
    }
  }
  return out;
}

export function anthropicProvider(cfg: ProviderConfig): LlmProvider {
  const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = () => {
    if (!apiKey) throw new Error('Claude needs an API key — add it in Settings → Models.');
    return new Anthropic({ apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) });
  };

  return {
    async *chat(req: ChatRequest): AsyncGenerator<StreamPart> {
      const adaptive = ADAPTIVE.test(req.model);
      const fallbacks = FALLBACK_MODELS.test(req.model) && (cfg as ProviderConfig & { serverFallbacks?: boolean }).serverFallbacks !== false;
      const stream = client().beta.messages.stream(
        {
          model: req.model,
          max_tokens: 32000,
          system: req.system,
          messages: toAnthropic(req.messages, req.model, !req.historyTrimmed),
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
            eager_input_streaming: true,
          })),
          ...(adaptive ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
          ...(adaptive && req.effort ? { output_config: { effort: req.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } } : {}),
          ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
          else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', text: event.delta.thinking };
        }
      }
      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        yield { type: 'notice', text: 'Claude declined this request.' };
      }
      const toolCalls: ToolCall[] = [];
      let text = '';
      let thinking = '';
      for (const block of message.content) {
        if (block.type === 'text') text += block.text;
        else if (block.type === 'thinking') thinking += block.thinking;
        else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
      }
      if (message.stop_reason === 'max_tokens' && toolCalls.length) {
        throw new Error('Claude ran out of output tokens in the middle of a tool call.');
      }
      yield {
        type: 'done',
        stopReason: message.stop_reason ?? undefined,
        message: {
          role: 'assistant',
          content: text,
          thinking: thinking || undefined,
          // Never run tools from a refused turn: the input may be cut off.
          toolCalls: message.stop_reason !== 'refusal' && toolCalls.length ? toolCalls : undefined,
          raw: message.content,
          rawModel: req.model,
        },
      };
    },
    async listModels() {
      const ids: string[] = [];
      for await (const m of client().models.list({ limit: 100 })) ids.push(m.id);
      return ids;
    },
  };
}
