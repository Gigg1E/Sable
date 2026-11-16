import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import './agent/tools/personal.js';
import './agent/tools/web.js';
import './agent/tools/workspace.js';
import { recoverRuns } from './agent/runner.js';
import { expireStaleApprovals } from './agent/sentinel.js';
import { reloadMcp } from './agent/tools/mcp.js';
import { DATA_DIR, HOST, PORT, WEB_DIST } from './config.js';
import { initPush } from './push.js';
import { apiRouter } from './routes.js';
import { startScheduler } from './scheduler.js';
import { proxyLabel } from './net.js';
import { getSettings } from './settings.js';

recoverRuns();
expireStaleApprovals();
initPush();
getSettings();

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Caddy, Tailscale serve, nginx) trust its X-Forwarded-* headers for HTTPS detection.
app.set('trust proxy', process.env.SABLE_TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

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
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('Sable API is running. Build the web app with `npm run build`, or use `npm run dev` for the dev server.'));
}

app.listen(PORT, HOST, () => {
  console.log(`\n  Sable is listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Data folder: ${DATA_DIR}`);
  console.log(`  Agent web traffic: ${proxyLabel() ? `via proxy ${proxyLabel()}` : 'direct'}\n`);
  void reloadMcp();
  startScheduler();
});
