/**
 * _google.ts — shared Google Calendar helpers (underscore = not exposed as HTTP endpoint)
 *
 * Handles:
 *  - Token refresh (ensureValidToken)
 *  - Building a Google Calendar event from a CRM job
 *  - Creating / updating / deleting events on Google Calendar
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CAL_BASE  = 'https://www.googleapis.com/calendar/v3'

// ── Token management ──────────────────────────────────────────────────────────

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  calendarId: string
}

/** Fetch tokens from DB; returns null if not connected. */
async function getTokens(): Promise<GoogleTokens | null> {
  const { data } = await supabase
    .from('company_settings')
    .select('google_cal_access_token, google_cal_refresh_token, google_cal_token_expires_at, google_cal_id')
    .limit(1)
    .single()

  if (!data?.google_cal_refresh_token) return null

  return {
    accessToken:  data.google_cal_access_token,
    refreshToken: data.google_cal_refresh_token,
    expiresAt:    new Date(data.google_cal_token_expires_at),
    calendarId:   data.google_cal_id ?? 'primary',
  }
}

/** Refresh access token and save new tokens to DB. */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token refresh failed: ${body}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  const expiresAt = new Date(Date.now() + json.expires_in * 1000)

  // Persist new access token + expiry
  const { data: existing } = await supabase.from('company_settings').select('id').limit(1).single()
  if (existing) {
    await supabase
      .from('company_settings')
      .update({
        google_cal_access_token:   json.access_token,
        google_cal_token_expires_at: expiresAt.toISOString(),
      })
      .eq('id', existing.id)
  }

  return json.access_token
}

/**
 * Returns a valid access token, refreshing if expired or within 60 seconds of expiry.
 * Returns null if Google Calendar is not connected.
 */
export async function ensureValidToken(): Promise<{ accessToken: string; calendarId: string } | null> {
  const tokens = await getTokens()
  if (!tokens) return null

  const needsRefresh = tokens.expiresAt.getTime() - Date.now() < 60_000
  const accessToken  = needsRefresh
    ? await refreshAccessToken(tokens.refreshToken)
    : tokens.accessToken

  return { accessToken, calendarId: tokens.calendarId }
}

// ── Event builder ─────────────────────────────────────────────────────────────

export interface JobForSync {
  id: string
  jobType: string
  serviceName: string
  scheduledDate: string | null
  scheduledTime: string | null
  scheduledWindow: string | null
  customerName: string | null
  customerAddress: string | null
  notes: string | null
  status: string
  googleEventId?: string | null
}

/** Builds a Google Calendar event body from a CRM job. */
export function buildGoogleEvent(job: JobForSync): Record<string, unknown> {
  const isQuoteVisit = job.jobType === 'quote_visit'
  const title = isQuoteVisit
    ? `📋 Quote Visit — ${job.customerName ?? 'Customer'}`
    : `${job.serviceName}${job.customerName ? ` — ${job.customerName}` : ''}`

  const descParts: string[] = []
  if (job.customerAddress) descParts.push(`📍 ${job.customerAddress}`)
  if (job.notes)           descParts.push(`📝 ${job.notes}`)
  if (isQuoteVisit)        descParts.push('Created by KECC CRM · Quote Visit')
  else                     descParts.push(`Service: ${job.serviceName}`)
  descParts.push(`Status: ${job.status}`)
  descParts.push(`CRM Job ID: ${job.id}`)

  const description = descParts.join('\n')

  // Build start/end — prefer scheduled_time for quote visits, else use all-day
  if (job.scheduledDate && job.scheduledTime) {
    // Timed event — use Eastern Time as default (business runs ET)
    const tz = 'America/New_York'
    const start = `${job.scheduledDate}T${job.scheduledTime}:00`
    // Default duration: 1 hour for quote visits, 2 hours for jobs
    const durationMs = isQuoteVisit ? 60 * 60 * 1000 : 2 * 60 * 60 * 1000
    const endDate = new Date(new Date(`${start}-05:00`).getTime() + durationMs)
    const endHHMM = endDate.toTimeString().slice(0, 5)
    return {
      summary:     title,
      description,
      location:    job.customerAddress ?? undefined,
      start: { dateTime: `${job.scheduledDate}T${job.scheduledTime}:00`, timeZone: tz },
      end:   { dateTime: `${job.scheduledDate}T${endHHMM}:00`,           timeZone: tz },
      colorId: isQuoteVisit ? '3' : '2',  // 3=purple, 2=sage/green
    }
  } else if (job.scheduledDate) {
    // All-day event
    return {
      summary:     title,
      description,
      location:    job.customerAddress ?? undefined,
      start: { date: job.scheduledDate },
      end:   { date: job.scheduledDate },
      colorId: isQuoteVisit ? '3' : '2',
    }
  } else {
    // No date — create a reminder-style event for today
    const today = new Date().toISOString().slice(0, 10)
    return {
      summary:     `[Unscheduled] ${title}`,
      description,
      start: { date: today },
      end:   { date: today },
      colorId: '8',  // gray
    }
  }
}

// ── Sync operations ───────────────────────────────────────────────────────────

/** Create or update a Google Calendar event for a job. Returns the Google event ID. */
export async function syncJobToGoogle(job: JobForSync): Promise<string | null> {
  try {
    const auth = await ensureValidToken()
    if (!auth) return null  // not connected — silent no-op

    const { accessToken, calendarId } = auth
    const eventBody = buildGoogleEvent(job)
    const encoded   = encodeURIComponent(calendarId)

    let googleEventId: string

    if (job.googleEventId) {
      // UPDATE existing event
      const res = await fetch(
        `${GOOGLE_CAL_BASE}/calendars/${encoded}/events/${job.googleEventId}`,
        {
          method:  'PUT',
          headers: {
            Authorization:  `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventBody),
        }
      )
      if (!res.ok) {
        const body = await res.text()
        // If the event was deleted on Google's side, fall through to create
        if (res.status === 404) {
          return await createGoogleEvent(accessToken, encoded, eventBody, job.id)
        }
        throw new Error(`Google Calendar update failed (${res.status}): ${body}`)
      }
      const json = await res.json() as { id: string }
      googleEventId = json.id
    } else {
      // CREATE new event
      googleEventId = await createGoogleEvent(accessToken, encoded, eventBody, job.id)
    }

    // Persist google_event_id back to the jobs row
    await supabase.from('jobs').update({ google_event_id: googleEventId }).eq('id', job.id)

    return googleEventId
  } catch (err) {
    console.error('[_google] syncJobToGoogle error:', err)
    return null  // fire-and-forget — caller doesn't need to know
  }
}

async function createGoogleEvent(
  accessToken: string,
  encodedCalId: string,
  eventBody: Record<string, unknown>,
  jobId: string,
): Promise<string> {
  const res = await fetch(
    `${GOOGLE_CAL_BASE}/calendars/${encodedCalId}/events`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Calendar create failed (${res.status}): ${body}`)
  }
  const json = await res.json() as { id: string }
  console.log(`[_google] Created Google event ${json.id} for job ${jobId}`)
  return json.id
}

/** Delete a Google Calendar event (when a job is deleted from the CRM). */
export async function deleteGoogleEvent(googleEventId: string): Promise<void> {
  try {
    const auth = await ensureValidToken()
    if (!auth) return

    const { accessToken, calendarId } = auth
    const encoded = encodeURIComponent(calendarId)

    const res = await fetch(
      `${GOOGLE_CAL_BASE}/calendars/${encoded}/events/${googleEventId}`,
      {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    // 204 = deleted, 410 = already gone — both are fine
    if (!res.ok && res.status !== 410) {
      console.error(`[_google] deleteGoogleEvent failed (${res.status})`)
    }
  } catch (err) {
    console.error('[_google] deleteGoogleEvent error:', err)
  }
}
