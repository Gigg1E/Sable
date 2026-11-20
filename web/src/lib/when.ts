/** "Tonight 10:00 PM", "Tomorrow 9:00 AM", "Sat, Nov 22, 7:30 PM". */
export function whenText(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  if (diff === 0) return `${d.getHours() >= 17 ? 'Tonight' : 'Today'} ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "in 5 min", "in 2 h 10 min", "in 3 days". */
export function untilText(t: number, from = Date.now()) {
  const m = Math.round((t - from) / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d > 1 ? 's' : ''}`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(t: number) {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
