/**
 * google-cal.ts — Google Calendar OAuth 2.0 connect/disconnect/status
 *
 * Actions (via ?action= query param):
 *   GET  ?action=connect    → redirect to Google consent screen
 *   GET  ?action=callback   → exchange code, store tokens, redirect to /#/settings
 *   GET  ?action=status     → { connected, calendarId, expiresAt }
 *   POST ?action=disconnect → clear tokens from DB
 */

import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events'

function getRedirectUri(event: Parameters<Handler>[0]): string {
  // Build the redirect URI from the incoming request so it works on any deploy URL
  const proto = event.headers['x-forwarded-proto'] ?? 'https'
  const host  = event.headers['x-forwarded-host'] ?? event.headers.host ?? ''
  return `${proto}://${host}/.netlify/functions/google-cal?action=callback`
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const action = event.queryStringParameters?.action
  const method = event.httpMethod

  try {
    // ── GET status ──────────────────────────────────────────────────────────
    if (method === 'GET' && action === 'status') {
      const { data } = await supabase
        .from('company_settings')
        .select('google_cal_refresh_token, google_cal_token_expires_at, google_cal_id')
        .limit(1)
        .single()

      const connected = !!data?.google_cal_refresh_token
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          connected,
          calendarId:  data?.google_cal_id ?? null,
          expiresAt:   data?.google_cal_token_expires_at ?? null,
        }),
      }
    }

    // ── GET connect → redirect to Google ────────────────────────────────────
    if (method === 'GET' && action === 'connect') {
      const clientId    = process.env.GOOGLE_CLIENT_ID
      const redirectUri = getRedirectUri(event)

      if (!clientId) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'GOOGLE_CLIENT_ID not set' }) }
      }

      const params = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         SCOPES,
        access_type:   'offline',
        prompt:        'consent',   // force consent to always get refresh token
      })

      return {
        statusCode: 302,
        headers: { Location: `${GOOGLE_AUTH_URL}?${params.toString()}` },
        body: '',
      }
    }

    // ── GET callback → exchange code for tokens ──────────────────────────────
    if (method === 'GET' && action === 'callback') {
      const code  = event.queryStringParameters?.code
      const error = event.queryStringParameters?.error

      if (error || !code) {
        // User denied — redirect back to settings with error flag
        return {
          statusCode: 302,
          headers: { Location: '/#/settings?google_error=denied' },
          body: '',
        }
      }

      const clientId     = process.env.GOOGLE_CLIENT_ID!
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
      const redirectUri  = getRedirectUri(event)

      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
        }),
      })

      if (!tokenRes.ok) {
        const body = await tokenRes.text()
        console.error('Google token exchange failed:', body)
        return {
          statusCode: 302,
          headers: { Location: '/#/settings?google_error=token' },
          body: '',
        }
      }

      const tokens = await tokenRes.json() as {
        access_token:  string
        refresh_token: string
        expires_in:    number
        scope:         string
      }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      // Fetch the user's primary calendar ID
      let calendarId = 'primary'
      try {
        const calRes = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary',
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        )
        if (calRes.ok) {
          const cal = await calRes.json() as { id: string }
          calendarId = cal.id
        }
      } catch {
        // non-fatal — fall back to 'primary'
      }

      // Store tokens in DB
      const { data: existing } = await supabase.from('company_settings').select('id').limit(1).single()
      if (!existing) {
        return {
          statusCode: 302,
          headers: { Location: '/#/settings?google_error=no_settings' },
          body: '',
        }
      }

      await supabase
        .from('company_settings')
        .update({
          google_cal_access_token:    tokens.access_token,
          google_cal_refresh_token:   tokens.refresh_token,
          google_cal_token_expires_at: expiresAt,
          google_cal_id:              calendarId,
        })
        .eq('id', existing.id)

      // Redirect back to settings with success flag
      return {
        statusCode: 302,
        headers: { Location: '/#/settings?google_connected=1' },
        body: '',
      }
    }

    // ── POST disconnect ──────────────────────────────────────────────────────
    if (method === 'POST' && action === 'disconnect') {
      const { data: existing } = await supabase.from('company_settings').select('id').limit(1).single()
      if (existing) {
        await supabase
          .from('company_settings')
          .update({
            google_cal_access_token:    null,
            google_cal_refresh_token:   null,
            google_cal_token_expires_at: null,
            google_cal_id:              null,
          })
          .eq('id', existing.id)
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('google-cal error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
