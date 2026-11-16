import type { JsonSchema, ToolSpec } from '../../llm/types.js';
import type { Policy } from '../../settings.js';

export interface ToolContext {
  runId: string;
  conversationId: string;
  /** The tool call being executed. */
  callId: string;
  /** Display name of the agent making the call (main agent or a sub-agent). */
  agent: string;
  signal: AbortSignal;
  /** The verified preview the user approved (for tools with a preview). */
  approved?: ToolPreview;
  /** Stream progress lines to the UI while a long tool runs. */
  progress?: (text: string, kind?: 'text' | 'tool') => void;
}

/** Structured UI card built from real tool data (never from model text). */
export interface Card {
  type: string;
  [key: string]: unknown;
}

/** What a tool returns: plain text for the model, optionally with verified cards for the UI. */
export type ToolResult = string | { content: string; cards?: Card[] };

export interface ToolPreview {
  /** Overrides the approval summary. */
  summary?: string;
  /** Verified card shown in the approval (e.g. the exact checkout). */
  card?: Card;
  /** If set, the call is refused with this message and the user is not asked. */
  refuse?: string;
  /** Cards to show even when refusing (e.g. "finish checkout on the store"). */
  cards?: Card[];
}

export interface ToolScope {
  kind: 'domain';
  value: string;
}

export interface ToolDef {
  name: string;
  /** Short human label for the UI. */
  label: string;
  description: string;
  parameters: JsonSchema;
  risk: 'low' | 'medium' | 'high';
  defaultPolicy: Policy;
  group: string;
  source?: 'builtin' | 'mcp';
  /** One-line, human-readable summary of a call (shown in approvals and the activity log). */
  summarize?: (args: Record<string, any>) => string;
  /** Resource the call touches, used for scoped approvals ("always allow this domain"). */
  scope?: (args: Record<string, any>) => ToolScope | undefined;
  /** Always ask the user, regardless of policy; "Always allow" is not offered. */
  alwaysAsk?: boolean;
  /** Build a verified preview before asking (fetches real data server-side). */
  preview?: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolPreview>;
  run: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

const tools = new Map<string, ToolDef>();

export function registerTool(def: ToolDef) {
  tools.set(def.name, { source: 'builtin', ...def });
}
export function unregisterWhere(pred: (t: ToolDef) => boolean) {
  for (const [name, t] of tools) if (pred(t)) tools.delete(name);
}
export function getTool(name: string) {
  return tools.get(name);
}
export function listTools(): ToolDef[] {
  return [...tools.values()];
}
export function toSpec(t: ToolDef): ToolSpec {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/** Light validation of model-produced arguments against the tool's schema. */
export function validateArgs(t: ToolDef, args: Record<string, unknown>): string | null {
  if (args && typeof args === 'object' && '__invalid_json' in args) return 'Arguments were not valid JSON.';
  for (const key of t.parameters.required ?? []) {
    if (args?.[key] === undefined || args[key] === null) return `Missing required argument "${key}".`;
  }
  for (const [key, schema] of Object.entries(t.parameters.properties)) {
    const v = args?.[key];
    if (v === undefined) continue;
    const type = (schema as { type?: string }).type;
    const ok =
      !type ||
      (type === 'string' && typeof v === 'string') ||
      ((type === 'number' || type === 'integer') && typeof v === 'number') ||
      (type === 'boolean' && typeof v === 'boolean') ||
      (type === 'array' && Array.isArray(v)) ||
      (type === 'object' && typeof v === 'object' && !Array.isArray(v));
    if (!ok) return `Argument "${key}" should be ${type}.`;
  }
  return null;
}
