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

interface LineItemData {
  serviceName?: string
  description?: string
  quantity?: number
  unitPrice?: number
  lineTotal?: number
  monthlyAmount?: number
  isSubscription?: boolean
  frequency?: string
}

interface QuotePageOpts {
  token: string
  customerName: string
  customerAddress: string | null
  customerPhone: string | null
  customerEmail: string | null
  businessName: string | null
  companyName: string
  companyAddress: string | null
  companyPhone: string | null
  companyEmail: string | null
  logoUrl: string | null
  quoteId: string
  quoteDate: string
  lineItems: LineItemData[]
  notes: string | null
  quoteFooter: string | null
  alreadySigned: boolean
  signedAt: string | null
}

interface AgreementPageOpts {
  token: string
  customerName: string
  companyName: string
  logoUrl: string | null
  alreadySigned: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildQuoteSigningPage(opts: QuotePageOpts): string {
  const {
    token, customerName, customerAddress, customerPhone, customerEmail, businessName,
    companyName, companyAddress, companyPhone, companyEmail, logoUrl,
    quoteId, quoteDate, lineItems, notes, quoteFooter,
    alreadySigned, signedAt,
  } = opts

  const fmtMoney = (n: number) => '$' + n.toFixed(2)

  const onetimeItems = lineItems.filter(i => !i.isSubscription)
  const subItems = lineItems.filter(i => i.isSubscription)
  const onetimeTotal = onetimeItems.reduce((s, i) => s + (i.lineTotal ?? 0), 0)
  const monthlyTotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal ?? 0), 0)
  const grandTotal = onetimeTotal + monthlyTotal

  const itemRows = lineItems.map(li => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:500;">${esc(li.serviceName ?? '')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;">${esc(li.description ?? '')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:center;">${li.quantity ?? 1}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;white-space:nowrap;">${fmtMoney(li.unitPrice ?? 0)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;white-space:nowrap;font-weight:600;">${li.isSubscription ? fmtMoney(li.monthlyAmount ?? li.lineTotal ?? 0) + '/mo' : fmtMoney(li.lineTotal ?? 0)}</td>
    </tr>`).join('')

  const totalsHtml = `
    ${onetimeTotal > 0 ? `<tr><td colspan="4" style="text-align:right;font-size:13px;color:#666;padding:6px 6px 2px;">One-Time Subtotal:</td><td style="text-align:right;font-size:13px;font-weight:600;padding:6px 6px 2px;">${fmtMoney(onetimeTotal)}</td></tr>` : ''}
    ${monthlyTotal > 0 ? `<tr><td colspan="4" style="text-align:right;font-size:13px;color:#666;padding:2px 6px;">Monthly:</td><td style="text-align:right;font-size:13px;font-weight:600;padding:2px 6px;">${fmtMoney(monthlyTotal)}/mo</td></tr>` : ''}
    <tr style="border-top:2px solid #222;">
      <td colspan="4" style="text-align:right;font-size:15px;font-weight:700;padding:10px 6px 6px;">Total:</td>
      <td style="text-align:right;font-size:15px;font-weight:700;padding:10px 6px 6px;">${fmtMoney(grandTotal)}${monthlyTotal > 0 ? '/mo' : ''}</td>
    </tr>`

  const logoImg = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:64px;max-width:160px;object-fit:contain;" />`
    : ''

  const alreadySignedBlock = `
    <div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
      <div style="font-size:22px;line-height:1;">✅</div>
      <div>
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#166534;">Signed by ${esc(customerName)}</p>
        <p style="margin:0;font-size:12px;color:#15803d;">${signedAt ? 'Signed on ' + new Date(signedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding acceptance</p>
      </div>
    </div>`

  const signingBlock = `
    <div style="border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;padding:20px 16px;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#374151;">Sign to Accept This Estimate</p>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Draw your signature below using your finger or mouse.</p>
      <div style="position:relative;border:2px solid #d1d5db;border-radius:8px;background:#fff;overflow:hidden;margin-bottom:8px;">
        <canvas id="sigCanvas" style="display:block;width:100%;height:160px;cursor:crosshair;touch-action:none;"></canvas>
        <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:#fff;border:1px solid #d1d5db;border-radius:4px;padding:3px 10px;font-size:11px;color:#6b7280;cursor:pointer;">Clear</button>
      </div>
      <button type="button" id="submitBtn" style="width:100%;padding:15px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.01em;">
        ✓ &nbsp;I Accept This Estimate
      </button>
      <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
      <p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:12px;line-height:1.5;">
        By signing you confirm you have reviewed and accept the estimate above. This is a legally binding electronic signature.
      </p>
    </div>
    <div id="successMsg" style="display:none;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:32px 16px;text-align:center;">
      <div style="font-size:40px;margin-bottom:12px;">✅</div>
      <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#166534;">Thank you, ${esc(customerName)}!</p>
      <p style="margin:0;font-size:13px;color:#15803d;">Your signature has been received. We'll be in touch soon.</p>
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
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2.5;
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
      document.getElementById('submitBtn').addEventListener('click', function() {
        var err = document.getElementById('errMsg');
        if (!hasSig) { err.textContent = 'Please draw your signature before submitting.'; err.style.display = 'block'; return; }
        err.style.display = 'none';
        var btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting…';
        fetch(FUNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureData: canvas.toDataURL('image/png') })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            document.getElementById('sigCanvas').closest('div').previousElementSibling && null;
            document.getElementById('submitBtn').style.display = 'none';
            document.getElementById('clearBtn').style.display = 'none';
            document.getElementById('successMsg').style.display = 'block';
            document.querySelector('[data-sig-section]').style.display = 'none';
          } else {
            err.textContent = d.message || 'An error occurred. Please try again.';
            err.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '✓ I Accept This Estimate';
          }
        })
        .catch(function() {
          err.textContent = 'Network error. Please check your connection and try again.';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '✓ I Accept This Estimate';
        });
      });
    })();
    </script>`

  const notesHtml = notes ? `
    <div style="margin-top:20px;">
      <p style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Notes</p>
      <p style="font-size:13px;color:#374151;white-space:pre-wrap;margin:0;">${esc(notes)}</p>
    </div>` : ''

  const footerHtml = quoteFooter ? `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:11px;color:#9ca3af;margin:0;line-height:1.5;">${esc(quoteFooter)}</p>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Estimate from ${esc(companyName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #f3f4f6; color: #111827; -webkit-text-size-adjust: 100%; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 16px; }
    @media (min-width: 680px) { .wrap { padding: 32px 16px; } }
    .doc { background: #fff; border-radius: 16px; box-shadow: 0 2px 16px rgba(0,0,0,.08); overflow: hidden; }
    .doc-header { padding: 24px 24px 20px; border-bottom: 1px solid #f0f0f0; }
    .doc-body { padding: 24px; }
    table.line-items { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.line-items th { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; padding: 0 6px 8px; border-bottom: 2px solid #f0f0f0; }
    table.line-items th:not(:first-child) { text-align: right; }
    th.desc-col, td.desc-col { display: none; }
    @media (min-width: 480px) { th.desc-col, td.desc-col { display: table-cell; } }
  </style>
</head>
<body>
<div class="wrap">
  <div class="doc">
    <!-- Header: company + customer -->
    <div class="doc-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div>
          ${logoImg ? `<div style="margin-bottom:10px;">${logoImg}</div>` : ''}
          <p style="margin:0;font-size:16px;font-weight:700;">${esc(companyName)}</p>
          ${companyAddress ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyAddress)}</p>` : ''}
          ${companyPhone ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyPhone)}</p>` : ''}
          ${companyEmail ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyEmail)}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <p style="margin:0;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Estimate</p>
          <p style="margin:2px 0 0;font-size:13px;font-weight:700;font-family:monospace;">#${quoteId.slice(0, 8).toUpperCase()}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${quoteDate}</p>
        </div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #f0f0f0;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Prepared for</p>
        <p style="margin:0;font-size:14px;font-weight:700;">${esc(customerName)}</p>
        ${businessName ? `<p style="margin:2px 0 0;font-size:13px;color:#374151;">${esc(businessName)}</p>` : ''}
        ${customerAddress ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerAddress)}</p>` : ''}
        ${customerPhone ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerPhone)}</p>` : ''}
        ${customerEmail ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerEmail)}</p>` : ''}
      </div>
    </div>

    <!-- Line items -->
    <div class="doc-body">
      <table class="line-items">
        <thead>
          <tr>
            <th style="text-align:left;">Service</th>
            <th class="desc-col" style="text-align:left;">Description</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
        <tfoot>
          ${totalsHtml}
        </tfoot>
      </table>

      ${notesHtml}
      ${footerHtml}

      <!-- Signature section -->
      <div style="margin-top:28px;" data-sig-section>
        <div style="border-top:2px dashed #e5e7eb;margin-bottom:20px;"></div>
        ${alreadySigned ? alreadySignedBlock : signingBlock}
      </div>
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">Powered by KECC Estimator</p>
</div>
</body>
</html>`
}

function buildAgreementSigningPage(opts: AgreementPageOpts): string {
  const { token, customerName, companyName, logoUrl, alreadySigned } = opts
  const logoImg = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:60px;max-width:140px;object-fit:contain;display:block;margin:0 auto 8px;" />`
    : ''
  const alreadySignedHtml = `
    <div style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <h2 style="color:#3d6b35;margin:0 0 8px;">Already Signed</h2>
      <p style="color:#666;font-size:14px;">This document has already been signed.</p>
    </div>`
  const signingHtml = `
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Sign below</label>
      <div style="position:relative;border:2px solid #ccc;border-radius:8px;background:#fff;overflow:hidden;">
        <canvas id="sigCanvas" style="display:block;width:100%;height:150px;cursor:crosshair;touch-action:none;"></canvas>
        <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:none;border:1px solid #ccc;border-radius:4px;padding:2px 10px;font-size:11px;color:#888;cursor:pointer;">Clear</button>
      </div>
    </div>
    <button id="submitBtn" style="width:100%;padding:16px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">✓ I Agree &amp; Sign</button>
    <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
    <div id="successMsg" style="display:none;text-align:center;padding:32px 0;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <p style="font-size:16px;font-weight:700;color:#166534;margin:0 0 6px;">Thank you!</p>
      <p style="font-size:13px;color:#15803d;margin:0;">Your signature has been received.</p>
    </div>
    <script>
    (function(){
      var TOKEN='${token}',FUNC_URL='/.netlify/functions/esign?token='+TOKEN;
      var canvas=document.getElementById('sigCanvas'),ctx=canvas.getContext('2d'),drawing=false,hasSig=false,dpr=window.devicePixelRatio||1;
      function resize(){var r=canvas.getBoundingClientRect();canvas.width=r.width*dpr;canvas.height=r.height*dpr;ctx.scale(dpr,dpr);ctx.strokeStyle='#111';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';}
      resize();
      function pos(e){var r=canvas.getBoundingClientRect(),s=e.touches?e.touches[0]:e;return{x:s.clientX-r.left,y:s.clientY-r.top};}
      canvas.addEventListener('mousedown',function(e){drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
      canvas.addEventListener('mousemove',function(e){if(!drawing)return;var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;});
      canvas.addEventListener('mouseup',function(){drawing=false;});
      canvas.addEventListener('mouseleave',function(){drawing=false;});
      canvas.addEventListener('touchstart',function(e){e.preventDefault();drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
      canvas.addEventListener('touchmove',function(e){e.preventDefault();if(!drawing)return;var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;},{passive:false});
      canvas.addEventListener('touchend',function(){drawing=false;});
      document.getElementById('clearBtn').addEventListener('click',function(){ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);hasSig=false;});
      document.getElementById('submitBtn').addEventListener('click',function(){
        var err=document.getElementById('errMsg'),btn=document.getElementById('submitBtn');
        if(!hasSig){err.textContent='Please draw your signature.';err.style.display='block';return;}
        err.style.display='none';btn.disabled=true;btn.textContent='Submitting…';
        fetch(FUNC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signatureData:canvas.toDataURL('image/png')})})
        .then(function(r){return r.json();})
        .then(function(d){if(d.success){document.getElementById('signForm').style.display='none';document.getElementById('successMsg').style.display='block';}else{err.textContent=d.message||'Error';err.style.display='block';btn.disabled=false;btn.textContent='✓ I Agree & Sign';}})
        .catch(function(){err.textContent='Network error.';err.style.display='block';btn.disabled=false;btn.textContent='✓ I Agree & Sign';});
      });
    })();
    </script>`

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Service Agreement — ${esc(companyName)}</title>
<style>*,*::before,*::after{box-sizing:border-box;}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a;}
.card{background:#fff;max-width:480px;margin:0 auto;min-height:100dvh;padding:24px 20px 40px;}
@media(min-width:520px){.card{margin:24px auto;min-height:auto;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);}}</style>
</head><body><div class="card">
<div style="text-align:center;margin-bottom:16px;">${logoImg}<h1 style="font-size:18px;font-weight:700;margin:0 0 2px;">${esc(companyName)}</h1><p style="font-size:13px;color:#888;margin:0;">Service Agreement</p></div>
<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
<p style="font-size:13px;color:#555;margin:0 0 4px;">Prepared for:</p>
<p style="font-size:15px;font-weight:600;margin:0 0 16px;">${esc(customerName)}</p>
<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
<div id="signForm">${alreadySigned ? alreadySignedHtml : signingHtml}</div>
</div></body></html>`
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
      const lineItems: LineItemData[] = Array.isArray(quote.line_items) ? quote.line_items : []
      const html = buildQuoteSigningPage({
        token,
        customerName: quote.customer_name ?? '',
        customerAddress: quote.customer_address ?? null,
        customerPhone: quote.customer_phone ?? null,
        customerEmail: quote.customer_email ?? null,
        businessName: quote.business_name ?? null,
        companyName,
        companyAddress: settings?.address ?? null,
        companyPhone: settings?.phone ?? null,
        companyEmail: settings?.email ?? null,
        logoUrl,
        quoteId: quote.id,
        quoteDate: new Date(quote.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        lineItems,
        notes: quote.notes ?? null,
        quoteFooter: settings?.quote_footer ?? null,
        alreadySigned: !!quote.signed_at,
        signedAt: quote.signed_at ?? null,
      })
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html }
    }

    if (agreement) {
      const html = buildAgreementSigningPage({
        token,
        customerName: agreement.customer_name ?? '',
        companyName,
        logoUrl,
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
