/**
 * Campaign redirect + tracking handler.
 *
 * Usage:
 *   /.netlify/functions/track?c=<redirect_token>
 *
 * Flow:
 *   1. Look up campaign by redirect_token
 *   2. Log a 'scan' event to campaign_events (unless caller is a bot/preview-er)
 *   3. Set kecc_campaign cookie (30-day, SameSite=Lax) on the response
 *   4. 302-redirect to destination_url (or homepage if not set / campaign not found)
 *
 * Bot/preview filtering:
 *   Link unfurlers (Slack, iMessage, Facebook, WhatsApp, etc.) and search-engine
 *   crawlers hit /track URLs whenever the link is shared. We still redirect them
 *   (so the link works for legit users behind weird UAs) but skip the scan
 *   event so they don't inflate campaign counts.
 *
 * Dedup:
 *   A scan event from the same IP for the same campaign within 30 seconds is
 *   skipped — covers accidental double-taps and reloads without losing distinct
 *   visits.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Netlify auto-sets URL to the deploy's canonical URL
const HOMEPAGE = process.env.URL ?? 'https://kecc-estimator-v2.netlify.app'

// Matches common bot/crawler/link-preview User-Agent signatures.
// Tested against the actual UAs of: Slack, Discord, Telegram, WhatsApp, iMessage,
// Apple (Mail/Messages), Facebook, Twitter/X, LinkedIn, Pinterest, Reddit,
// Skype, Snapchat, Googlebot, Bingbot, Yandex, Baidu, DuckDuckBot, Applebot,
// AhrefsBot, SemrushBot, MJ12bot, dotbot, headless browsers, curl, wget, etc.
const BOT_UA_RE = /(bot|crawl|spider|slurp|preview|unfurl|fetch|monitor|headless|lighthouse|chrome-lighthouse|curl|wget|python-requests|http-client|node-fetch|axios|go-http-client|facebookexternalhit|whatsapp|telegrambot|slackbot|skypeuripreview|twitterbot|linkedinbot|pinterest|redditbot|discordbot|applebot|googlebot|bingbot|yandex|baidu|duckduckbot|ahrefsbot|semrushbot|mj12bot|dotbot|chatgpt|gptbot|claudebot|perplexitybot)/i

function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return true // empty/missing UA is almost always a bot
  return BOT_UA_RE.test(ua)
}

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

  // Capture caller signals before any work — used for filtering and dedup
  const userAgent = event.headers['user-agent'] ?? event.headers['User-Agent'] ?? null
  const ip = (event.headers['x-forwarded-for'] ?? event.headers['X-Forwarded-For'] ?? '')
    .split(',')[0]?.trim() || event.headers['client-ip'] || null
  const isBot = isBotUserAgent(userAgent)

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

    // Only log a scan event for real users. Bots/previewers still get the
    // redirect (their UA detection might be wrong, but they don't count).
    if (!isBot) {
      // 30-second dedup: skip if the same IP just scanned this campaign.
      // Covers double-taps, reloads, and the "redirect-back" pattern when
      // a user opens the link in two apps within a few seconds.
      let isDuplicate = false
      if (ip) {
        const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString()
        const { data: recent } = await supabase
          .from('campaign_events')
          .select('id')
          .eq('campaign_id', campaign.id)
          .eq('event_type', 'scan')
          .gte('created_at', thirtySecondsAgo)
          .contains('metadata', { ip })
          .limit(1)
          .maybeSingle()
        if (recent) isDuplicate = true
      }

      if (!isDuplicate) {
        // Log scan event — non-fatal; don't block the redirect
        supabase
          .from('campaign_events')
          .insert({
            campaign_id: campaign.id,
            event_type: 'scan',
            metadata: { ip, ua: userAgent?.slice(0, 200) ?? null },
          })
          .then(() => {/* fire-and-forget */})
          .catch(() => {/* non-fatal */})
      }
    }

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
