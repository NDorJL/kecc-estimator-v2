import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Simple embeddable lead capture form HTML
const FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Request a Quote</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; padding: 24px; }
  .form-wrap { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 16px; }
  label { display: block; font-size: 0.75rem; font-weight: 600; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  input, select, textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.9rem; outline: none; transition: border-color 0.15s; }
  input:focus, select:focus, textarea:focus { border-color: #3b82f6; }
  .field { margin-bottom: 14px; }
  button { width: 100%; padding: 12px; background: #16a34a; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 4px; }
  button:hover { background: #15803d; }
  .success { display: none; padding: 16px; background: #dcfce7; border-radius: 8px; color: #166534; font-weight: 500; text-align: center; margin-top: 16px; }
  .error-msg { color: #dc2626; font-size: 0.8rem; margin-top: 6px; display: none; }
</style>
</head>
<body>
<div class="form-wrap">
  <h2>Request a Free Quote</h2>
  <form id="leadForm">
    <div class="field">
      <label for="name">Full Name *</label>
      <input type="text" id="name" name="name" placeholder="John Smith" required />
    </div>
    <div class="field">
      <label for="phone">Phone Number *</label>
      <input type="tel" id="phone" name="phone" placeholder="(865) 555-0100" required />
    </div>
    <div class="field">
      <label for="email">Email Address</label>
      <input type="email" id="email" name="email" placeholder="john@example.com" />
    </div>
    <div class="field">
      <label for="address">Service Address</label>
      <input type="text" id="address" name="address" placeholder="123 Main St, Knoxville, TN" />
    </div>
    <div class="field">
      <label for="service">Service Interest</label>
      <select id="service" name="service">
        <option value="">Select a service…</option>
        <option value="Lawn Care">Lawn Care / Mowing</option>
        <option value="Landscaping">Landscaping</option>
        <option value="Mulching">Mulching</option>
        <option value="Leaf Removal">Leaf Removal</option>
        <option value="Snow Removal">Snow Removal</option>
        <option value="Hardscaping">Hardscaping</option>
        <option value="Other">Other</option>
      </select>
    </div>
    <div class="field">
      <label for="notes">Additional Notes</label>
      <textarea id="notes" name="notes" rows="3" placeholder="Tell us more about your property or needs…"></textarea>
    </div>
    <button type="submit" id="submitBtn">Request My Free Quote</button>
    <p class="error-msg" id="errorMsg">Something went wrong. Please try again.</p>
  </form>
  <div class="success" id="successMsg">
    Thanks! We'll be in touch shortly to schedule your free estimate.
  </div>
</div>
<script>
// On page load: capture campaign attribution via UTM/gclid if present.
// If the URL has no UTM signals AND no campaign cookie, log an organic
// page-view event so the Marketing page can count direct/organic traffic.
// sessionStorage de-dup so reloads in the same tab don't multiply the count.
(function() {
  try {
    if (sessionStorage.getItem('kecc_pv_logged')) return;
    sessionStorage.setItem('kecc_pv_logged', '1');

    function readCookie(name) {
      var prefix = name + '=';
      var parts = (document.cookie || '').split(';');
      for (var i = 0; i < parts.length; i++) {
        var c = parts[i].trim();
        if (c.indexOf(prefix) === 0) return decodeURIComponent(c.substring(prefix.length));
      }
      return null;
    }

    var qs = new URLSearchParams(window.location.search);
    var utmSource   = qs.get('utm_source');
    var utmMedium   = qs.get('utm_medium');
    var utmCampaign = qs.get('utm_campaign');
    var gclid       = qs.get('gclid');
    var hasUtm      = !!(utmSource || utmCampaign || gclid);
    var hasCookie   = !!readCookie('kecc_campaign');

    if (hasUtm) {
      fetch('/.netlify/functions/utm-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          utmSource: utmSource, utmMedium: utmMedium,
          utmCampaign: utmCampaign, gclid: gclid,
          page: window.location.pathname,
        }),
      }).catch(function() {/* non-fatal */});
    } else if (!hasCookie) {
      // Truly organic: no UTM, no prior campaign attribution. Log a
      // page_view event with no campaign_id — the Marketing page rolls
      // these up as "Organic".
      fetch('/.netlify/functions/campaign-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'page_view',
          metadata: {
            page: window.location.pathname,
            referrer: document.referrer || null,
          },
        }),
      }).catch(function() {/* non-fatal */});
    }
  } catch (_e) { /* non-fatal */ }
})();
document.getElementById('leadForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const errMsg = document.getElementById('errorMsg');
  btn.textContent = 'Sending…';
  btn.disabled = true;
  errMsg.style.display = 'none';
  // Read campaign cookie set by /track redirect (same-origin) so we can pass
  // the campaign attribution along with the form submission. For cross-origin
  // embeds the cookie may not be present; the server still has its own fallback.
  function readCookie(name) {
    var prefix = name + '=';
    var parts = (document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].trim();
      if (c.indexOf(prefix) === 0) return decodeURIComponent(c.substring(prefix.length));
    }
    return null;
  }
  // Also surface any UTM params from the landing URL — useful if the visitor
  // arrived via Google Ads / Meta with a gclid and a UTM-tagged link.
  var qs = new URLSearchParams(window.location.search);
  var payload = {
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    email: document.getElementById('email').value || null,
    address: document.getElementById('address').value || null,
    serviceInterest: document.getElementById('service').value || null,
    notes: document.getElementById('notes').value || null,
    campaignId: readCookie('kecc_campaign') || null,
    utmSource:   qs.get('utm_source')   || readCookie('kecc_utm_source') || null,
    utmMedium:   qs.get('utm_medium')   || null,
    utmCampaign: qs.get('utm_campaign') || null,
    gclid:       qs.get('gclid')        || null,
  };
  try {
    const res = await fetch('/.netlify/functions/lead-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Server error');
    document.getElementById('leadForm').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
  } catch (_e) {
    btn.textContent = 'Request My Free Quote';
    btn.disabled = false;
    errMsg.style.display = 'block';
  }
});
</script>
</body>
</html>`

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Serve embeddable form
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
      body: FORM_HTML,
    }
  }

  // Handle form submission
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body ?? '{}')
      const { name, phone, email, address, serviceInterest, notes } = body

      if (!name || !phone) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Name and phone are required' }),
        }
      }

      // ── Resolve campaign attribution ──────────────────────────────────────
      // Priority order:
      //   1. campaignId in body (set by the embedded form's JS from the
      //      kecc_campaign cookie or, on cross-origin embeds, however the
      //      embedding page injected it)
      //   2. kecc_campaign cookie sent with the request (same-origin)
      //   3. utm_source / utm_campaign in body → look up matching campaign
      //   4. null (unattributed)
      let campaignId: string | null = body.campaignId ?? null

      if (!campaignId) {
        // Parse cookies from the request header (server-side fallback)
        const cookieHeader = event.headers.cookie ?? event.headers.Cookie ?? ''
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(p => {
            const idx = p.indexOf('=')
            if (idx < 0) return ['', '']
            return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())]
          }).filter(([k]) => k)
        )
        if (cookies['kecc_campaign']) campaignId = cookies['kecc_campaign']
      }

      if (!campaignId && (body.utmSource || body.utmCampaign)) {
        // Match active campaign by UTM source / campaign tag
        let q = supabase.from('campaigns').select('id').eq('status', 'active').limit(1)
        if (body.utmCampaign) q = q.eq('utm_campaign', body.utmCampaign)
        else if (body.utmSource) q = q.eq('utm_source', body.utmSource)
        const { data: match } = await q.maybeSingle()
        if (match?.id) campaignId = match.id
      }

      // Create contact
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          name,
          phone: phone ?? null,
          email: email ?? null,
          source: 'website',
          type: 'residential',
        })
        .select()
        .single()

      if (contactError) throw contactError

      // Add property if address provided
      if (address) {
        await supabase.from('properties').insert({
          contact_id: contact.id,
          address,
          type: 'residential',
        })
      }

      // Create lead — now with campaign attribution wired through
      await supabase.from('leads').insert({
        contact_id: contact.id,
        stage: 'new',
        source: 'website',
        campaign_id: campaignId,
        service_interest: serviceInterest ?? null,
        notes: notes ?? null,
      })

      // Log a form_submit event on the campaign so the Marketing page can
      // distinguish "form leads" from "phone-click leads"
      if (campaignId) {
        supabase.from('campaign_events').insert({
          campaign_id: campaignId,
          event_type: 'form_submit',
          metadata: { utmSource: body.utmSource ?? null, gclid: body.gclid ?? null },
        }).then(() => {/* fire-and-forget */}).catch(() => {/* non-fatal */})
      }

      // Log activity
      await supabase.from('activities').insert({
        contact_id: contact.id,
        type: 'note',
        summary: `Lead submitted via website form${serviceInterest ? ` — ${serviceInterest}` : ''}`,
      })

      return {
        statusCode: 201,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, contactId: contact.id }),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: message }),
      }
    }
  }

  return {
    statusCode: 405,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' }),
  }
}
