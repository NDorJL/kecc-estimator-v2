import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Send SMS via OpenPhone API
 *
 * OpenPhone auth: the API key goes directly in the Authorization header
 * with NO "Bearer" prefix.
 * Message body uses "content" (not "body"), and "to" is an array.
 *
 * Set QUO_BASE_URL = https://api.openphone.com/v1 in Netlify env vars.
 */
async function sendQuoSms(apiKey: string, fromNumber: string, toNumber: string, content: string): Promise<void> {
  const baseUrl = (process.env.QUO_BASE_URL ?? 'https://api.openphone.com/v1').replace(/\/$/, '')
  const url = `${baseUrl}/messages`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,           // OpenPhone: raw key, no "Bearer"
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    fromNumber,
      to:      [toNumber],               // OpenPhone expects an array
      content,                           // OpenPhone uses "content" not "body"
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenPhone API error ${res.status} at ${url}: ${text}`)
  }
}

function formatQuoteVisitSms(opts: {
  customerName: string
  dayOfWeek: string
  month: string
  day: number
  year: number
  time: string
  companyName: string
}): string {
  const { customerName, dayOfWeek, month, day, year, time, companyName } = opts
  const firstName = customerName.split(' ')[0]
  return (
    `Hi ${firstName}! 👋 This is ${companyName}. We're looking forward to meeting you!\n\n` +
    `Your FREE estimate visit is confirmed for:\n` +
    `📅 ${dayOfWeek}, ${month} ${day}, ${year} at ${time}\n\n` +
    `We'll come out to your property, take a look at what you need, and put together a custom quote for you — no pressure, no obligation.\n\n` +
    `Questions? Just reply to this message.\n\n` +
    `— ${companyName}\n\n` +
    `This is an automated message. Reply STOP to opt out.`
  )
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const { action } = body

    // Fetch settings (API key + from number)
    const { data: settings } = await supabase.from('company_settings').select('*').limit(1).single()
    const apiKey     = settings?.quo_api_key    ?? process.env.QUO_API_KEY ?? ''
    const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
    const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'

    if (!apiKey || !fromNumber) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Quo API key and from number must be configured in Settings → SMS' }) }
    }

    // ── Send raw message ────────────────────────────────────────────────
    if (action === 'send') {
      const { to, message, contactId } = body
      if (!to || !message) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'to and message required' }) }

      await sendQuoSms(apiKey, fromNumber, to, message)

      // Log activity (non-fatal)
      if (contactId) {
        await supabase.from('activities').insert({
          contact_id: contactId,
          type: 'sms_out',
          summary: message.slice(0, 100),
          metadata: { to },
        }).catch(() => {})
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // ── Send quote visit confirmation ───────────────────────────────────
    if (action === 'quote-visit-confirmation') {
      const { to, customerName, scheduledDate, scheduledTime, contactId } = body
      if (!to || !customerName || !scheduledDate) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'to, customerName, scheduledDate required' }) }
      }

      // Parse date string (YYYY-MM-DD) without timezone issues
      const [yr, mo, dy] = (scheduledDate as string).split('-').map(Number)
      const dateObj = new Date(yr, mo - 1, dy)
      const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
      const month     = dateObj.toLocaleDateString('en-US', { month: 'long' })

      // Format time (HH:MM 24h → 12h AM/PM)
      let timeStr = scheduledTime ?? ''
      if (timeStr) {
        const [hh, mm] = timeStr.split(':').map(Number)
        const ampm = hh >= 12 ? 'PM' : 'AM'
        const h12  = hh % 12 || 12
        timeStr = `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
      }

      const message = formatQuoteVisitSms({
        customerName,
        dayOfWeek,
        month,
        day: dy,
        year: yr,
        time: timeStr || 'TBD',
        companyName,
      })

      await sendQuoSms(apiKey, fromNumber, to, message)

      // Log activity (non-fatal)
      if (contactId) {
        await supabase.from('activities').insert({
          contact_id: contactId,
          type: 'sms_out',
          summary: `Quote visit confirmation sent for ${scheduledDate}${scheduledTime ? ' at ' + scheduledTime : ''}`,
          metadata: { to, scheduledDate, scheduledTime },
        }).catch(() => {})
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message }) }
    }

    // ── Test SMS (send a short test message to the company phone) ──────────
    if (action === 'test') {
      const { to } = body
      if (!to) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'to required' }) }
      await sendQuoSms(apiKey, fromNumber, to, `✅ Test message from ${companyName} CRM. SMS is working correctly.`)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // ── Reschedule notification ────────────────────────────────────────────
    if (action === 'reschedule-notification') {
      const {
        to, customerName, serviceName,
        oldDate, newDate, newWindow,
        reasonType, reasonText, contactId,
      } = body
      if (!to || !customerName || !newDate) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'to, customerName, newDate required' }) }
      }

      const firstName = (customerName as string).split(' ')[0]

      // Format a date string 'YYYY-MM-DD' → 'Monday, April 28'
      function fmtDate(d: string): string {
        const [yr, mo, dy] = (d as string).split('-').map(Number)
        const obj = new Date(yr, mo - 1, dy)
        return obj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      }

      const windowLabels: Record<string, string> = {
        morning: 'in the morning (8 am–12 pm)',
        afternoon: 'in the afternoon (12 pm–5 pm)',
        anytime: '',
      }
      const windowStr = newWindow && windowLabels[newWindow] ? ` ${windowLabels[newWindow]}` : ''
      const newDateFmt = fmtDate(newDate)
      const oldDateFmt = oldDate ? fmtDate(oldDate) : null
      const svc = serviceName ?? 'service appointment'

      let message = ''
      if (reasonType === 'weather') {
        message =
          `Hi ${firstName}! Due to weather conditions, we need to reschedule your ${svc}` +
          (oldDateFmt ? ` originally set for ${oldDateFmt}` : '') + `. ` +
          `Your new appointment is ${newDateFmt}${windowStr}. ` +
          `We apologize for any inconvenience and appreciate your understanding! ` +
          `Call or text us with any questions. — ${companyName}\n\nReply STOP to opt out.`
      } else if (reasonType === 'customer_request') {
        message =
          `Hi ${firstName}! As requested, your ${svc} has been rescheduled to ${newDateFmt}${windowStr}. ` +
          `Looking forward to seeing you then! Call or text us with any questions. ` +
          `— ${companyName}\n\nReply STOP to opt out.`
      } else {
        // 'other' — use custom reason text
        const reason = (reasonText as string)?.trim() || 'an unforeseen circumstance'
        message =
          `Hi ${firstName}! We need to reschedule your ${svc}` +
          (oldDateFmt ? ` originally set for ${oldDateFmt}` : '') + `. ` +
          `Reason: ${reason}. ` +
          `Your new appointment is ${newDateFmt}${windowStr}. ` +
          `Call or text us with any questions. — ${companyName}\n\nReply STOP to opt out.`
      }

      await sendQuoSms(apiKey, fromNumber, to, message)

      if (contactId) {
        await supabase.from('activities').insert({
          contact_id: contactId,
          type: 'sms_out',
          summary: `Reschedule notification sent — new date: ${newDate}${newWindow ? ' (' + newWindow + ')' : ''}`,
          metadata: { to, oldDate, newDate, newWindow, reasonType, reasonText },
        }).catch(() => {})
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message }) }
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Unknown action' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message
      : (err && typeof err === 'object' && 'message' in err) ? String((err as Record<string,unknown>).message)
      : String(err)
    console.error('sms error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message }) }
  }
}
