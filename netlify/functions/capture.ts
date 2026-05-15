/**
 * capture.ts — Universal lead capture endpoint
 *
 * Receives a POST from any inbound source (contact form, landing page,
 * ad platform webhook, etc.) and creates or matches a contact + lead.
 *
 * POST body (JSON):
 *   { name, phone, email, serviceInterest, message,
 *     campaignId?, utmSource?, referrer? }
 *
 * Returns HTTP 201: { leadId, contactId }
 *
 * Required env vars:
 *   SUPABASE_URL        — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
 *
 * Note: existing functions use SUPABASE_SERVICE_ROLE_KEY — add
 * SUPABASE_SERVICE_KEY as an alias in Netlify env vars pointing to
 * the same value, or update this to SUPABASE_SERVICE_ROLE_KEY to match.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fallback campaign for contact form submissions with no UTM or campaign cookie.
// Kept separate from Website/Organic (which tracks clicks) so you can see
// the conversion rate: clicks on Website/Organic → submissions on Contact Form.
const CONTACT_FORM_CAMPAIGN_ID = '9f0ac3ec-2ed2-4dc3-8745-af674dad3ac1'

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ── Source attribution logic ──────────────────────────────────────────────────

function determineSource(
  campaignId: string | undefined,
  utmSource:  string | undefined,
  referrer:   string | undefined,
): string {
  // If a campaignId is present the UTM source is authoritative
  if (campaignId) return utmSource ?? 'website'

  // No campaign — infer from referrer
  const ref = (referrer ?? '').toLowerCase()
  if (!utmSource && ref.includes('google.com'))    return 'seo'
  if (ref.includes('facebook.com') || ref.includes('instagram.com')) return 'social'

  return 'website'
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const {
      name,
      phone,
      email,
      serviceInterest,
      message,
      campaignId: rawCampaignId,
      utmSource,
      utmCampaign,   // slug e.g. 'gbp-listing' — resolve to UUID below
      referrer,
    } = JSON.parse(event.body ?? '{}') as {
      name?:            string
      phone?:           string
      email?:           string
      serviceInterest?: string
      message?:         string
      campaignId?:      string
      utmSource?:       string
      utmCampaign?:     string
      referrer?:        string
    }

    if (!name?.trim()) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'name is required' }) }
    }

    // ── 1. Find existing contact (phone OR email, case-insensitive email) ─────

    let contactId: string

    // Build OR filter — only include clauses for values that were provided
    const orClauses: string[] = []
    if (phone?.trim()) orClauses.push(`phone.eq.${phone.trim()}`)
    if (email?.trim()) orClauses.push(`email.ilike.${email.trim()}`)

    if (orClauses.length > 0) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .or(orClauses.join(','))
        .limit(1)
        .maybeSingle()

      if (existing) {
        // Contact already exists — reuse it
        contactId = existing.id
      } else {
        // ── 2. Insert new contact ─────────────────────────────────────────────
        const { data: created, error: contactErr } = await supabase
          .from('contacts')
          .insert({
            name:          name.trim(),
            phone:         phone?.trim()  ?? null,
            email:         email?.trim()  ?? null,
            type:          'residential',
            source:        utmSource ?? 'website',
            tags:          [],
            custom_fields: {},
          })
          .select('id')
          .single()

        if (contactErr || !created) {
          throw new Error(contactErr?.message ?? 'Failed to create contact')
        }
        contactId = created.id
      }
    } else {
      // No phone or email — still create the contact with name only
      const { data: created, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          name:          name.trim(),
          phone:         null,
          email:         null,
          type:          'residential',
          source:        utmSource ?? 'website',
          tags:          [],
          custom_fields: {},
        })
        .select('id')
        .single()

      if (contactErr || !created) {
        throw new Error(contactErr?.message ?? 'Failed to create contact')
      }
      contactId = created.id
    }

    // ── 3. Resolve campaign ID (priority order) ───────────────────────────────
    //
    //  1. Explicit campaign UUID (from kecc_campaign cookie via QR/track redirect)
    //  2. UTM campaign slug → look up the matching campaign row by utm_campaign column
    //     (covers GBP, Google Ads, and other UTM-tagged digital campaigns)
    //  3. Organic fallback — visitor arrived with no tracking at all
    //     (direct type-in, organic Google search without a GBP click)

    let campaignId: string | null = rawCampaignId ?? null

    if (!campaignId && utmCampaign) {
      const { data: cam } = await supabase
        .from('campaigns')
        .select('id')
        .eq('utm_campaign', utmCampaign)
        .maybeSingle()
      campaignId = cam?.id ?? null
    }

    if (!campaignId) {
      campaignId = CONTACT_FORM_CAMPAIGN_ID
    }

    // ── 4. Determine lead source label ────────────────────────────────────────

    const source = determineSource(campaignId !== WEBSITE_ORGANIC_CAMPAIGN_ID ? campaignId : undefined, utmSource, referrer)

    // ── 5. Build notes ────────────────────────────────────────────────────────

    const notes = (message ?? '').trim()

    // ── 6. Insert lead ────────────────────────────────────────────────────────

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        contact_id:       contactId,
        stage:            'new',
        source,
        service_interest: serviceInterest?.trim() ?? null,
        campaign_id:      campaignId,
        notes:            notes.trim() || null,
      })
      .select('id')
      .single()

    if (leadErr || !lead) {
      throw new Error(leadErr?.message ?? 'Failed to create lead')
    }

    // ── 6. Return 201 ─────────────────────────────────────────────────────────

    return {
      statusCode: 201,
      headers: CORS,
      body: JSON.stringify({ leadId: lead.id, contactId }),
    }

  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as Record<string, unknown>).message)
        : JSON.stringify(err)

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: message }),
    }
  }
}
