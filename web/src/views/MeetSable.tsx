import { SableCharacter, type Mood } from '../components/SableCharacter';
import { Page, TopBar } from '../components/ui';
import { useSableMood } from '../lib/mood';

const MOODS: { mood: Mood; name: string; when: string }[] = [
  { mood: 'idle', name: 'Around', when: 'Nothing running. A slow breath, the odd blink.' },
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

  return (
    <>
      <TopBar title="Meet Sable" />
      <Page width="md">
        <p className="voice max-w-[52ch] text-[22px] font-semibold leading-snug">This is me. Watch my eyes and you’ll know what I’m up to.</p>
        <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-fg-2">I show what I’m really doing in the sidebar, next to my replies and on Home. Right now I’m {MOODS.find((m) => m.mood === now)?.name.toLowerCase()}.</p>
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
