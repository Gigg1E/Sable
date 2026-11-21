import { useEffect, useRef, useState } from 'react';
import type { Mood } from '../components/SableCharacter';
import { useIsFrozen } from '../components/Safety';
import { useStore } from './store';

function lateNight() {
  const h = new Date().getHours();
  return h >= 1 && h < 6;
}

/**
 * Sable's mood, from what it is really doing (docs/design/character.md):
 * frozen > waiting (approvals) > thinking/working (runs) > happy (a run just ended) > sleeping (1–6 am) > idle.
 * Pass a conversation id to scope it to one chat.
 */
export function useSableMood(conversationId?: string): Mood {
  const frozen = useIsFrozen();
  const waiting = useStore((s) => s.approvals.some((a) => (!conversationId || a.conversation_id === conversationId)));
  const runs = useStore((s) => (conversationId ? (s.runs[conversationId] ? 1 : 0) : Object.keys(s.runs).length));
  const streamingText = useStore((s) => {
    const list = conversationId ? [s.streaming[conversationId]] : Object.values(s.streaming);
    return list.some((x) => x && x.text.length > 0);
  });
  const [happy, setHappy] = useState(false);
  const [night, setNight] = useState(lateNight);
  const prev = useRef(runs);

  useEffect(() => {
    if (prev.current > 0 && runs < prev.current) {
      setHappy(true);
      const t = setTimeout(() => setHappy(false), 3200);
      prev.current = runs;
      return () => clearTimeout(t);
    }
    prev.current = runs;
  }, [runs]);
  useEffect(() => {
    const t = setInterval(() => setNight(lateNight()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (frozen) return 'frozen';
  if (waiting) return 'waiting';
  if (runs > 0) return streamingText ? 'working' : 'thinking';
  if (happy) return 'happy';
  if (night) return 'sleeping';
  return 'idle';
}
