/**
 * auth.ts (frontend) — session-token storage + login.
 *
 * The token (from POST /auth) is attached as `Authorization: Bearer` on every
 * apiRequest. On a 401 the token is cleared and the login overlay is shown.
 * Until the backend gate is configured, no 401s occur and the app behaves as
 * before — so this is inert until the owner sets the env vars.
 */

const TOKEN_KEY = 'kecc_auth_token'
let unauthorizedHandler: (() => void) | null = null

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* ignore */ }
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

/** Register the callback that surfaces the login screen (called on a 401). */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.()
}

/**
 * Install a global fetch interceptor so EVERY call to /.netlify/functions/* carries
 * the session token and triggers the login overlay on 401 — covers the many raw
 * fetch() call sites that bypass apiRequest (Settings, uploads, etc.).
 * Inert until a token exists; never touches non-function requests.
 */
let interceptorInstalled = false
export function installAuthFetchInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined') return
  interceptorInstalled = true
  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const isFn = url.includes('/.netlify/functions/')
    const isLoginCall = url.includes('/.netlify/functions/auth')
    if (isFn && !isLoginCall) {
      const token = getToken()
      if (token) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
        init = { ...init, headers }
      }
    }
    const res = await orig(input as RequestInfo, init)
    if (isFn && !isLoginCall && res.status === 401) {
      clearToken()
      notifyUnauthorized()
    }
    return res
  }
}

/**
 * Log in with the app password. Uses a direct fetch (not apiRequest) so a wrong
 * password doesn't recursively trigger the global 401 handler.
 */
export async function login(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/.netlify/functions/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      const { token } = await res.json()
      setToken(token)
      return { ok: true }
    }
    // Gate not configured server-side — nothing to protect; let the user through.
    if (res.status === 503) return { ok: true }
    return { ok: false, error: res.status === 401 ? 'Incorrect password' : 'Login failed' }
  } catch {
    return { ok: false, error: 'Network error — check your connection' }
  }
}
