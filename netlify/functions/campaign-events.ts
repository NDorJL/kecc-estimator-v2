import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToCampaignEvent } from '../../src/types'
import { requireAuth } from './_auth'

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

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const method = event.httpMethod

  try {
    // ── LIST events ─────────────────────────────────────────────────────────
    // Optional filters: ?campaignId=<uuid>  ?eventType=view|click|scan
    //                   ?since=<ISO>        ?until=<ISO>
    if (method === 'GET') {
      // Admin-only (Marketing dashboard). POST below stays public — it's the tracking pixel.
      const unauthorized = requireAuth(event, CORS)
      if (unauthorized) return unauthorized
      const campaignId = event.queryStringParameters?.campaignId
      const eventType  = event.queryStringParameters?.eventType
      const since      = event.queryStringParameters?.since
      const until      = event.queryStringParameters?.until

      let query = supabase
        .from('campaign_events')
        .select('*')
        .order('created_at', { ascending: false })

      if (campaignId) query = query.eq('campaign_id', campaignId)
      if (eventType)  query = query.eq('event_type', eventType)
      if (since)      query = query.gte('created_at', since)
      if (until)      query = query.lte('created_at', until)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToCampaignEvent)) }
    }

    // ── RECORD an event ─────────────────────────────────────────────────────
    // Called by the campaign redirect handler or any front-end tracking pixel.
    // Body: { campaignId, eventType }  OR  ?token=<redirect_token> resolves campaignId
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      let campaignId = body.campaignId as string | null

      // Allow recording via redirect_token (no UUID required by the caller)
      if (!campaignId && body.redirectToken) {
        const { data: row } = await supabase
          .from('campaigns')
          .select('id')
          .eq('redirect_token', body.redirectToken)
          .maybeSingle()
        campaignId = row?.id ?? null
      }

      if (!body.eventType) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'eventType is required' }) }
      }

      const { data, error } = await supabase
        .from('campaign_events')
        .insert({
          campaign_id: campaignId ?? null,
          event_type:  body.eventType,
          metadata:    body.metadata ?? {},
        })
        .select()
        .single()
      if (error) throw new Error(error.message)

      // ── Auto-create a lead stub on phone_click — ONLY when the caller
      // matches an existing contact. Anonymous taps (no contact match) are
      // recorded as click events only. Otherwise every tap inflates the
      // marketing "leads" count, since most website visitors don't have a
      // pre-existing contact record. The click itself is still tracked on
      // the campaign and displayed in the Clicks column on the Marketing
      // page — we just don't promote it to a "lead" without evidence that
      // a real person on the other end intends to do business.
      if (body.eventType === 'phone_click') {
        const phoneNumber = (body.metadata?.number as string | null) ?? null
        const page        = (body.metadata?.page   as string | null) ?? null

        // Try to match an existing contact by phone number
        let contactId: string | null = null
        if (phoneNumber) {
          const { data: contact } = await supabase
            .from('contacts')
            .select('id')
            .eq('phone', phoneNumber)
            .maybeSingle()
          contactId = contact?.id ?? null
        }

        // Only create a lead stub when we have a matched contact. No match =
        // just an anonymous click; the event is enough.
        if (contactId) {
          // Deduplicate: skip if a source-locked lead already exists for this
          // contact created in the last 4 hours
          const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
          const { data: recent } = await supabase
            .from('leads')
            .select('id')
            .eq('contact_id', contactId)
            .eq('source_locked', true)
            .gte('created_at', fourHoursAgo)
            .maybeSingle()

          if (!recent) {
            const noteLines = [
              '📞 Auto-created from website phone number click.',
              phoneNumber ? `Phone: ${phoneNumber}` : null,
              page ? `Page: ${page}` : null,
              'Fill in name and details during the call.',
            ].filter(Boolean).join('\n')

            // Non-fatal: if lead stub creation fails, the event is still recorded
            try {
              await supabase.from('leads').insert({
                contact_id:    contactId,
                stage:         'new',
                source:        'website',
                source_locked: true,
                campaign_id:   campaignId ?? null,
                notes:         noteLines,
              })
            } catch { /* silent — event is more important than the stub */ }
          }
        }
      }

      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToCampaignEvent(data)) }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
