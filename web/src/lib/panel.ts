import { create } from 'zustand';

/** Side panel and layout preferences, remembered in this browser. */
export type PanelTab = 'files' | 'reminders' | 'journal' | `space:${string}`;

interface PanelState {
  open: boolean;
  tab: PanelTab;
  width: number;
  full: boolean;
  /** Open by itself when the agent makes a file, a space or a reminder. */
  auto: boolean;
  navCollapsed: boolean;
  /** File open in the Files tab (workspace path), or null for the list. */
  file: string | null;
  set: (p: Partial<Omit<PanelState, 'set'>>) => void;
  show: (tab: PanelTab, file?: string | null) => void;
}

const KEY = 'sable.panel';
function load(): Partial<PanelState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const usePanel = create<PanelState>((set) => {
  const saved = load();
  const persist = (s: PanelState) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ open: s.open, tab: s.tab, width: s.width, auto: s.auto, navCollapsed: s.navCollapsed }));
    } catch {
      /* private mode */
    }
  };
  return {
    open: saved.open ?? false,
    tab: saved.tab ?? 'files',
    width: saved.width ?? 440,
    full: false,
    auto: saved.auto ?? true,
    navCollapsed: saved.navCollapsed ?? false,
    file: null,
    set: (p) =>
      set((s) => {
        const next = { ...s, ...p };
        persist(next);
        return p;
      }),
    show: (tab, file) =>
      set((s) => {
        const next = { ...s, open: true, tab, file: file === undefined ? (tab === 'files' ? s.file : null) : file };
        persist(next);
        return next;
      }),
  };
});
