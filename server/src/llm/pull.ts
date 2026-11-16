import { emit } from '../events.js';
import type { ProviderConfig } from '../settings.js';
import { errorMessage } from '../util.js';
import { readLines } from './types.js';

const active = new Map<string, AbortController>();

/** Download an Ollama model in the background, reporting progress as `model.pull` events. */
export function pullOllamaModel(cfg: ProviderConfig, model: string) {
  const key = `${cfg.id}:${model}`;
  if (active.has(key)) return;
  const controller = new AbortController();
  active.set(key, controller);
  const base = (cfg.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const report = (status: string, extra: Record<string, unknown> = {}) => emit({ type: 'model.pull', providerId: cfg.id, model, status, ...extra });

  void (async () => {
    try {
      report('starting');
      const res = await fetch(`${base}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      let last = 0;
      for await (const line of readLines(res.body)) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        // Throttle progress events to a few per second.
        if (chunk.status === 'success' || Date.now() - last > 300) {
          last = Date.now();
          report(chunk.status === 'success' ? 'success' : 'progress', { detail: chunk.status, completed: chunk.completed ?? 0, total: chunk.total ?? 0 });
        }
      }
    } catch (err) {
      report('error', { error: errorMessage(err) });
    } finally {
      active.delete(key);
    }
  })();
}
