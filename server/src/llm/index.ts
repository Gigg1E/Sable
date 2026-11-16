import { getSettings, type ProviderConfig } from '../settings.js';
import { anthropicProvider } from './anthropic.js';
import { ollamaProvider } from './ollama.js';
import { openaiProvider } from './openai.js';
import type { LlmProvider } from './types.js';

export function providerFor(cfg: ProviderConfig): LlmProvider {
  switch (cfg.type) {
    case 'ollama':
      return ollamaProvider(cfg);
    case 'anthropic':
      return anthropicProvider({ ...cfg, serverFallbacks: getSettings().anthropic.serverFallbacks } as ProviderConfig);
    case 'openai':
    case 'llamacpp':
    case 'openai-compatible':
      return openaiProvider(cfg);
  }
}

export function resolveProvider(providerId: string): { cfg: ProviderConfig; llm: LlmProvider } {
  const cfg = getSettings().providers.find((p) => p.id === providerId);
  if (!cfg) throw new Error(`No model provider named "${providerId}". Check Settings → Models.`);
  return { cfg, llm: providerFor(cfg) };
}

/** Use the configured model, or the first one the provider reports when none is chosen yet. */
export async function resolveModel(providerId: string, model: string): Promise<string> {
  if (model) return model;
  const { llm, cfg } = resolveProvider(providerId);
  const models = await llm.listModels().catch(() => []);
  if (!models.length) throw new Error(`No model selected for ${cfg.name}, and none could be listed. Pick one in Settings → Models.`);
  return models[0];
}
