import { fmtDay, fmtTime, parseLocal, parts, userTz, wallToUtc } from '../../clock.js';
import ICAL from 'ical.js';
import { agentFetch } from '../../net.js';
import { getSettings, type CalendarFeed } from '../../settings.js';
import { errorMessage, untrusted } from '../../util.js';
import { createGoogleEvent, googleAccounts, googleEventsBetween } from '../../google.js';
import { registerTool, unregisterWhere } from './registry.js';

/**
 * Calendar feeds (iCal / ICS): the "secret address" Google Calendar, Outlook and iCloud publish.
 * No OAuth and no developer program, works with personal accounts, and is read-only by nature:
 * Sable can read events and find free time, but never change a calendar.
 * Feed URLs are secrets (anyone with one can read the calendar), so they are masked in the UI.
 */

export interface CalEvent {
  calendar: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  busy: boolean;
}

const TTL_MS = 5 * 60_000;
const MAX_BYTES = 15_000_000;
const cache = new Map<string, { url: string; at: number; root: ICAL.Component }>();

function feedUrl(url: string) {
  return url.trim().replace(/^webcals?:\/\//i, 'https://');
}

async function loadFeed(feed: CalendarFeed, signal?: AbortSignal, fresh = false): Promise<ICAL.Component> {
  const url = feedUrl(feed.url);
  const hit = cache.get(feed.id);
  if (!fresh && hit && hit.url === url && Date.now() - hit.at < TTL_MS) return hit.root;
  if (!/^https?:\/\//i.test(url)) throw new Error(`${feed.name}: the feed address must start with https:// or webcal://`);
  let res: Response;
  try {
    res = await agentFetch(url, { headers: { Accept: 'text/calendar, */*;q=0.5' } }, signal);
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const why = cause?.code === 'ENOTFOUND' ? 'the address was not found' : cause?.code === 'ECONNREFUSED' ? 'the connection was refused' : /timeout|abort/i.test(String(cause?.message ?? errorMessage(err))) ? 'it took too long to answer' : /SSL|TLS|certificate|wrong version/i.test(String(cause?.message ?? '')) ? 'the secure connection failed' : (cause?.message ?? errorMessage(err)).split('\n')[0].slice(0, 120);
    throw new Error(`${feed.name}: couldn't reach ${new URL(url).host} (${why}). Check the address.`);
  }
  if (!res.ok) throw new Error(`${feed.name}: the calendar server answered ${res.status}${res.status === 404 ? ' (the address may have been reset; copy it again)' : ''}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error(`${feed.name}: feed is too large`);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(`${feed.name}: that address didn't return a calendar (iCal/ICS) file`);
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* ignore broken zones */
    }
  }
  cache.set(feed.id, { url, at: Date.now(), root });
  return root;
}

function clean(s: unknown, max = 300): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** Expand every event (including repeats and their exceptions) that overlaps [from, to). */
export function expandEvents(root: ICAL.Component, calendar: string, from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid ?? `${masters.size}`, ev);
  }
  for (const ex of exceptions) {
    const m = ex.uid ? masters.get(ex.uid) : undefined;
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}-${masters.size}`, ex);
  }
  const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    const status = String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'CANCELLED') return;
    const s = start.toJSDate();
    let e = end ? end.toJSDate() : s;
    if (start.isDate && e <= s) e = new Date(s.getTime() + 86_400_000);
    if (e <= from || s >= to) return;
    const transp = String(item.component.getFirstPropertyValue('transp') ?? '').toUpperCase();
    out.push({
      calendar,
      title: clean(item.summary, 200) ?? '(no title)',
      start: s,
      end: e,
      allDay: start.isDate,
      location: clean(item.location, 160),
      description: clean(item.description),
      // All-day events are usually "free" (birthdays, holidays) unless explicitly marked busy.
      busy: transp ? transp !== 'TRANSPARENT' : !start.isDate,
    });
  };
  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    const limit = ICAL.Time.fromJSDate(to, true);
    for (let i = 0, next = it.next(); next && i < 50_000; i++, next = it.next()) {
      if (next.compare(limit) >= 0) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((a, b) => +a.start - +b.start);
}

export async function eventsBetween(from: Date, to: Date, opts: { calendar?: string; signal?: AbortSignal } = {}) {
  const feeds = getSettings().calendars.filter((f) => f.enabled && f.url && (!opts.calendar || f.name.toLowerCase().includes(opts.calendar.toLowerCase())));
  const events: CalEvent[] = [];
  const errors: string[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        events.push(...expandEvents(await loadFeed(f, opts.signal), f.name, from, to));
      } catch (err) {
        errors.push(errorMessage(err));
      }
    }),
  );
  // Calendars from linked Google accounts (Sign in with Google), via the Calendar API.
  const google = googleAccounts().filter((g) => g.calendar && !g.broken);
  if (google.length) {
    const g = await googleEventsBetween(from, to);
    for (const e of g.events) if (!opts.calendar || e.calendar.toLowerCase().includes(opts.calendar.toLowerCase())) events.push({ calendar: e.calendar, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description, busy: e.busy });
    errors.push(...g.errors);
  }
  return { events: events.sort((a, b) => +a.start - +b.start), errors, feeds: feeds.length + google.length };
}

/** Check a feed right away (Settings → "Test"). */
export async function testFeed(feed: CalendarFeed) {
  const root = await loadFeed(feed, undefined, true);
  const now = new Date();
  const next = expandEvents(root, feed.name, now, new Date(+now + 30 * 86_400_000));
  const name = clean(root.getFirstPropertyValue('x-wr-calname'), 80);
  return { ok: true, name, upcoming: next.length, next: next[0] ? { title: next[0].title, start: next[0].start.toISOString(), allDay: next[0].allDay } : null };
}

// ───────────────────────── Tools ─────────────────────────

function parseWhen(v: unknown, fallback: Date): Date {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  const s = v.trim();
  // Dates and times without an offset are the user's wall clock (a bare date is their midnight).
  const d = new Date(parseLocal(s));
  if (Number.isNaN(+d)) throw new Error(`Couldn't read the date "${s}". Use ISO format, e.g. 2026-11-20 or 2026-11-20T14:00.`);
  return d;
}

function range(a: Record<string, unknown>, defaultDays: number) {
  const now = new Date();
  const from = parseWhen(a.start, now);
  const to = parseWhen(a.end, new Date(+from + defaultDays * 86_400_000));
  if (to <= from) throw new Error('"end" must be after "start".');
  if (+to - +from > 400 * 86_400_000) throw new Error('Ask for at most about a year at a time.');
  return { from, to };
}

// Everything is shown in the user's time zone.
const dayFmt = { format: (d: Date | number) => fmtDay(+d) };
const timeFmt = { format: (d: Date | number) => fmtTime(+d) };
const tzName = userTz;

function noFeeds() {
  return 'No calendars are connected. Tell the user they can Sign in with Google (Settings → Connectors → Google) or add an iCal feed (Settings → Connectors → Calendar feeds).';
}

export function syncCalendarTools() {
  unregisterWhere((t) => t.group === 'Calendar');
  const googleCals = googleAccounts().filter((g) => g.calendar);
  if (googleCals.length) {
    registerTool({
      name: 'calendar_create_event',
      label: 'Add calendar event',
      group: 'Calendar',
      description:
        "Add an event to the user's Google Calendar. start/end are local date-times like 2026-11-21T15:00 (the user's local time) or dates for all-day events. If the time or title is missing, ask the user first.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string', description: 'Default: one hour after start' },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
          description: { type: 'string' },
          account: { type: 'string', description: `Google account (default ${googleCals[0].email})` },
        },
        required: ['title', 'start'],
      },
      risk: 'medium',
      defaultPolicy: 'ask',
      summarize: (a) => `Add “${a.title}” on ${a.start}`,
      async run(a) {
        const acc = googleCals.find((g) => g.email === String(a.account ?? '').toLowerCase()) ?? googleCals[0];
        const r = await createGoogleEvent(acc.email, { title: String(a.title), start: String(a.start), end: a.end ? String(a.end) : undefined, allDay: !!a.all_day, location: a.location, description: a.description });
        return `Added to ${acc.email}'s calendar.${r.link ? ` ${r.link}` : ''}`;
      },
    });
  }
  if (!getSettings().calendars.some((f) => f.enabled && f.url) && !googleCals.length) return;

  registerTool({
    name: 'calendar_events',
    label: 'Read calendar',
    group: 'Calendar',
    description:
      "List events from the user's calendars (read-only iCal feeds) in a time range, including repeating events. Defaults to the next 7 days. Use `query` to search titles, places and notes. These calendars can't be edited: to add or change an event, tell the user what to add.",
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO date or date-time, the user’s local time if no offset (default: now)' },
        end: { type: 'string', description: 'ISO date or date-time (default: start + 7 days)' },
        query: { type: 'string', description: 'Only events whose title, location or notes contain this text' },
        calendar: { type: 'string', description: 'Only calendars whose name contains this' },
      },
    },
    risk: 'low',
    defaultPolicy: 'auto',
    summarize: (a) => (a.query ? `Search calendar for “${a.query}”` : `Read calendar${a.start ? ` from ${a.start}` : ''}${a.end ? ` to ${a.end}` : ''}`),
    async run(a, ctx) {
      const { from, to } = range(a, 7);
      const { events, errors, feeds } = await eventsBetween(from, to, { calendar: a.calendar, signal: ctx.signal });
      if (!feeds) return noFeeds();
      const q = typeof a.query === 'string' ? a.query.toLowerCase().trim() : '';
      const hits = q ? events.filter((e) => [e.title, e.location, e.description].some((x) => x?.toLowerCase().includes(q))) : events;
      const lines: string[] = [];
      let day = '';
      for (const e of hits.slice(0, 250)) {
        const d = dayFmt.format(e.start);
        if (d !== day) lines.push(`\n${(day = d)}`);
        const when = e.allDay ? 'all day' : `${timeFmt.format(e.start)}–${timeFmt.format(e.end)}${dayFmt.format(e.end) !== d && !(parts(+e.end).h === 0 && parts(+e.end).mi === 0) ? ` (ends ${dayFmt.format(e.end)})` : ''}`;
        lines.push(`- ${when} · ${e.title}${e.location ? ` · @ ${e.location}` : ''}${feeds > 1 ? ` [${e.calendar}]` : ''}${e.description ? `\n  notes: ${e.description}` : ''}`);
      }
      const head = `${hits.length} event${hits.length === 1 ? '' : 's'}${q ? ` matching “${a.query}”` : ''} between ${dayFmt.format(from)} ${timeFmt.format(from)} and ${dayFmt.format(to)} ${timeFmt.format(to)} (${tzName()})${hits.length > 250 ? ', first 250 shown' : ''}.`;
      const errs = errors.length ? `\n\nSome calendars couldn't be read: ${errors.join('; ')}` : '';
      return untrusted('calendar', head + lines.join('\n') + errs);
    },
  });

  registerTool({
    name: 'calendar_free_time',
    label: 'Find free time',
    group: 'Calendar',
    description:
      "Find open slots in the user's calendars between busy events, within working hours. Defaults: next 7 days, 09:00–18:00, weekdays, slots of at least 30 minutes. All-day events only block time if marked busy.",
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO date or date-time (default: now)' },
        end: { type: 'string', description: 'ISO date or date-time (default: start + 7 days)' },
        minMinutes: { type: 'integer', description: 'Shortest useful slot in minutes (default 30)' },
        dayStart: { type: 'string', description: 'Earliest time of day, HH:MM (default 09:00)' },
        dayEnd: { type: 'string', description: 'Latest time of day, HH:MM (default 18:00)' },
        weekends: { type: 'boolean', description: 'Include Saturday and Sunday (default false)' },
      },
    },
    risk: 'low',
    defaultPolicy: 'auto',
    summarize: () => 'Find free time in calendar',
    async run(a, ctx) {
      const { from, to } = range(a, 7);
      const { events, errors, feeds } = await eventsBetween(from, to, { signal: ctx.signal });
      if (!feeds) return noFeeds();
      const minMs = Math.max(5, Number(a.minMinutes) || 30) * 60_000;
      const hm = (s: unknown, def: string) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s.trim() : def) ?? /^(\d{1,2}):(\d{2})$/.exec(def)!;
        return [Number(m[1]), Number(m[2])] as const;
      };
      const [sh, sm] = hm(a.dayStart, '09:00');
      const [eh, em] = hm(a.dayEnd, '18:00');
      const busy = events.filter((e) => e.busy).map((e) => [+e.start, +e.end] as const);
      const lines: string[] = [];
      // Walk the user's calendar days.
      const p0 = parts(+from);
      for (let i = 0; i < 400; i++) {
        const cursor = new Date(wallToUtc(p0.y, p0.mo, p0.d + i, 12, 0));
        if (+wallToUtc(p0.y, p0.mo, p0.d + i, 0, 0) >= +to) break;
        const dow = parts(+cursor).dow;
        if (!a.weekends && (dow === 0 || dow === 6)) continue;
        const ds = wallToUtc(p0.y, p0.mo, p0.d + i, sh, sm);
        const de = wallToUtc(p0.y, p0.mo, p0.d + i, eh, em);
        let t = Math.max(+ds, +from);
        const stop = Math.min(+de, +to);
        if (t >= stop) continue;
        const slots: string[] = [];
        for (const [bs, be] of busy.filter(([bs, be]) => be > t && bs < stop).sort((x, y) => x[0] - y[0])) {
          if (bs - t >= minMs) slots.push(`${timeFmt.format(t)}–${timeFmt.format(bs)}`);
          t = Math.max(t, be);
        }
        if (stop - t >= minMs) slots.push(`${timeFmt.format(t)}–${timeFmt.format(stop)}`);
        lines.push(`- ${dayFmt.format(cursor)}: ${slots.length ? slots.join(', ') : 'no free slots'}`);
      }
      const errs = errors.length ? `\n\nSome calendars couldn't be read, so this may miss events: ${errors.join('; ')}` : '';
      return `Free time (${tzName()}, ${a.dayStart ?? '09:00'}–${a.dayEnd ?? '18:00'}, slots ≥ ${minMs / 60_000} min):\n${lines.join('\n') || '- none in this range'}${errs}`;
    },
  });
}
