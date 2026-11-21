import { SableCharacter, setLook, useLook, type Look, type Mood } from '../components/SableCharacter';
import { cx } from '../lib/format';
import { Page, TopBar } from '../components/ui';
import { useSableMood } from '../lib/mood';

const MOODS: { mood: Mood; name: string; when: string }[] = [
  { mood: 'idle', name: 'Around', when: 'Nothing running. A slow breath.' },
  { mood: 'thinking', name: 'Thinking', when: 'Working out what to do.' },
  { mood: 'working', name: 'Working', when: 'Writing an answer or running tools.' },
  { mood: 'waiting', name: 'Needs you', when: 'Something is waiting for your approval.' },
  { mood: 'happy', name: 'Done', when: 'A task just finished. Also when you tap it.' },
  { mood: 'sleeping', name: 'Resting', when: '1 to 6 am, nothing to do. Still watching.' },
  { mood: 'frozen', name: 'Frozen', when: 'Freeze is on: it looks, but won’t act.' },
];

/** Who Sable is, and what each of its moods means. */
export function MeetSable() {
  const now = useSableMood();
  const look = useLook();
  const looks: { id: Look; name: string }[] = [
    { id: 'orb', name: 'Orb' },
    { id: 'head', name: 'Head' },
  ];
  return (
    <>
      <TopBar title="Meet Sable" />
      <Page width="md">
        <p className="voice max-w-[52ch] text-[22px] font-semibold leading-snug">This is me. I don’t need a face to tell you what I’m up to.</p>
        <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-fg-2">I show what I’m really doing in the sidebar, next to my replies and on Home. Right now I’m {MOODS.find((m) => m.mood === now)?.name.toLowerCase()}.</p>
        <div role="radiogroup" aria-label="How Sable looks" className="mt-6 flex gap-2">
          {looks.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={look === l.id}
              onClick={() => setLook(l.id)}
              className={cx('flex items-center gap-2.5 rounded-xl border py-2 pl-2 pr-4 text-[13.5px] font-medium transition-colors', look === l.id ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-line-strong')}
            >
              <SableCharacter look={l.id} mood={now} size={36} />
              {l.name}
            </button>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {MOODS.map((m) => (
            <div key={m.mood} className="flex flex-col items-center text-center">
              <SableCharacter mood={m.mood} size={104} />
              <div className="mt-2 text-[13.5px] font-medium">{m.name}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-fg-3">{m.when}</div>
            </div>
          ))}
        </div>
      </Page>
    </>
  );
}
