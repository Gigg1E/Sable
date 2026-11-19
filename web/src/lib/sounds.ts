/**
 * Small UI sounds, synthesized with Web Audio (no audio files): soft, short and musical, so they
 * add feedback without being noisy. Off and volume are remembered per device.
 */

export type Sound = 'send' | 'queue' | 'done' | 'approval' | 'notify' | 'error' | 'toggle';

const KEY = 'sable.sounds';
interface Prefs {
  on: boolean;
  volume: number;
}
function prefs(): Prefs {
  try {
    return { on: true, volume: 0.6, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { on: true, volume: 0.6 };
  }
}
export function soundPrefs() {
  return prefs();
}
export function setSoundPrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs(), ...p }));
  } catch {
    /* private mode */
  }
}

let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
// Browsers only allow audio after a user gesture; warm up on the first one.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** One note: a sine/triangle with a quick attack and soft exponential release. */
function note(ac: AudioContext, out: AudioNode, freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine', glide?: number) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.02);
}

const last: Partial<Record<Sound, number>> = {};

export function play(sound: Sound) {
  const p = prefs();
  if (!p.on || p.volume <= 0) return;
  // Don't stack the same sound (bursts of events).
  const t = performance.now();
  if (t - (last[sound] ?? 0) < 250) return;
  last[sound] = t;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const out = ac.createGain();
  out.gain.value = 0.22 * p.volume;
  out.connect(ac.destination);
  const now = ac.currentTime + 0.01;
  switch (sound) {
    case 'send': // a light upward tick
      note(ac, out, 660, now, 0.09, 0.5, 'triangle', 990);
      break;
    case 'queue': // two quick soft clicks
      note(ac, out, 880, now, 0.05, 0.35, 'triangle');
      note(ac, out, 1175, now + 0.06, 0.06, 0.3, 'triangle');
      break;
    case 'done': // a gentle major-third chime
      note(ac, out, 784, now, 0.32, 0.45);
      note(ac, out, 988, now + 0.09, 0.42, 0.4);
      note(ac, out, 1568, now + 0.09, 0.3, 0.08);
      break;
    case 'approval': // a warm two-tone "needs you"
      note(ac, out, 587, now, 0.18, 0.5, 'triangle');
      note(ac, out, 880, now + 0.16, 0.34, 0.5, 'triangle');
      break;
    case 'notify': // a small bell
      note(ac, out, 1319, now, 0.6, 0.35);
      note(ac, out, 2637, now, 0.25, 0.08);
      note(ac, out, 1760, now + 0.12, 0.5, 0.25);
      break;
    case 'error': // a low, soft descending tone
      note(ac, out, 330, now, 0.26, 0.5, 'triangle', 220);
      break;
    case 'toggle':
      note(ac, out, 1046, now, 0.07, 0.35, 'triangle');
      break;
  }
}
