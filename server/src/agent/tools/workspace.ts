import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DIR } from '../../config.js';
import { getSettings } from '../../settings.js';
import { id, truncate } from '../../util.js';
import { registerTool } from './registry.js';

/** Resolve a model-supplied path inside the workspace, refusing anything that escapes it. */
async function safePath(p: string): Promise<string> {
  const root = await fs.realpath(WORKSPACE_DIR);
  const target = path.resolve(root, String(p ?? '.').replace(/^\/+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path is outside the workspace.');
  // Follow symlinks for existing paths so a link can't point outside.
  try {
    const real = await fs.realpath(target);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Path is outside the workspace.');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return target;
}

registerTool({
  name: 'file_list',
  label: 'List files',
  group: 'Workspace',
  description: "List files in the agent's workspace folder (a sandboxed directory on the server).",
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder inside the workspace (default root)' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `List ${a.path || '/'}`,
  async run(a) {
    const dir = await safePath(a.path ?? '.');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .map(async (e) => {
          if (e.isDirectory()) return `${e.name}/`;
          const st = await fs.stat(path.join(dir, e.name));
          return `${e.name}  (${st.size} bytes)`;
        }),
    );
    return lines.length ? lines.join('\n') : '(empty)';
  },
});

registerTool({
  name: 'file_read',
  label: 'Read file',
  group: 'Workspace',
  description: 'Read a text file from the workspace.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Read ${a.path}`,
  async run(a) {
    const text = await fs.readFile(await safePath(a.path), 'utf8');
    return truncate(text, 40_000);
  },
});

registerTool({
  name: 'file_write',
  label: 'Write file',
  group: 'Workspace',
  description: 'Create or overwrite a text file in the workspace (parent folders are created). Set append to add to the end instead.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
    required: ['path', 'content'],
  },
  risk: 'medium',
  defaultPolicy: 'auto',
  summarize: (a) => `${a.append ? 'Append to' : 'Write'} ${a.path}`,
  async run(a) {
    const target = await safePath(a.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (a.append) await fs.appendFile(target, String(a.content));
    else await fs.writeFile(target, String(a.content));
    return `Wrote ${String(a.content).length} characters to ${a.path}.`;
  },
});

registerTool({
  name: 'run_script',
  label: 'Run script',
  group: 'Workspace',
  description:
    'Run a Python, Node.js or Bash script on the server, with the workspace as the working directory. Returns exit code, stdout and stderr. API keys and server secrets are not available to scripts.',
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['python', 'node', 'bash'] },
      code: { type: 'string' },
      timeout_sec: { type: 'integer' },
    },
    required: ['language', 'code'],
  },
  risk: 'high',
  defaultPolicy: 'ask',
  summarize: (a) => `Run ${a.language} script (${String(a.code).split('\n').length} lines)`,
  async run(a, ctx) {
    const cfg = getSettings().scripts;
    if (!cfg.enabled) return 'Script execution is turned off in Settings → Permissions.';
    const lang = a.language as 'python' | 'node' | 'bash';
    const ext = { python: 'py', node: 'mjs', bash: 'sh' }[lang];
    const bin = { python: cfg.python, node: cfg.node, bash: cfg.bash }[lang];
    if (!ext || !bin) return `Unsupported language: ${a.language}`;
    const dir = path.join(WORKSPACE_DIR, '.scripts');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id()}.${ext}`);
    await fs.writeFile(file, String(a.code));
    const timeout = Math.min(Number(a.timeout_sec) || cfg.timeoutSec, 600) * 1000;
    try {
      return await new Promise<string>((resolve) => {
        // A minimal environment: no API keys or other server secrets leak into scripts.
        const child = spawn(bin, [file], {
          cwd: WORKSPACE_DIR,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: WORKSPACE_DIR, LANG: 'C.UTF-8', TZ: process.env.TZ ?? '' },
          signal: ctx.signal,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
          stdout += d;
          ctx.progress?.(String(d));
        });
        child.stderr.on('data', (d) => (stderr += d));
        const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve(`Failed to start ${bin}: ${err.message}`);
        });
        child.on('close', (code, sig) => {
          clearTimeout(timer);
          resolve(
            `exit code: ${code ?? sig}${sig === 'SIGKILL' ? ' (timed out)' : ''}\n\nstdout:\n${truncate(stdout, 15_000) || '(empty)'}\n\nstderr:\n${truncate(stderr, 6_000) || '(empty)'}`,
          );
        });
      });
    } finally {
      await fs.rm(file, { force: true });
    }
  },
});
