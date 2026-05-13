/**
 * Campaign redirect + tracking handler.
 *
 * Usage:
 *   /.netlify/functions/track?c=<redirect_token>
 *
 * Flow:
 *   1. Look up campaign by redirect_token
 *   2. Log a 'scan' event to campaign_events
 *   3. Set kecc_campaign cookie (7-day, SameSite=Lax) on the response
 *   4. 302-redirect to destination_url (or homepage if not set / campaign not found)
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Netlify auto-sets URL to the deploy's canonical URL
const HOMEPAGE = process.env.URL ?? 'https://kecc-estimator-v2.netlify.app'

export const handler: Handler = async (event) => {
  // Only accept GET requests (links / QR scans)
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const token = event.queryStringParameters?.c

  // No token → bounce to homepage immediately (no cookie)
  if (!token) {
    return { statusCode: 302, headers: { Location: HOMEPAGE }, body: '' }
  }

  try {
    // Look up campaign by redirect_token
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('id, destination_url, status, utm_source')
      .eq('redirect_token', token)
      .maybeSingle()

    // Unknown token → bounce to homepage (no cookie, no event)
    if (error || !campaign) {
      return { statusCode: 302, headers: { Location: HOMEPAGE }, body: '' }
    }

    // Log scan event — non-fatal; don't block the redirect
    supabase
      .from('campaign_events')
      .insert({ campaign_id: campaign.id, event_type: 'scan' })
      .then(() => {/* fire-and-forget */})
      .catch(() => {/* non-fatal */})

    const destination = campaign.destination_url ?? HOMEPAGE
    const maxAge = 2592000 // 30 days in seconds

    // Two cookies — must use multiValueHeaders; a plain headers object
    // would silently drop the second Set-Cookie due to duplicate key collision.
    const cookies = [
      `kecc_campaign=${campaign.id}; Max-Age=${maxAge}; Path=/; SameSite=Lax`,
      `kecc_utm_source=${campaign.utm_source ?? ''}; Max-Age=${maxAge}; Path=/; SameSite=Lax`,
    ]

    return {
      statusCode: 302,
      headers: {
        Location: destination,
        'Cache-Control': 'no-store',
      },
      multiValueHeaders: {
        'Set-Cookie': cookies,
      },
      body: '',
    }
  } catch (err: unknown) {
    // On any unexpected error, silently redirect to homepage
    console.error('[track] Unexpected error:', err instanceof Error ? err.message : err)
    return { statusCode: 302, headers: { Location: HOMEPAGE }, body: '' }
  }
}
