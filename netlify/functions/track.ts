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
      .select('id, destination_url, status')
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

    // Cookie: 7 days, same-site Lax so it survives the redirect
    const maxAge = 7 * 24 * 60 * 60 // seconds
    const cookie = `kecc_campaign=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax`

    const destination = campaign.destination_url ?? HOMEPAGE

    return {
      statusCode: 302,
      headers: {
        Location: destination,
        'Set-Cookie': cookie,
        // Prevent browsers from caching the redirect
        'Cache-Control': 'no-store',
      },
      body: '',
    }
  } catch (err: unknown) {
    // On any unexpected error, silently redirect to homepage
    console.error('[track] Unexpected error:', err instanceof Error ? err.message : err)
    return { statusCode: 302, headers: { Location: HOMEPAGE }, body: '' }
  }
}
