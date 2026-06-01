/**
 * _auth.ts — shared authentication helper for the function layer
 *
 * Single-operator CRM: one app password → a signed, expiring session token
 * (HMAC-SHA256, no DB, no external service). Protected functions call
 * requireAuth(event, CORS) at the top of their handler and return its result
 * if non-null.
 *
 * FAIL-OPEN until configured: if AUTH_SECRET or APP_PASSWORD is not set in the
 * environment, the gate stays OPEN (requests pass) so shipping this change can
 * never lock the owner out before the env vars are set. Once BOTH are set, the
 * gate activates automatically and every protected route requires a valid token.
 */

import crypto from 'crypto'
import type { HandlerEvent, HandlerResponse } from '@netlify/functions'

const SECRET = process.env.AUTH_SECRET ?? ''
const PASSWORD = process.env.APP_PASSWORD ?? ''
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

/** True only when both secrets are present — i.e. the gate is live. */
export function authConfigured(): boolean {
  return SECRET.length > 0 && PASSWORD.length > 0
}

/** Mint a signed token: base64url(payload).base64url(hmac). */
export function signToken(): string {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Verify signature + expiry. Returns false on any malformed/expired/forged token. */
export function verifyToken(token: string | null | undefined): boolean {
  if (!token || !SECRET) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [body, sig] = parts
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}

/** Constant-time password check against APP_PASSWORD. */
export function checkPassword(input: string | null | undefined): boolean {
  if (!PASSWORD || !input) return false
  const a = Buffer.from(input)
  const b = Buffer.from(PASSWORD)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function bearerToken(event: HandlerEvent): string | null {
  const h = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

/**
 * Gate a protected request. Returns a 401 HandlerResponse if the caller is not
 * authenticated, or null to proceed. No-op (returns null) until the gate is
 * configured. Pass the function's own CORS headers so the 401 is readable.
 */
export function requireAuth(
  event: HandlerEvent,
  corsHeaders: Record<string, string>,
): HandlerResponse | null {
  if (!authConfigured()) {
    console.warn('[auth] AUTH_SECRET/APP_PASSWORD not set — auth gate is OPEN. Set both to activate.')
    return null
  }
  if (verifyToken(bearerToken(event))) return null
  return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) }
}
