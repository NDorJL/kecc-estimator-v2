/**
 * KECC Click Tracking
 *
 * On every page load:
 *   1. If UTM params are present in the URL, stores them as 30-day cookies
 *      so any subsequent action (click, form fill) can read them.
 *   2. If NO campaign cookie is active after that check, plants the
 *      Website / Organic fallback campaign so all organic website
 *      interactions are attributed rather than falling into a black hole.
 *
 * Also logs phone number and email link clicks to the CRM as campaign events.
 * No lead card is created for clicks — events are analytics only.
 *
 * Paste the <script> version of this into Squarespace:
 *   Settings → Advanced → Code Injection → Footer
 */
(function () {
  'use strict';

  const CRM_ENDPOINT = 'https://kecc-estimator-v2.netlify.app/.netlify/functions/campaign-events';

  // Campaign ID for organic website visitors (no UTM, no QR scan).
  // Leads and clicks from these visitors are attributed to the
  // "Website / Organic" campaign in the CRM marketing page.
  const ORGANIC_CAMPAIGN_ID = '8548a349-4fc0-48db-b5a0-cd49f7c94e16';

  // ── Cookie helpers ─────────────────────────────────────────────────────────

  function getCookie(name) {
    var entry = document.cookie.split(';').find(function(c) {
      return c.trim().startsWith(name + '=');
    });
    return entry ? entry.trim().slice(name.length + 1) : null;
  }

  function setCookie(name, value, maxAgeDays) {
    var maxAge = (maxAgeDays || 30) * 24 * 60 * 60;
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; Max-Age=' + maxAge + '; Path=/; SameSite=Lax';
  }

  // ── Step 1: capture UTM params from the current URL ───────────────────────
  // Stores them as cookies so phone/email clicks later in the session
  // can include them in the event payload for backend attribution.

  function captureUtmParams() {
    try {
      var params = new URLSearchParams(window.location.search);
      var utmSource   = params.get('utm_source');
      var utmMedium   = params.get('utm_medium');
      var utmCampaign = params.get('utm_campaign');

      if (utmSource || utmCampaign) {
        if (utmSource)   setCookie('kecc_utm_source',   utmSource,   30);
        if (utmMedium)   setCookie('kecc_utm_medium',   utmMedium,   30);
        if (utmCampaign) setCookie('kecc_utm_campaign', utmCampaign, 30);
        // Note: kecc_campaign (the UUID campaign ID) is set by the track.ts
        // redirect function for QR campaigns. For UTM-only campaigns (GBP,
        // Google Ads) the UUID is resolved server-side in campaign-events.ts.
      }
    } catch (e) { /* never break the page */ }
  }

  // ── Step 2: plant organic fallback if no campaign is active ───────────────
  // Visitors who arrive without a campaign cookie (organic search, direct
  // type-in, social share with no UTM) get attributed to Website / Organic
  // so their actions are visible in the marketing page.

  function ensureOrganicFallback() {
    // Don't override a campaign cookie already set by a QR scan (track.ts)
    // or by a previous page load that had UTMs.
    if (getCookie('kecc_campaign')) return;

    // Also don't set the organic fallback if UTM params were just captured —
    // those visitors will be resolved to a real campaign server-side.
    var hasUtms = !!(getCookie('kecc_utm_source') || getCookie('kecc_utm_campaign'));
    if (hasUtms) return;

    // Pure organic visitor — plant the fallback campaign cookie.
    // Use a 1-day expiry so it doesn't persist longer than a normal session.
    setCookie('kecc_campaign',    ORGANIC_CAMPAIGN_ID, 1);
    setCookie('kecc_utm_source',  'organic',           1);
  }

  // ── Step 3: fire-and-forget event POST ────────────────────────────────────

  function logEvent(eventType, extra) {
    var campaignId  = getCookie('kecc_campaign')  || null;
    var utmSource   = getCookie('kecc_utm_source')   || null;
    var utmCampaign = getCookie('kecc_utm_campaign') || null;

    var payload = {
      eventType: eventType,
      campaignId: campaignId,
      metadata: Object.assign({
        page:       window.location.href,
        referrer:   document.referrer || null,
        utmSource:  utmSource,
        utmCampaign: utmCampaign,
      }, extra),
    };

    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(CRM_ENDPOINT, blob);
    } else {
      fetch(CRM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function() { /* silent fail */ });
    }
  }

  // ── Step 4: attach phone/email click listeners ────────────────────────────

  function attachListeners() {
    document.addEventListener('click', function(e) {
      var target = e.target.closest('a[href]');
      if (!target) return;

      var href = target.getAttribute('href') || '';

      if (href.startsWith('tel:')) {
        logEvent('phone_click', {
          number: href.replace('tel:', '').trim(),
        });
      } else if (href.startsWith('mailto:')) {
        logEvent('email_click', {
          address: href.replace('mailto:', '').split('?')[0].trim(),
        });
      }
    }, { passive: true });
  }

  // ── Initialise ────────────────────────────────────────────────────────────

  captureUtmParams();
  ensureOrganicFallback();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }

})();
