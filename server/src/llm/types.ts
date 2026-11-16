export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface UserMessage {
  role: 'user';
  content: string;
}
export interface AssistantMessage {
  role: 'assistant';
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  /** Provider-native content blocks, replayed unchanged to the same model (keeps thinking valid). */
  raw?: unknown;
  rawModel?: string;
}
export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}
export type ChatMessage = UserMessage | AssistantMessage | ToolMessage;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  effort?: string;
  /** True when older history was dropped to fit the context budget. */
  historyTrimmed?: boolean;
}

export type StreamPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; message: AssistantMessage; stopReason?: string };

export interface LlmProvider {
  chat(req: ChatRequest): AsyncGenerator<StreamPart>;
  listModels(): Promise<string[]>;
}

/** Read a fetch body as text lines (NDJSON / SSE). */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

export async function httpError(res: Response, label: string): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  return new Error(`${label} returned ${res.status}${detail ? `: ${detail}` : ''}`);
}

export function safeToolId(id: string | undefined, index: number): string {
  const clean = (id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || `call_${Date.now().toString(36)}_${index}`;
}
