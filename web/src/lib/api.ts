// Fetch helpers. Non-GET requests carry the X-Requested-With header the server checks as a CSRF guard.
export type Params = Record<string, string | number | boolean | null | undefined>

export class ApiError extends Error {
  status: number
  detail: string
  constructor(message: string, status: number, detail: string) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export const qs = (params?: Params) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue
    u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) }
  if (method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'scent-atlas'
  const r = await fetch(url, { ...opts, headers, credentials: 'same-origin' })
  if (!r.ok) {
    let detail = ''
    try {
      const j = await r.json()
      detail = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? (j.detail[0] && j.detail[0].msg) || '' : ''
    } catch {
      /* not json */
    }
    throw new ApiError(detail || `${r.status} ${r.statusText}`, r.status, detail)
  }
  return r.json() as Promise<T>
}

const jsonBody =
  (method: string) =>
  <T = any>(path: string, body?: unknown, signal?: AbortSignal) =>
    req<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
      signal,
    })

export const api = {
  get: <T = any>(path: string, params?: Params, signal?: AbortSignal) => req<T>(path + qs(params), { signal }),
  post: jsonBody('POST'),
  put: jsonBody('PUT'),
  patch: jsonBody('PATCH'),
  del: <T = any>(path: string) => req<T>(path, { method: 'DELETE' }),
}

export const errorText = (e: unknown, fallback = 'Something went wrong. Please try again.') =>
  e instanceof ApiError ? e.detail || fallback : fallback
