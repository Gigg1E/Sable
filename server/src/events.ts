import type { Request, Response } from 'express';

export type SableEvent = { type: string; [key: string]: unknown };

const clients = new Set<Response>();
type Listener = (ev: SableEvent) => void;
const listeners = new Set<Listener>();

/** Broadcast an event to every connected browser and in-process listener. */
export function emit(ev: SableEvent) {
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(payload);
  for (const l of listeners) {
    try {
      l(ev);
    } catch {
      /* listeners must not break the bus */
    }
  }
}

export function onEvent(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function connectedClients() {
  return clients.size;
}

export function sseHandler(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'hello' })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}
