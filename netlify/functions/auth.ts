/**
 * auth.ts — login endpoint (PUBLIC by necessity).
 *
 * POST { password } → { token } when the password matches APP_PASSWORD.
 * The token is an HMAC-signed, 30-day session token verified by requireAuth()
 * on every protected function. This endpoint is intentionally unauthenticated;
 * it is the front door.
 */

import type { Handler } from '@netlify/functions'
import { checkPassword, signToken, authConfigured } from './_auth'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // If the gate isn't configured, tell the SPA so it can skip the login screen.
  if (!authConfigured()) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'Auth not configured' }) }
  }

  let password: string | undefined
  try {
    password = JSON.parse(event.body ?? '{}').password
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request' }) }
  }

  if (!checkPassword(password)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid password' }) }
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ token: signToken() }) }
}
