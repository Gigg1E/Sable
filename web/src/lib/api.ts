export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Never spin forever: a server that doesn't answer gets a clear message instead.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError(0, "Sable didn't answer within 30 seconds. The server may be busy, restarting or unreachable (check that it's running and that Tailscale is connected), then try again.");
    }
    throw new ApiError(0, "Couldn't reach Sable. Check that the server is running and that you're connected (Tailscale).");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('sable:unauthorized'));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body: unknown = {}) => request<T>('POST', p, body),
  put: <T>(p: string, body: unknown) => request<T>('PUT', p, body),
  patch: <T>(p: string, body: unknown) => request<T>('PATCH', p, body),
  del: <T>(p: string) => request<T>('DELETE', p),
};
