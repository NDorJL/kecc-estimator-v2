import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' }

// ── helpers ────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtMoney(n: number | null | undefined): string {
  return '$' + (Number(n) || 0).toFixed(2)
}

function errPage(title: string, msg: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100dvh;background:#f3f4f6;}
.box{text-align:center;padding:40px 24px;max-width:360px;}h2{margin:0 0 8px;color:#111;}p{color:#6b7280;font-size:14px;margin:0;}</style>
</head><body><div class="box"><div style="font-size:48px;margin-bottom:16px;">⚠️</div>
<h2>${esc(title)}</h2><p>${esc(msg)}</p></div></body></html>`
}

// ── canvas signature JS (shared) ───────────────────────────────────────────

function sigScript(token: string, buttonLabel: string): string {
  return `<script>
(function(){
  var TOKEN='${esc(token)}';
  var FUNC_URL='/.netlify/functions/esign?token='+TOKEN;
  var canvas=document.getElementById('sigCanvas');
  var ctx=canvas.getContext('2d');
  var sigCard=document.getElementById('sigCard');
  var successCard=document.getElementById('successCard');
  var drawing=false,hasSig=false;
  var dpr=window.devicePixelRatio||1;

  function initCanvas(){
    var w=canvas.parentElement.offsetWidth||320;
    canvas.width=w*dpr;
    canvas.height=160*dpr;
    canvas.style.width=w+'px';
    canvas.style.height='160px';
    ctx.scale(dpr,dpr);
    ctx.strokeStyle='#111827';
    ctx.lineWidth=2.5;
    ctx.lineCap='round';
    ctx.lineJoin='round';
  }
  // Init after layout is ready
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initCanvas);
  } else {
    initCanvas();
  }

  function getPos(e){
    var r=canvas.getBoundingClientRect();
    var src=e.touches?e.touches[0]:e;
    return{x:src.clientX-r.left,y:src.clientY-r.top};
  }

  canvas.addEventListener('mousedown',function(e){drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('mousemove',function(e){if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;});
  canvas.addEventListener('mouseup',function(){drawing=false;});
  canvas.addEventListener('mouseleave',function(){drawing=false;});
  canvas.addEventListener('touchstart',function(e){e.preventDefault();drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
  canvas.addEventListener('touchmove',function(e){e.preventDefault();if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;},{passive:false});
  canvas.addEventListener('touchend',function(){drawing=false;});

  document.getElementById('clearBtn').addEventListener('click',function(){
    ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);
    hasSig=false;
  });

  document.getElementById('submitBtn').addEventListener('click',function(){
    var err=document.getElementById('errMsg');
    var btn=document.getElementById('submitBtn');
    if(!hasSig){err.textContent='Please draw your signature before submitting.';err.style.display='block';return;}
    err.style.display='none';
    btn.disabled=true;
    btn.textContent='Submitting\u2026';
    fetch(FUNC_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({signatureData:canvas.toDataURL('image/png')})
    })
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.success){
        sigCard.style.display='none';
        successCard.style.display='block';
      } else {
        err.textContent=d.message||'An error occurred. Please try again.';
        err.style.display='block';
        btn.disabled=false;
        btn.textContent='${esc(buttonLabel)}';
      }
    })
    .catch(function(){
      err.textContent='Network error. Please check your connection and try again.';
      err.style.display='block';
      btn.disabled=false;
      btn.textContent='${esc(buttonLabel)}';
    });
  });
})();
</script>`
}

// ── full quote signing page ────────────────────────────────────────────────

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

function buildQuotePage(opts: {
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
}): string {
  const {
    token, customerName, customerAddress, customerPhone, customerEmail, businessName,
    companyName, companyAddress, companyPhone, companyEmail, logoUrl,
    quoteId, quoteDate, lineItems, notes, quoteFooter,
    alreadySigned, signedAt,
  } = opts

  const onetimeItems = lineItems.filter(i => !i.isSubscription)
  const subItems     = lineItems.filter(i => i.isSubscription)
  const onetimeTotal = onetimeItems.reduce((s, i) => s + (i.lineTotal ?? 0), 0)
  const monthlyTotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal ?? 0), 0)
  const grandTotal   = onetimeTotal + monthlyTotal

  const itemRows = lineItems.map(li => `
    <tr>
      <td class="td-main">${esc(li.serviceName)}</td>
      <td class="td-sub td-desc">${esc(li.description)}</td>
      <td class="td-sub td-num">${li.quantity ?? 1}</td>
      <td class="td-sub td-num">${fmtMoney(li.unitPrice)}</td>
      <td class="td-sub td-num td-bold">${li.isSubscription ? fmtMoney(li.monthlyAmount ?? li.lineTotal) + '/mo' : fmtMoney(li.lineTotal)}</td>
    </tr>`).join('')

  const totalsHtml = [
    onetimeTotal > 0 ? `<tr><td colspan="4" class="td-label">One-Time Subtotal</td><td class="td-sub td-num td-bold">${fmtMoney(onetimeTotal)}</td></tr>` : '',
    monthlyTotal > 0 ? `<tr><td colspan="4" class="td-label">Monthly</td><td class="td-sub td-num td-bold">${fmtMoney(monthlyTotal)}/mo</td></tr>` : '',
    `<tr class="tr-total"><td colspan="4" class="td-label td-total-label">Total</td><td class="td-num td-total-val">${fmtMoney(grandTotal)}${monthlyTotal > 0 ? '/mo' : ''}</td></tr>`,
  ].join('')

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:56px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px;">`
    : ''

  const signatureSection = alreadySigned ? `
    <div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
      <span style="font-size:24px;line-height:1;">✅</span>
      <div>
        <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#166534;">Signed by ${esc(customerName)}</p>
        ${signedAt ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">${new Date(signedAt).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
        <p style="margin:0;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding</p>
      </div>
    </div>` : `
    <div id="sigCard">
      <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#111827;">Sign to Accept This Estimate</p>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">Review the estimate above, then draw your signature below.</p>
      <div style="position:relative;border:2px solid #d1d5db;border-radius:10px;background:#fff;overflow:hidden;margin-bottom:10px;">
        <canvas id="sigCanvas" style="display:block;cursor:crosshair;touch-action:none;"></canvas>
        <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 12px;font-size:11px;color:#6b7280;cursor:pointer;">Clear</button>
      </div>
      <button type="button" id="submitBtn" style="width:100%;padding:16px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.01em;">
        ✓&nbsp; I Accept This Estimate
      </button>
      <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
      <p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:12px;line-height:1.5;">
        By signing you confirm you have read and accept the terms of this estimate. This constitutes a legally binding electronic signature.
      </p>
    </div>
    <div id="successCard" style="display:none;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:32px 16px;text-align:center;">
      <div style="font-size:44px;margin-bottom:12px;">✅</div>
      <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#166534;">Thank you, ${esc(customerName)}!</p>
      <p style="margin:0;font-size:13px;color:#15803d;">Your signature has been received. We'll be in touch soon.</p>
    </div>
    ${sigScript(token, '✓  I Accept This Estimate')}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Estimate from ${esc(companyName)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827;-webkit-text-size-adjust:100%;}
    .wrap{max-width:660px;margin:0 auto;padding:16px;}
    @media(min-width:700px){.wrap{padding:32px 16px;}}
    .doc{background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.09);overflow:hidden;}
    .doc-header{padding:24px;border-bottom:1px solid #f0f0f0;}
    .doc-body{padding:24px;}
    .hdr-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
    .for-block{margin-top:16px;padding-top:16px;border-top:1px solid #f0f0f0;}
    .label-xs{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px;}
    table.items{width:100%;border-collapse:collapse;}
    .td-main{padding:9px 6px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:500;}
    .td-sub{padding:9px 6px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;}
    .td-num{text-align:right;white-space:nowrap;}
    .td-bold{font-weight:600;}
    .td-label{text-align:right;font-size:13px;color:#6b7280;padding:5px 6px;}
    .tr-total{border-top:2px solid #111827;}
    .td-total-label{font-size:14px;font-weight:700;padding:10px 6px 4px;}
    .td-total-val{font-size:14px;font-weight:700;text-align:right;white-space:nowrap;padding:10px 6px 4px;}
    th.th{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;padding:0 6px 10px;border-bottom:2px solid #f0f0f0;}
    th.th-r{text-align:right;}
    .desc-col{display:none;}
    @media(min-width:480px){.desc-col{display:table-cell;}}
    .sig-divider{border:none;border-top:2px dashed #e5e7eb;margin:28px 0 20px;}
  </style>
</head>
<body>
<div class="wrap">
  <div class="doc">
    <div class="doc-header">
      <div class="hdr-row">
        <div>
          ${logoHtml}
          <p style="margin:0;font-size:16px;font-weight:700;">${esc(companyName)}</p>
          ${companyAddress ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyAddress)}</p>` : ''}
          ${companyPhone   ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyPhone)}</p>`   : ''}
          ${companyEmail   ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(companyEmail)}</p>`   : ''}
        </div>
        <div style="text-align:right;">
          <p class="label-xs" style="margin-bottom:3px;">Estimate</p>
          <p style="margin:0;font-size:14px;font-weight:700;font-family:monospace;">#${esc(quoteId.slice(0,8).toUpperCase())}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${esc(quoteDate)}</p>
        </div>
      </div>
      <div class="for-block">
        <p class="label-xs">Prepared for</p>
        <p style="margin:0;font-size:15px;font-weight:700;">${esc(customerName)}</p>
        ${businessName    ? `<p style="margin:2px 0 0;font-size:13px;color:#374151;">${esc(businessName)}</p>`    : ''}
        ${customerAddress ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerAddress)}</p>` : ''}
        ${customerPhone   ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerPhone)}</p>`   : ''}
        ${customerEmail   ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${esc(customerEmail)}</p>`   : ''}
      </div>
    </div>

    <div class="doc-body">
      <table class="items">
        <thead>
          <tr>
            <th class="th" style="text-align:left;">Service</th>
            <th class="th th-r desc-col">Description</th>
            <th class="th th-r">Qty</th>
            <th class="th th-r">Price</th>
            <th class="th th-r">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>${totalsHtml}</tfoot>
      </table>

      ${notes ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #f0f0f0;">
        <p class="label-xs">Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(notes)}</p>
      </div>` : ''}

      ${quoteFooter ? `<div style="margin-top:20px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">${esc(quoteFooter)}</p>
      </div>` : ''}

      <hr class="sig-divider"/>
      ${signatureSection}
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">KECC Estimator</p>
</div>
</body>
</html>`
}

// ── agreement signing page (simple) ───────────────────────────────────────

function buildAgreementPage(opts: {
  token: string
  customerName: string
  companyName: string
  logoUrl: string | null
  alreadySigned: boolean
}): string {
  const { token, customerName, companyName, logoUrl, alreadySigned } = opts
  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:56px;max-width:140px;object-fit:contain;display:block;margin:0 auto 10px;">`
    : ''

  const body = alreadySigned ? `
    <div style="text-align:center;padding:40px 0;">
      <div style="font-size:48px;margin-bottom:14px;">✅</div>
      <p style="font-size:16px;font-weight:700;color:#166534;margin:0 0 6px;">Already Signed</p>
      <p style="font-size:13px;color:#15803d;margin:0;">This document has already been signed.</p>
    </div>` : `
    <div id="sigCard">
      <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#111827;">Sign below</p>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">Draw your signature using your finger or mouse.</p>
      <div style="position:relative;border:2px solid #d1d5db;border-radius:10px;background:#fff;overflow:hidden;margin-bottom:10px;">
        <canvas id="sigCanvas" style="display:block;cursor:crosshair;touch-action:none;"></canvas>
        <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 12px;font-size:11px;color:#6b7280;cursor:pointer;">Clear</button>
      </div>
      <button type="button" id="submitBtn" style="width:100%;padding:16px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;">
        ✓&nbsp; I Agree &amp; Sign
      </button>
      <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
    </div>
    <div id="successCard" style="display:none;text-align:center;padding:32px 0;">
      <div style="font-size:48px;margin-bottom:14px;">✅</div>
      <p style="font-size:16px;font-weight:700;color:#166534;margin:0 0 6px;">Thank you, ${esc(customerName)}!</p>
      <p style="font-size:13px;color:#15803d;margin:0;">Your signature has been received.</p>
    </div>
    ${sigScript(token, '✓  I Agree & Sign')}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Service Agreement — ${esc(companyName)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#111827;}
    .card{background:#fff;max-width:480px;margin:0 auto;min-height:100dvh;padding:28px 20px 48px;border-radius:0;}
    @media(min-width:520px){.card{margin:24px auto;min-height:auto;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.09);}}
  </style>
</head>
<body>
<div class="card">
  <div style="text-align:center;margin-bottom:20px;">
    ${logoHtml}
    <p style="margin:0;font-size:17px;font-weight:700;">${esc(companyName)}</p>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Service Agreement</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;"/>
  <p style="margin:0 0 3px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;">Prepared for</p>
  <p style="margin:0 0 20px;font-size:15px;font-weight:700;">${esc(customerName)}</p>
  <hr style="border:none;border-top:2px dashed #e5e7eb;margin:0 0 20px;"/>
  ${body}
</div>
</body>
</html>`
}

// ── handler ────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' }
  }

  const token = event.queryStringParameters?.token
  if (!token) {
    return {
      statusCode: 400,
      headers: HTML_HEADERS,
      body: errPage('Missing Link', 'No signing token was provided. Please use the link sent to you.'),
    }
  }

  // ── GET: serve signing page ──────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const [quoteRes, agreementRes, settingsRes] = await Promise.all([
        supabase.from('quotes').select('*').eq('accept_token', token).maybeSingle(),
        supabase.from('service_agreements').select('*').eq('accept_token', token).maybeSingle(),
        supabase.from('company_settings').select('*').limit(1).single(),
      ])

      const quote     = quoteRes.data
      const agreement = agreementRes.data
      const settings  = settingsRes.data

      if (!quote && !agreement) {
        return {
          statusCode: 404,
          headers: HTML_HEADERS,
          body: errPage('Link Not Found', 'This link is invalid or has already expired. Please contact us for a new one.'),
        }
      }

      const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'
      const logoUrl     = settings?.logo_url ?? null

      if (quote) {
        const lineItems: LineItemData[] = Array.isArray(quote.line_items) ? quote.line_items : []
        const html = buildQuotePage({
          token,
          customerName:    quote.customer_name    ?? '',
          customerAddress: quote.customer_address ?? null,
          customerPhone:   quote.customer_phone   ?? null,
          customerEmail:   quote.customer_email   ?? null,
          businessName:    quote.business_name    ?? null,
          companyName,
          companyAddress: settings?.address     ?? null,
          companyPhone:   settings?.phone       ?? null,
          companyEmail:   settings?.email       ?? null,
          logoUrl,
          quoteId:   quote.id,
          quoteDate: new Date(quote.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          lineItems,
          notes:       quote.notes       ?? null,
          quoteFooter: settings?.quote_footer ?? null,
          alreadySigned: !!quote.signed_at,
          signedAt:      quote.signed_at ?? null,
        })
        return { statusCode: 200, headers: HTML_HEADERS, body: html }
      }

      if (agreement) {
        const html = buildAgreementPage({
          token,
          customerName: agreement.customer_name ?? '',
          companyName,
          logoUrl,
          alreadySigned: !!agreement.signed_at,
        })
        return { statusCode: 200, headers: HTML_HEADERS, body: html }
      }
    } catch (err) {
      console.error('esign GET error:', err)
      return {
        statusCode: 500,
        headers: HTML_HEADERS,
        body: errPage('Something Went Wrong', 'We encountered an error loading this page. Please try again or contact us directly.'),
      }
    }
  }

  // ── POST: receive signature ──────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const [quoteRes, agreementRes] = await Promise.all([
        supabase.from('quotes').select('*').eq('accept_token', token).maybeSingle(),
        supabase.from('service_agreements').select('*').eq('accept_token', token).maybeSingle(),
      ])

      const quote     = quoteRes.data
      const agreement = agreementRes.data

      if (!quote && !agreement) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Invalid token' }) }
      }

      let body: { signatureData?: string } = {}
      try { body = JSON.parse(event.body ?? '{}') } catch { /* ignore */ }

      if (!body.signatureData) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'signatureData required' }) }
      }

      const signedAt = new Date().toISOString()
      const signedIp = event.headers['x-forwarded-for']?.split(',')[0].trim() ?? null

      if (quote) {
        if (quote.signed_at) {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
        }
        const { error } = await supabase.from('quotes').update({
          status: 'accepted',
          signed_at: signedAt,
          signature_data: body.signatureData,
          signed_ip: signedIp,
        }).eq('id', quote.id)
        if (error) throw new Error(error.message)

        if (quote.contact_id) {
          await supabase.from('activities').insert({
            contact_id: quote.contact_id,
            type: 'esign_completed',
            summary: `Quote signed by ${quote.customer_name}`,
            metadata: { quoteId: quote.id },
          })
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) }
      }

      if (agreement) {
        if (agreement.signed_at) {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
        }
        const { error } = await supabase.from('service_agreements').update({
          status: 'signed',
          signed_at: signedAt,
          signature_data: body.signatureData,
          signed_ip: signedIp,
        }).eq('id', agreement.id)
        if (error) throw new Error(error.message)

        if (agreement.subscription_id) {
          await supabase.from('subscriptions').update({
            status: 'ACTIVE',
            agreement_id: agreement.id,
          }).eq('id', agreement.subscription_id)
        }
        await supabase.from('activities').insert({
          contact_id: agreement.contact_id,
          type: 'esign_completed',
          summary: `Service agreement signed by ${agreement.customer_name}`,
          metadata: { agreementId: agreement.id, subscriptionId: agreement.subscription_id },
        })
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('esign POST error:', msg)
      return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: msg }) }
    }
  }

  return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }
}
