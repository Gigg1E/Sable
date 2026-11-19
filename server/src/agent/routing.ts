import { cosine, embed, overlap, words } from './helpers.js';
import type { ToolDef } from './tools/registry.js';

/**
 * Tool routing: instead of handing every tool to the model (which makes smaller models pick wrong
 * ones), give it the groups that fit the message, the groups it used recently, a few core tools,
 * and tools_search to load anything else.
 */

export const CORE_TOOLS = new Set(['tools_search', 'memory_save', 'memory_search', 'notify', 'delegate', 'goal_create', 'goal_update']);
const SMALL_INSTALL = 22;

function groups(all: ToolDef[]) {
  const m = new Map<string, ToolDef[]>();
  for (const t of all) m.set(t.group, [...(m.get(t.group) ?? []), t]);
  return m;
}
const groupText = (g: string, tools: ToolDef[]) => `${g}: ${tools.map((t) => `${t.label}. ${t.description.split(/(?<=\.)\s/)[0]}`).join(' ')}`.slice(0, 1800);

export async function selectTools(all: ToolDef[], query: string, recentGroups: Set<string>): Promise<{ tools: ToolDef[]; groups: string[]; method: string }> {
  if (all.length <= SMALL_INSTALL || !query.trim()) return { tools: all, groups: [], method: 'all' };
  const byGroup = groups(all);
  const names = [...byGroup.keys()];
  const chosen = new Set<string>([...recentGroups].filter((g) => byGroup.has(g)));
  let method = 'keywords';
  const vecs = await embed([query, ...names.map((g) => groupText(g, byGroup.get(g)!))]);
  if (vecs) {
    method = 'embeddings';
    const q = vecs[0];
    const scored = names.map((g, i) => ({ g, s: cosine(q, vecs[i + 1]) })).sort((a, b) => b.s - a.s);
    const top = scored[0]?.s ?? 0;
    for (const { g, s } of scored.slice(0, 4)) if (s >= 0.3 && s >= top - 0.08) chosen.add(g);
  }
  // Keywords always count too (names like "email", "calendar", "watcher" are strong signals).
  const qw = words(query);
  const kw = names.map((g) => ({ g, s: overlap(qw, groupText(g, byGroup.get(g)!)) + (qw.has(g.toLowerCase()) ? 3 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  for (const { g } of kw.slice(0, 3)) chosen.add(g);
  if (!chosen.size) return { tools: all, groups: [], method: 'all' };
  const tools = all.filter((t) => chosen.has(t.group) || CORE_TOOLS.has(t.name));
  return { tools, groups: [...chosen], method };
}

/** Best matching tools for an explicit search (tools_search). */
export async function searchTools(all: ToolDef[], query: string, limit = 8): Promise<ToolDef[]> {
  const texts = all.map((t) => `${t.group}: ${t.label}. ${t.description}`.slice(0, 600));
  const vecs = await embed([query, ...texts]);
  const qw = words(query);
  const scored = all.map((t, i) => ({ t, s: (vecs ? cosine(vecs[0], vecs[i + 1]) * 10 : 0) + overlap(qw, texts[i]) + (qw.has(t.group.toLowerCase()) ? 2 : 0) }));
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t);
}
