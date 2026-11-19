import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import './agent/tools/personal.js';
import './agent/tools/web.js';
import './agent/tools/present.js';
import './agent/tools/outputs.js';
import './agent/tools/connect.js';
import './agent/tools/graph.js';
import './agent/tools/workspace.js';
import './shop/tools.js';
import { resumeShopLink } from './shop/auth.js';
import { recoverRuns } from './agent/runner.js';
import { expireStaleApprovals } from './agent/sentinel.js';
import { reloadMcp } from './agent/tools/mcp.js';
import { syncCalendarTools } from './agent/tools/calendar.js';
import { syncEmailTools } from './agent/tools/email.js';
import { startHelpers } from './agent/helpers.js';
import { backfillMemoryEmbeddings } from './agent/tools/personal.js';
import { DATA_DIR, HOST, PORT, WEB_DIST } from './config.js';
import { initPush } from './push.js';
import { apiRouter } from './routes.js';
import { hooksRouter } from './agent/hooks.js';
import { startWatchers } from './agent/watchers.js';
import { startScheduler } from './scheduler.js';
import { proxyLabel } from './net.js';
import { getSettings, updateSettings } from './settings.js';

recoverRuns();
expireStaleApprovals();
initPush();
getSettings();

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy, Tailscale serve, nginx) trust its X-Forwarded-* headers for HTTPS detection.
app.set('trust proxy', process.env.SABLE_TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
// Strict defaults for the private app. Space frames override CSP/framing on their own route.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', APP_CSP);
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  // Never let a proxy or the browser cache API responses.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/hooks', hooksRouter());
app.use('/api', apiRouter());

if (fs.existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      index: false,
      setHeaders(res, file) {
        if (file.endsWith('sw.js') || file.endsWith('.webmanifest') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get(/^(?!\/(api|hooks)\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('Sable API is running. Build the web app with `npm run build`, or use `npm run dev` for the dev server.'));
}

// ───────────────────────── Optional public front ─────────────────────────
// A second, minimal listener for the internet: a plain page and inbound webhooks, nothing else.
// The full app stays on the private port (bind it to localhost / Tailscale / a private network).
const PUBLIC_PORT = Number(process.env.SABLE_PUBLIC_PORT ?? 0);
if (PUBLIC_PORT) {
  const front = express();
  front.disable('x-powered-by');
  front.set('trust proxy', process.env.SABLE_TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  const title = (process.env.SABLE_PUBLIC_TITLE ?? 'Hello').replace(/[<>&"]/g, '');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#0f0f11;color:#a0a0a8;font:15px/1.5 system-ui,-apple-system,sans-serif}</style></head><body><p>${title}</p></body></html>`;
  front.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  front.use('/hooks', hooksRouter());
  front.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  front.get('/', (_req, res) => res.type('html').send(page));
  // Everything else looks like nothing is here.
  front.use((_req, res) => res.status(404).type('html').send(page));
  front.listen(PUBLIC_PORT, process.env.SABLE_PUBLIC_HOST ?? '0.0.0.0', () => console.log(`  Public front (page + webhooks only) on port ${PUBLIC_PORT}`));
}

app.listen(PORT, HOST, () => {
  console.log(`\n  Sable is listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Data folder: ${DATA_DIR}`);
  console.log(`  Agent web traffic: ${proxyLabel() ? `via proxy ${proxyLabel()}` : 'direct'}\n`);
  void reloadMcp();
  syncCalendarTools();
  syncEmailTools();
  startHelpers();
  // Reuse the OAuth client from the old Google MCP connector, so Sign in with Google needs no retyping.
  {
    const s = getSettings();
    const old = s.mcpServers.find((m) => (m.preset === 'gmail' || m.preset === 'google-calendar') && m.oauth?.clientId && m.oauth?.clientSecret);
    if (old && !s.google?.clientId) updateSettings({ ...s, google: { clientId: old.oauth!.clientId!, clientSecret: old.oauth!.clientSecret! } });
  }
  setInterval(() => void backfillMemoryEmbeddings(), 10 * 60_000).unref();
  setTimeout(() => void backfillMemoryEmbeddings(), 60_000).unref();
  startScheduler();
  startWatchers();
  resumeShopLink();
});
