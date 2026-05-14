/**
 * KECC Click Tracking
 * Logs phone number and email link clicks to the CRM as campaign events.
 * No lead card is created — events are analytics only.
 *
 * Paste the <script> version of this into Squarespace:
 *   Settings → Advanced → Code Injection → Footer
 */
(function () {
  'use strict';

  const CRM_ENDPOINT = 'https://kecc-estimator-v2.netlify.app/.netlify/functions/campaign-events';

  // Read a cookie value by name
  function getCookie(name) {
    const entry = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
    return entry ? entry.trim().slice(name.length + 1) : null;
  }

  // Fire-and-forget POST to campaign-events — never blocks the click
  function logEvent(eventType, extra) {
    const campaignId = getCookie('kecc_campaign') || null;
    const payload = {
      eventType,
      campaignId,          // null if no campaign cookie is set
      metadata: Object.assign({
        page:     window.location.href,
        referrer: document.referrer || null,
      }, extra),
    };

    // Use sendBeacon when available (survives page navigation), fall back to fetch
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(CRM_ENDPOINT, blob);
    } else {
      fetch(CRM_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(function () { /* silent fail — tracking should never break the site */ });
    }
  }

  // Attach listeners once DOM is ready
  function attachListeners() {
    document.addEventListener('click', function (e) {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }
})();
