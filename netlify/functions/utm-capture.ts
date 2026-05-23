/**
 * UTM / gclid capture endpoint.
 *
 * Called by the public-facing lead form (and any other public landing page)
 * on first load if the URL carries UTM params or a Google Ads gclid. Matches
 * the params against an active campaign and, if found:
 *
 *   1. Logs a 'click' event on that campaign (with gclid in metadata).
 *   2. Sets the kecc_campaign + kecc_utm_source cookies so subsequent form
 *      submissions, phone clicks, etc. inherit the campaign attribution.
 *
 * This is the Google Ads / Meta / generic-UTM equivalent of the QR-redirect
 * tracker (/track) — same outcome (cookie + event) but no redirect, since
 * the visitor is already on the destination page.
 *
 * Usage from a landing page:
 *   fetch('/.netlify/functions/utm-capture', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       utmSource: 'google_ads',
 *       utmCampaign: 'spring_promo',
 *       gclid: 'CjwKCAjw...',
 *       page: window.location.pathname,
 *     }),
 *     credentials: 'include',
 *   })
 *
 * Matching priority:
 *   1. Exact utm_campaign match on an active campaign
 *   2. utm_source match on an active campaign
 *   3. No match → still log a generic 'click' event with no campaign_id (so
 *      we can see paid traffic that didn't map to any known campaign)
 *
 * Bot filtering: the same UA regex as /track is applied — link unfurlers and
 * crawlers don't get cookies and don't generate events.
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

const BOT_UA_RE = /(bot|crawl|spider|slurp|preview|unfurl|fetch|monitor|headless|lighthouse|chrome-lighthouse|curl|wget|python-requests|http-client|node-fetch|axios|go-http-client|facebookexternalhit|whatsapp|telegrambot|slackbot|skypeuripreview|twitterbot|linkedinbot|pinterest|redditbot|discordbot|applebot|googlebot|bingbot|yandex|baidu|duckduckbot|ahrefsbot|semrushbot|mj12bot|dotbot|chatgpt|gptbot|claudebot|perplexitybot)/i

function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return true
  return BOT_UA_RE.test(ua)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const userAgent = event.headers['user-agent'] ?? event.headers['User-Agent'] ?? null
  if (isBotUserAgent(userAgent)) {
    // Bot — no cookie, no event, but return 200 so the page doesn't error
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ campaignId: null, skipped: 'bot' }) }
  }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const utmSource:   string | null = body.utmSource   ?? null
    const utmMedium:   string | null = body.utmMedium   ?? null
    const utmCampaign: string | null = body.utmCampaign ?? null
    const gclid:       string | null = body.gclid       ?? null
    const page:        string | null = body.page        ?? null

    // Need at least one signal to bother matching
    if (!utmSource && !utmCampaign && !gclid) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ campaignId: null, skipped: 'no-signal' }) }
    }

    // Resolve campaign
    let campaignId: string | null = null
    if (utmCampaign) {
      const { data } = await supabase
        .from('campaigns')
        .select('id')
        .eq('utm_campaign', utmCampaign)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (data?.id) campaignId = data.id
    }
    if (!campaignId && utmSource) {
      const { data } = await supabase
        .from('campaigns')
        .select('id')
        .eq('utm_source', utmSource)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (data?.id) campaignId = data.id
    }
    // gclid implies Google Ads even without explicit UTM tagging
    if (!campaignId && gclid) {
      const { data } = await supabase
        .from('campaigns')
        .select('id')
        .eq('utm_source', 'google_ads')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (data?.id) campaignId = data.id
    }

    // 5-minute dedup: same campaign + same gclid (or same IP if no gclid)
    // should not fire two clicks. Catches reloads and SPA double-mounts.
    const ip = (event.headers['x-forwarded-for'] ?? event.headers['X-Forwarded-For'] ?? '')
      .split(',')[0]?.trim() || event.headers['client-ip'] || null
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const dedupKey = gclid ? { gclid } : ip ? { ip } : null
    let isDuplicate = false
    if (campaignId && dedupKey) {
      const { data: recent } = await supabase
        .from('campaign_events')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('event_type', 'click')
        .gte('created_at', fiveMinAgo)
        .contains('metadata', dedupKey)
        .limit(1)
        .maybeSingle()
      if (recent) isDuplicate = true
    }

    if (!isDuplicate) {
      await supabase.from('campaign_events').insert({
        campaign_id: campaignId,
        event_type: 'click',
        metadata: {
          utmSource, utmMedium, utmCampaign, gclid, page, ip,
          ua: userAgent?.slice(0, 200) ?? null,
        },
      })
    }

    const maxAge = 2592000 // 30 days
    const cookies = campaignId
      ? [
          `kecc_campaign=${campaignId}; Max-Age=${maxAge}; Path=/; SameSite=Lax`,
          `kecc_utm_source=${utmSource ?? ''}; Max-Age=${maxAge}; Path=/; SameSite=Lax`,
        ]
      : []

    return {
      statusCode: 200,
      headers: CORS,
      multiValueHeaders: cookies.length ? { 'Set-Cookie': cookies } : undefined,
      body: JSON.stringify({ campaignId, duplicate: isDuplicate }),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
