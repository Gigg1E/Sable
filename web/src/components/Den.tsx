import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useSableMood } from '../lib/mood';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { SableCharacter, type Mood } from './SableCharacter';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return `Still up? I'm here if you need anything.`;
  if (h < 12) return `Morning. What should we take on today?`;
  if (h < 17) return `Afternoon. What should we take on?`;
  if (h < 22) return `Evening. Anything left for today?`;
  return `Late one. Tell me what's on your mind and I'll hold it till morning if it can wait.`;
}

/** What Sable says on Home: always about the real state, most important thing first. */
function useLine(mood: Mood): { text: string; go?: () => void; action?: string } {
  const approvals = useStore((s) => s.approvals);
  const runs = useStore((s) => s.runs);
  const conversations = useStore((s) => s.conversations);
  const running = conversations.filter((c) => runs[c.id]);

  if (mood === 'frozen') return { text: `I'm frozen. I'll look things up, but I won't change, send or buy anything until you say so.` };
  if (approvals.length) {
    const a = approvals[0];
    const more = approvals.length > 1 ? ` (and ${approvals.length - 1} more)` : '';
    return { text: `I need your OK before I ${a.summary.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, '')}${more}.`, go: () => navigate('/inbox'), action: 'Review' };
  }
  if (running.length) {
    const c = running[0];
    const more = running.length > 1 ? `, plus ${running.length - 1} other thing${running.length > 2 ? 's' : ''}` : '';
    return { text: `Working on “${c.title}”${more}.`, go: () => navigate(`/chat/${c.id}`), action: 'Watch' };
  }
  if (mood === 'happy') return { text: `Done. Take a look when you get a chance.` };
  if (mood === 'sleeping') return { text: `It's late, so I'm resting an eye. I'm still watching everything; just ask.` };
  return { text: greeting() };
}

/** Words that arrive one after another, like someone talking. */
function Spoken({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  return (
    <motion.span key={text} initial="hidden" animate="shown" transition={{ staggerChildren: reduce ? 0 : 0.035 }} aria-label={text}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="inline-block whitespace-pre"
          variants={{ hidden: { opacity: 0, y: reduce ? 0 : 6, filter: reduce ? 'none' : 'blur(3px)' }, shown: { opacity: 1, y: 0, filter: 'blur(0px)' } }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {w + (i < words.length - 1 ? ' ' : '')}
        </motion.span>
      ))}
    </motion.span>
  );
}

/**
 * The top of Home: Sable in its den, saying the one thing that matters right now.
 * Tap Sable and it reacts.
 */
export function Den() {
  const live = useSableMood();
  const [poked, setPoked] = useState(false);
  const mood: Mood = poked && (live === 'idle' || live === 'sleeping') ? 'happy' : live;
  const line = useLine(live);

  useEffect(() => {
    if (!poked) return;
    const t = setTimeout(() => setPoked(false), 1800);
    return () => clearTimeout(t);
  }, [poked]);

  return (
    <div className="flex items-end gap-3 sm:gap-5">
      <button onClick={() => setPoked(true)} className="relative -mb-1 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-accent" aria-label="Say hi to Sable">
        <motion.span
          aria-hidden
          className="den-glow pointer-events-none absolute -inset-8 rounded-full"
          animate={{ opacity: mood === 'sleeping' ? 0.35 : mood === 'waiting' ? [0.7, 1, 0.7] : 0.8 }}
          transition={{ duration: 2.4, repeat: mood === 'waiting' ? Infinity : 0 }}
        />
        <motion.span
          initial={{ y: 24, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 16, delay: 0.05 }}
          className="relative block"
          data-den-sable
        >
          <SableCharacter mood={mood} size={120} className="max-sm:!size-[92px]" />
        </motion.span>
      </button>

      <motion.div
        initial={{ opacity: 0, scale: 0.92, x: -8 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.18 }}
        style={{ originX: 0, originY: 1 }}
        className="relative mb-6 min-w-0 flex-1 rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-2 sm:mb-8 sm:px-5 sm:py-4"
        aria-live="polite"
      >
        <span aria-hidden className="absolute -left-[7px] bottom-3 size-3 rotate-45 border-b border-l border-line bg-panel" />
        <p className="voice text-[19px] font-semibold leading-[1.3] text-fg sm:text-[23px]">
          <AnimatePresence mode="wait">
            <Spoken text={line.text} />
          </AnimatePresence>
        </p>
        {line.go && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} onClick={line.go} className="mt-2 text-[12.5px] font-medium text-accent hover:underline">
            {line.action}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
