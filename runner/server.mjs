// Sable sandbox runner: runs the agent's scripts in a separate container that can see only the
// workspace (chat folders), never Sable's database, keys or settings.
//
//   POST /run  {"cwd":"chats/<id>","language":"python|node|bash","code":"…","timeoutSec":60}
//   → NDJSON stream: {"type":"out","text":…} … {"type":"exit","code":0,"stdout":…,"stderr":…,"timedOut":false}
//   GET /health → ok
//
// Only Node built-ins, so the image stays small and auditable.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(process.env.RUNNER_WORKSPACE ?? '/workspace');
const TOKEN = process.env.RUNNER_TOKEN ?? '';
const PORT = Number(process.env.RUNNER_PORT ?? 8790);
const MAX_TIMEOUT = 600;
const BINS = { python: 'python3', node: 'node', bash: 'bash' };
const EXT = { python: 'py', node: 'mjs', bash: 'sh' };
const PASS_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'TZ'];

function authorized(req) {
  if (!TOKEN) return true;
  const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method !== 'POST' || req.url !== '/run') return res.writeHead(404).end();
    if (!authorized(req)) return res.writeHead(401).end();
    let job;
    try {
      job = JSON.parse(await readBody(req));
    } catch {
      return res.writeHead(400).end('bad request');
    }
    const lang = job.language;
    if (!BINS[lang] || typeof job.code !== 'string') return res.writeHead(400).end('bad language or code');
    const cwd = path.resolve(ROOT, String(job.cwd ?? '.').replace(/^\/+/, ''));
    if (cwd !== ROOT && !cwd.startsWith(ROOT + path.sep)) return res.writeHead(400).end('cwd outside workspace');
    fs.mkdirSync(cwd, { recursive: true });
    const file = path.join('/tmp', `job-${crypto.randomUUID()}.${EXT[lang]}`);
    fs.writeFileSync(file, job.code);
    const timeout = Math.min(Math.max(Number(job.timeoutSec) || 60, 1), MAX_TIMEOUT) * 1000;
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: path.join(ROOT, '.home'), LANG: 'C.UTF-8', MPLCONFIGDIR: '/tmp/mpl', PYTHONUNBUFFERED: '1' };
    for (const k of PASS_ENV) if (process.env[k]) env[k] = process.env[k];
    fs.mkdirSync(env.HOME, { recursive: true });

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const send = (o) => res.write(JSON.stringify(o) + '\n');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(BINS[lang], [file], { cwd, env });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    req.on('close', () => !res.writableEnded && child.kill('SIGKILL')); // Sable cancelled the run
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > 2_000_000) child.kill('SIGKILL');
      send({ type: 'out', text: String(d) });
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 2_000_000) child.kill('SIGKILL');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      send({ type: 'exit', code: -1, stdout: '', stderr: `Failed to start ${BINS[lang]}: ${err.message}`, timedOut: false });
      res.end();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.rmSync(file, { force: true });
      send({ type: 'exit', code: code ?? signal, stdout: stdout.slice(-200_000), stderr: stderr.slice(-60_000), timedOut });
      res.end();
    });
  })
  .listen(PORT, '0.0.0.0', () => console.log(`sable-runner on :${PORT} (workspace ${ROOT}${TOKEN ? ', token required' : ''})`));
