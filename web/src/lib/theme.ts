export type Theme = 'system' | 'light' | 'dark';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('sable-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem('sable-theme', t);
  } catch {
    /* storage unavailable */
  }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  window.dispatchEvent(new Event('sable:theme'));
}

export function resolvedTheme(): 'light' | 'dark' {
  const t = getTheme();
  if (t !== 'system') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
