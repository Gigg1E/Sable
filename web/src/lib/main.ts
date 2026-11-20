import { useEffect, useState } from 'react';
import { api } from './api';

/** The id of the main chat (the home conversation), fetched once and shared. */
let cached: string | null = null;
let pending: Promise<string> | null = null;

export function getMainId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  pending ??= api.get<{ id: string }>('/main').then((r) => (cached = r.id));
  return pending;
}

export function useMainId() {
  const [id, setId] = useState<string | null>(cached);
  useEffect(() => {
    if (!id) void getMainId().then(setId).catch(() => {});
  }, [id]);
  return id;
}
