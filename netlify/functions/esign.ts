import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

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

// Build the self-contained HTML signing page
function buildSigningPage(opts: {
  token: string
  docType: 'quote' | 'agreement'
  customerName: string
  companyName: string
  logoUrl: string | null
  lineItems: Array<{ name: string; total: string }>
  grandTotal: string
  docTitle: string
  alreadySigned: boolean
}): string {
  const { token, docType, customerName, companyName, logoUrl, lineItems, grandTotal, docTitle, alreadySigned } = opts

  const lineRows = lineItems.map(li => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;">${li.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap;">${li.total}</td>
    </tr>`).join('')

  const alreadySignedHtml = `
    <div style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <h2 style="color:#3d6b35;margin:0 0 8px;">Already Signed</h2>
      <p style="color:#666;font-size:14px;">This document has already been signed. You may close this window.</p>
    </div>`

  const signingHtml = `
    <form id="signForm">
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">
          Sign below
        </label>
        <div style="position:relative;border:2px solid #ccc;border-radius:8px;background:#fff;overflow:hidden;">
          <canvas id="sigCanvas" style="display:block;width:100%;height:150px;cursor:crosshair;touch-action:none;"></canvas>
          <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:none;border:1px solid #ccc;border-radius:4px;padding:2px 10px;font-size:11px;color:#888;cursor:pointer;">Clear</button>
        </div>
        <p style="font-size:11px;color:#999;margin:4px 0 0;">Draw your signature using your finger or mouse</p>
      </div>
      <button type="submit" id="submitBtn" style="width:100%;padding:16px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;transition:opacity .2s;">
        ✓ &nbsp;I Agree &amp; Sign
      </button>
      <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
    </form>
    <p style="font-size:10px;color:#aaa;text-align:center;margin-top:16px;line-height:1.5;">
      By clicking "I Agree &amp; Sign" you acknowledge that you have read and agree to the terms presented above.
      This constitutes a legally binding electronic signature.
    </p>
    <div id="successMsg" style="display:none;text-align:center;padding:32px 0;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <h2 style="color:#3d6b35;margin:0 0 8px;">Thank you!</h2>
      <p style="color:#666;font-size:14px;">Your signature has been received. You may close this window.</p>
    </div>
    <script>
    (function() {
      var TOKEN = '${token}';
      var FUNC_URL = '/.netlify/functions/esign?token=' + TOKEN;
      var canvas = document.getElementById('sigCanvas');
      var ctx = canvas.getContext('2d');
      var drawing = false;
      var hasSig = false;
      var dpr = window.devicePixelRatio || 1;

      function resize() {
        var rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      resize();

      function getPos(e) {
        var rect = canvas.getBoundingClientRect();
        var src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - rect.left, y: src.clientY - rect.top };
      }

      canvas.addEventListener('mousedown', function(e) { drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
      canvas.addEventListener('mousemove', function(e) { if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; });
      canvas.addEventListener('mouseup', function() { drawing = false; });
      canvas.addEventListener('mouseleave', function() { drawing = false; });
      canvas.addEventListener('touchstart', function(e) { e.preventDefault(); drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
      canvas.addEventListener('touchmove', function(e) { e.preventDefault(); if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; }, { passive: false });
      canvas.addEventListener('touchend', function() { drawing = false; });

      document.getElementById('clearBtn').addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        hasSig = false;
      });

      document.getElementById('signForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var err = document.getElementById('errMsg');
        if (!hasSig) { err.textContent = 'Please draw your signature before submitting.'; err.style.display = 'block'; return; }
        err.style.display = 'none';
        var btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting…';
        var sigData = canvas.toDataURL('image/png');
        fetch(FUNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureData: sigData })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            document.getElementById('signForm').style.display = 'none';
            document.getElementById('successMsg').style.display = 'block';
          } else {
            err.textContent = d.message || 'An error occurred. Please try again.';
            err.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '✓ I Agree & Sign';
          }
        })
        .catch(function() {
          err.textContent = 'Network error. Please check your connection and try again.';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '✓ I Agree & Sign';
        });
      });
    })();
    </script>`

  const logoImg = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:60px;max-width:140px;object-fit:contain;display:block;margin:0 auto 8px;" />`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${docTitle} — ${companyName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #1a1a1a; }
    .card { background: #fff; max-width: 480px; margin: 0 auto; min-height: 100dvh; padding: 24px 20px 40px; }
    @media (min-width: 520px) { .card { margin: 24px auto; min-height: auto; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.08); } }
    .divider { border: none; border-top: 1px solid #eee; margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: 700; font-size: 16px; padding: 10px 8px 4px; }
  </style>
</head>
<body>
<div class="card">
  <div style="text-align:center;margin-bottom:16px;">
    ${logoImg}
    <h1 style="font-size:18px;font-weight:700;margin:0 0 2px;">${companyName}</h1>
    <p style="font-size:13px;color:#888;margin:0;">${docTitle}</p>
  </div>
  <hr class="divider" />
  <div style="margin-bottom:12px;">
    <p style="margin:0 0 4px;font-size:13px;color:#555;">Prepared for:</p>
    <p style="margin:0;font-size:15px;font-weight:600;">${customerName}</p>
  </div>
  <table>
    <tbody>
      ${lineRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td>Total</td>
        <td style="text-align:right;">${grandTotal}</td>
      </tr>
    </tfoot>
  </table>
  <hr class="divider" />
  ${alreadySigned ? alreadySignedHtml : signingHtml}
</div>
</body>
</html>`
}

function fmt(n: number): string {
  return '$' + n.toFixed(2)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const token = event.queryStringParameters?.token
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h1>Missing token</h1>' }
  }

  // Look up token in both quotes and service_agreements
  const [quoteRes, agreementRes, settingsRes] = await Promise.all([
    supabase.from('quotes').select('*').eq('accept_token', token).maybeSingle(),
    supabase.from('service_agreements').select('*').eq('accept_token', token).maybeSingle(),
    supabase.from('company_settings').select('*').limit(1).single(),
  ])

  const quote = quoteRes.data
  const agreement = agreementRes.data
  const settings = settingsRes.data

  const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'
  const logoUrl = settings?.logo_url ?? null

  // ── GET: serve signing page ──────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (!quote && !agreement) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Link not found</h2><p>This link is invalid or has expired.</p></body></html>',
      }
    }

    if (quote) {
      const lineItems = (Array.isArray(quote.line_items) ? quote.line_items : []).map((li: { serviceName?: string; lineTotal?: number; monthlyAmount?: number; isSubscription?: boolean }) => ({
        name: li.serviceName ?? '',
        total: li.isSubscription ? `${fmt(li.monthlyAmount ?? li.lineTotal ?? 0)}/mo` : fmt(li.lineTotal ?? 0),
      }))
      const html = buildSigningPage({
        token,
        docType: 'quote',
        customerName: quote.customer_name ?? '',
        companyName,
        logoUrl,
        lineItems,
        grandTotal: fmt(Number(quote.total ?? 0)),
        docTitle: 'Service Estimate',
        alreadySigned: !!quote.signed_at,
      })
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html }
    }

    if (agreement) {
      const html = buildSigningPage({
        token,
        docType: 'agreement',
        customerName: agreement.customer_name ?? '',
        companyName,
        logoUrl,
        lineItems: [],
        grandTotal: '',
        docTitle: 'Service Agreement',
        alreadySigned: !!agreement.signed_at,
      })
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html }
    }
  }

  // ── POST: receive signature ──────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    if (!quote && !agreement) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ success: false, message: 'Invalid token' }) }
    }

    let body: { signatureData?: string } = {}
    try { body = JSON.parse(event.body ?? '{}') } catch { /* ignore */ }

    if (!body.signatureData) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, message: 'signatureData required' }) }
    }

    const signedAt = new Date().toISOString()
    const signedIp = event.headers['x-forwarded-for']?.split(',')[0].trim() ?? null

    if (quote) {
      // Already signed?
      if (quote.signed_at) {
        return { statusCode: 409, headers: CORS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
      }

      const { error } = await supabase.from('quotes').update({
        status: 'accepted',
        signed_at: signedAt,
        signature_data: body.signatureData,
        signed_ip: signedIp,
      }).eq('id', quote.id)
      if (error) throw error

      // Log activity (find contact_id if available)
      if (quote.contact_id) {
        await supabase.from('activities').insert({
          contact_id: quote.contact_id,
          type: 'esign_completed',
          summary: `Quote signed by ${quote.customer_name}`,
          metadata: { quoteId: quote.id },
        })
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, documentType: 'quote', customerName: quote.customer_name }) }
    }

    if (agreement) {
      // Already signed?
      if (agreement.signed_at) {
        return { statusCode: 409, headers: CORS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
      }

      const { error: agErr } = await supabase.from('service_agreements').update({
        status: 'signed',
        signed_at: signedAt,
        signature_data: body.signatureData,
        signed_ip: signedIp,
      }).eq('id', agreement.id)
      if (agErr) throw agErr

      // Activate linked subscription
      if (agreement.subscription_id) {
        await supabase.from('subscriptions').update({
          status: 'ACTIVE',
          agreement_id: agreement.id,
        }).eq('id', agreement.subscription_id)
      }

      // Log activity
      await supabase.from('activities').insert({
        contact_id: agreement.contact_id,
        type: 'esign_completed',
        summary: `Service agreement signed by ${agreement.customer_name}`,
        metadata: { agreementId: agreement.id, subscriptionId: agreement.subscription_id },
      })

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, documentType: 'agreement', customerName: agreement.customer_name }) }
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
}
