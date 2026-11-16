import crypto from 'node:crypto';

export const now = () => Date.now();

export function id(prefix = ''): string {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} characters]`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Wrap content that came from outside the user's control so the model treats it as data. */
export function untrusted(source: string, body: string): string {
  return `<untrusted source="${source.replace(/"/g, "'")}">\n${body}\n</untrusted>`;
}
