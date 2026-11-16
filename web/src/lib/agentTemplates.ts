import type { AgentProfile } from './types';

/**
 * Purpose-built sub-agent presets. Each suggests a local Ollama model that suits the job;
 * everything is editable after adding. Models are suggestions: anything that supports
 * tool calling works (writers without tools can use any model).
 */
export interface AgentTemplate {
  id: string;
  name: string;
  icon: 'code' | 'search' | 'pen' | 'chart' | 'map' | 'zap';
  blurb: string;
  model: string;
  alternatives: string[];
  profile: Omit<AgentProfile, 'id' | 'providerId' | 'model' | 'enabled'>;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'local-coder',
    name: 'Coder',
    icon: 'code',
    blurb: 'Writes and runs scripts, edits workspace files.',
    model: 'qwen2.5-coder:7b',
    alternatives: ['qwen3-coder:30b', 'qwen2.5-coder:14b', 'devstral:24b'],
    profile: {
      name: 'Coder',
      description: 'Writes, runs and debugs scripts (Python, Node, Bash) and edits files in the workspace. Use for programming, data processing, file conversions and automation.',
      tools: ['file_list', 'file_read', 'file_write', 'run_script'],
      maxSteps: 16,
      temperature: 0.2,
      contextLength: 16384,
      systemPrompt: 'Write small, correct, well-commented code. Run it to verify before you report back. Include the final script path and the output in your answer.',
    },
  },
  {
    id: 'local-researcher',
    name: 'Researcher',
    icon: 'search',
    blurb: 'Searches the web, reads sources, cites them.',
    model: 'qwen3:8b',
    alternatives: ['qwen3:14b', 'llama3.1:8b', 'gpt-oss:20b'],
    profile: {
      name: 'Researcher',
      description: 'Searches the web, reads several sources and returns a concise, sourced summary. Use for questions that need fresh or factual information, comparisons and prices.',
      tools: ['web_search', 'web_fetch', 'memory_search'],
      maxSteps: 12,
      temperature: 0.3,
      contextLength: 32768,
      systemPrompt: 'Check at least two sources for important facts. End with a "Sources" list of URLs. Say clearly when sources disagree or information may be out of date.',
    },
  },
  {
    id: 'local-writer',
    name: 'Writer',
    icon: 'pen',
    blurb: 'Drafts emails, posts and documents in your voice.',
    model: 'llama3.1:8b',
    alternatives: ['mistral-nemo:12b', 'qwen3:14b', 'gemma3:12b'],
    profile: {
      name: 'Writer',
      description: 'Drafts and edits emails, messages, posts and documents. Use for any writing where tone and polish matter.',
      tools: ['memory_search', 'file_write'],
      maxSteps: 6,
      temperature: 0.7,
      contextLength: 16384,
      systemPrompt: 'Match the requested tone and length. Prefer plain, warm language. Return the finished text, then up to two one-line alternatives for the opening if useful.',
    },
  },
  {
    id: 'local-analyst',
    name: 'Analyst',
    icon: 'chart',
    blurb: 'Crunches numbers and data files with scripts.',
    model: 'qwen3:14b',
    alternatives: ['qwen3:8b', 'qwen2.5-coder:14b', 'gpt-oss:20b'],
    profile: {
      name: 'Analyst',
      description: 'Analyzes data (CSV, JSON, numbers) by writing and running Python, and explains the results. Use for budgets, statistics, comparisons and charts.',
      tools: ['file_list', 'file_read', 'file_write', 'run_script'],
      maxSteps: 14,
      temperature: 0.2,
      contextLength: 16384,
      systemPrompt: 'Compute with code instead of mental math. Show key numbers in a small table and state your assumptions.',
    },
  },
  {
    id: 'local-planner',
    name: 'Planner',
    icon: 'map',
    blurb: 'Breaks big jobs into goals, steps and routines.',
    model: 'qwen3:8b',
    alternatives: ['qwen3:14b', 'llama3.1:8b'],
    profile: {
      name: 'Planner',
      description: 'Turns a vague or large objective into a concrete plan: goals with ordered steps, and routines for anything recurring. Use for trips, projects, events and habits.',
      tools: ['goal_create', 'goal_update', 'goal_list', 'schedule_list', 'memory_search', 'web_search'],
      maxSteps: 10,
      temperature: 0.4,
      contextLength: 16384,
    },
  },
  {
    id: 'local-summarizer',
    name: 'Summarizer',
    icon: 'zap',
    blurb: 'Fast, small model for digests and quick reads.',
    model: 'llama3.2:3b',
    alternatives: ['qwen3:4b', 'gemma3:4b', 'phi4-mini'],
    profile: {
      name: 'Summarizer',
      description: 'Quickly summarizes long text, web pages or files into short bullet points. Use for digests and "what does this say" questions.',
      tools: ['web_fetch', 'file_read'],
      maxSteps: 4,
      temperature: 0.2,
      contextLength: 32768,
      systemPrompt: 'Be brief: 3–7 bullets, most important first.',
    },
  },
];
