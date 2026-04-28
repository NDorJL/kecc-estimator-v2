import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { advanceLeadStage } from './_leadSync'

async function sendSms(apiKey: string, from: string, to: string, content: string): Promise<void> {
  const baseUrl = (process.env.QUO_BASE_URL ?? 'https://api.openphone.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], content }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`OpenPhone ${res.status}: ${text}`)
  }
}

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const d = new Date(iso)
  return isNaN(d.getTime()) ? (iso ?? '') : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function errPage(title: string, msg: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100dvh;background:#f3f4f6;}
.box{text-align:center;padding:40px 24px;max-width:360px;}h2{margin:0 0 8px;color:#111;}p{color:#6b7280;font-size:14px;margin:0;}</style>
</head><body><div class="box"><div style="font-size:48px;margin-bottom:16px;">⚠️</div>
<h2>${esc(title)}</h2><p>${esc(msg)}</p></div></body></html>`
}

// ── subscription quote types (no e-sign, use service agreement instead) ───

const SUB_QUOTE_TYPES = ['residential_tcep','commercial_tcep','residential_autopilot','commercial_autopilot','residential_tpc','commercial_tpc']

function isSubscriptionQuote(quoteType: string | null | undefined): boolean {
  return SUB_QUOTE_TYPES.includes(quoteType ?? '')
}

// ── canvas signature JS ────────────────────────────────────────────────────

function sigScript(token: string, buttonLabel: string, funcUrl: string): string {
  return `<script>
(function(){
  var TOKEN='${esc(token)}';
  var FUNC_URL='${esc(funcUrl)}';
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
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initCanvas);
  } else { initCanvas(); }

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
        window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
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

// ── Quote page (one-time services only) ────────────────────────────────────

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
  isSubscriptionQuote: boolean
}): string {
  const {
    token, customerName, customerAddress, customerPhone, customerEmail, businessName,
    companyName, companyAddress, companyPhone, companyEmail, logoUrl,
    quoteId, quoteDate, lineItems, notes, quoteFooter,
    alreadySigned, signedAt, isSubscriptionQuote,
  } = opts

  const onetimeItems = lineItems.filter(i => !i.isSubscription)
  const subItems     = lineItems.filter(i => i.isSubscription)
  const onetimeTotal = onetimeItems.reduce((s, i) => s + (i.lineTotal ?? 0), 0)
  const monthlyTotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal ?? 0), 0)
  const grandTotal   = onetimeTotal + monthlyTotal

  // Columns: Service | Description | Total  (Qty and Unit Price hidden from customer)
  const itemRows = lineItems.map(li => `
    <tr>
      <td class="td-main">${esc(li.serviceName)}</td>
      <td class="td-sub td-desc">${esc(li.description)}</td>
      <td class="td-sub td-num td-bold">${li.isSubscription ? fmtMoney(li.monthlyAmount ?? li.lineTotal) + '/mo' : fmtMoney(li.lineTotal)}</td>
    </tr>`).join('')

  // Build totals section — mixed quotes (one-time + recurring) get separate rows
  // so we never show "$X/mo" when the amount actually includes one-time charges.
  const totalsHtml = (() => {
    if (onetimeTotal > 0 && monthlyTotal > 0) {
      return [
        `<tr class="tr-total" style="border-top:2px solid #111827;">`,
        `  <td colspan="2" class="td-label td-total-label">Due Today (One-Time)</td>`,
        `  <td class="td-num td-total-val">${fmtMoney(onetimeTotal)}</td>`,
        `</tr>`,
        `<tr>`,
        `  <td colspan="2" class="td-label td-total-label" style="font-size:14px;font-weight:700;padding:6px 6px 10px;">Monthly Total</td>`,
        `  <td class="td-num td-total-val" style="padding:6px 6px 10px;">${fmtMoney(monthlyTotal)}/mo</td>`,
        `</tr>`,
      ].join('')
    }
    if (monthlyTotal > 0) {
      return `<tr class="tr-total"><td colspan="2" class="td-label td-total-label">Total</td><td class="td-num td-total-val">${fmtMoney(monthlyTotal)}/mo</td></tr>`
    }
    return `<tr class="tr-total"><td colspan="2" class="td-label td-total-label">Total</td><td class="td-num td-total-val">${fmtMoney(onetimeTotal)}</td></tr>`
  })()

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:56px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px;">`
    : ''

  // All quotes now get the signature pad (recurring quotes also sign the quote,
  // then a separate service agreement is auto-generated and sent afterwards).
  const funcUrl = `/.netlify/functions/esign?token=${encodeURIComponent(token)}`
  const successMessage = isSubscriptionQuote
    ? `Your signature has been received. A service agreement for your recurring plan will be sent to you shortly for a final signature.`
    : `Your signature has been received. We'll be in touch soon to get you on the schedule.`
  const signatureSection = alreadySigned
    ? `<div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
        <span style="font-size:24px;line-height:1;">✅</span>
        <div>
          <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#166534;">Signed by ${esc(customerName)}</p>
          ${signedAt ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">${new Date(signedAt).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
          <p style="margin:0;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding</p>
        </div>
      </div>`
    : `<div id="sigCard">
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
        <p style="margin:0;font-size:13px;color:#15803d;">${esc(successMessage)}</p>
      </div>
      ${sigScript(token, '✓  I Accept This Estimate', funcUrl)}`

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
  <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">Knox Exterior Care Co.</p>
</div>
</body>
</html>`
}

// ── Full service agreement page ────────────────────────────────────────────

interface ServiceRow { serviceName: string; frequency: string; pricePerMonth: number; description?: string }

function buildFullAgreementPage(opts: {
  token: string
  isResidential: boolean
  quoteType: string | null
  companyName: string
  companyPhone: string | null
  companyEmail: string | null
  logoUrl: string | null
  customerName: string
  businessName: string | null
  repName: string | null      // commercial: authorized rep
  repTitle: string | null
  serviceAddress: string | null
  billingAddress: string | null
  email: string | null
  phone: string | null
  accessNotes: string | null
  monthlyRate: number
  startDate: string | null
  services: ServiceRow[]
  alreadySigned: boolean
  signedAt: string | null
}): string {
  const {
    token, isResidential, quoteType, companyName, companyPhone, companyEmail, logoUrl,
    customerName, businessName, repName, repTitle,
    serviceAddress, billingAddress, email, phone, accessNotes,
    monthlyRate, startDate, services, alreadySigned, signedAt,
  } = opts

  const qt = (quoteType ?? '').toLowerCase()
  const isAutopilot = qt.includes('autopilot')
  // TCEP = Total Care Exterior Plan (includes 'tcep' in type)
  // TPC  = Total Property Care (includes 'tpc' but not 'tcep', or explicit _tpc suffix)
  const isTCEP = qt.includes('tcep')
  const isTPC  = qt.includes('_tpc') || (qt.includes('tpc') && !qt.includes('tcep'))
  const planLabel = isAutopilot ? 'One-Service Autopilot' : isTCEP ? 'Total Care Exterior Plan (TCEP)' : isTPC ? 'Total Property Care (TPC)' : ''
  const today = new Date()
  const agreementDate = today.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const reviewDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
    .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:52px;max-width:130px;object-fit:contain;display:block;margin-bottom:6px;">`
    : ''

  // Service rows
  const serviceRowsHtml = services.map(s => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;">${esc(s.serviceName)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#555;">${esc(s.description ?? '')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:center;">${esc(s.frequency)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;text-align:right;">${fmtMoney(s.pricePerMonth)}/mo</td>
    </tr>`).join('')

  // Legal text — Bonuses & Guarantees (plan-specific)
  const autopilotBonuses = `
<p style="margin:10px 0 4px;font-size:13px;font-weight:700;color:#1a1a1a;">One-Service Autopilot — Guarantees &amp; Bonuses</p>
<p style="margin:0 0 6px;font-size:12px;color:#374151;"><strong>"Zero-Risk First Month"</strong> — For the first month of a new One-Service Autopilot plan, if the ${isResidential ? 'customer' : 'client'} is dissatisfied after KECC performs the first scheduled visit(s) and notifies KECC in writing within 7 days, KECC will refund or credit up to one month of subscription charges and/or cancel the plan. Applies only to workmanship within KECC's control; does not apply to outcomes affected by weather, access issues, pre-existing conditions, or unrealistic expectations.</p>
<p style="margin:0 0 6px;font-size:12px;color:#374151;"><strong>"Show Up or It's Free"</strong> — If KECC fails to make a reasonable attempt to perform scheduled recurring service during the agreed window for reasons within KECC's control, or does not reschedule within 24 hours, KECC will credit or refund up to one month of subscription charges. Does not apply where service is delayed by lack of access, unsafe conditions, customer-requested changes, severe weather, or events outside KECC's control.</p>
<p style="margin:0 0 6px;font-size:12px;color:#374151;"><strong>"Loyalty Price Lock"</strong> — KECC will honor the recurring service rate for 12 months after this agreement is ratified, for the originally quoted scope and typical property conditions. KECC may adjust pricing with written notice if property size, scope, labor/material costs, or regulatory requirements materially change. The price lock applies to recurring service fees only.</p>
<p style="margin:0 0 4px;font-size:12px;color:#374151;"><em>Bonuses included:</em> Property Shield Report · Curb Appeal Photo Set · Neighbor Referral Credit ($100 applied to one future invoice) · Service Reminders.</p>
<p style="margin:0 0 8px;font-size:11px;color:#6b7280;">Bonuses have no cash value, are non-transferable, and may not be redeemed for cash or combined with other offers except at KECC's discretion. One-Service Autopilot plans do not receive bonuses reserved for higher-tier plans unless expressly stated in writing.</p>`

  const tcepTpcBonuses = `
<p style="margin:10px 0 4px;font-size:13px;font-weight:700;color:#1a1a1a;">${isTCEP ? 'Total Care Exterior Plan (TCEP)' : 'Total Property Care (TPC)'} — Guarantees &amp; Bonuses</p>
<p style="margin:0 0 4px;font-size:12px;color:#374151;">Includes all One-Service Autopilot guarantees and bonuses (Zero-Risk First Month, Show Up or It's Free, Loyalty Price Lock, Property Shield Report, Curb Appeal Photo Set, Neighbor Referral Credit, Service Reminders) on a broader basis, plus:</p>
<p style="margin:0 0 6px;font-size:12px;color:#374151;"><strong>"Beat Any Comparable Quote"</strong> — KECC will attempt to beat or match a current written quote from another insured provider for comparable recurring exterior services at the same property. ${isResidential ? 'Customer' : 'Client'} must provide a quote dated within 30 days that clearly describes services and frequency. KECC alone decides comparability and is not required to match prices that are unsustainably low, promotional, or inconsistent with KECC's safety or insurance standards.</p>
<p style="margin:0 0 6px;font-size:12px;color:#374151;"><strong>"Seasonal Plan Adjustments"</strong> — KECC may shift tasks seasonally (e.g., more mowing in growth season, more ice/leaf work in fall/winter) while keeping the overall annual service level and blended subscription value roughly consistent. Routine seasonal adjustments do not change the agreed monthly rate unless a specific service is explicitly paused for more than one month.</p>
<p style="margin:0 0 8px;font-size:12px;color:#374151;"><strong>"Priority Scheduling"</strong> — ${isResidential ? 'Customer\'s' : 'Client\'s'} property receives preferred placement in KECC's routing and rescheduling, especially after weather delays. This is a relative preference only and does not guarantee specific dates or times. All services remain subject to weather, safety, staffing, and routing constraints.</p>
<p style="margin:0 0 8px;font-size:11px;color:#6b7280;">All bonuses and guarantees: (1) require the client to be active and current on payments; (2) do not expand core service scope; (3) are provided in reasonable quantities determined by KECC; (4) have no cash value and are non-transferable; (5) may be adjusted on a prospective basis with prior notice of any already-earned benefits honored.</p>`

  const bonusesSection = isAutopilot ? autopilotBonuses : tcepTpcBonuses

  const legalText = `
<div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:20px;font-size:12px;color:#374151;line-height:1.6;">

  <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#1a1a1a;">Bonuses and Guarantees — Plan Tiers, Definitions, and Limitations</p>
  ${bonusesSection}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a1a1a;">Billing, Term &amp; Proration</p>
  <p style="margin:0 0 8px;">Services are billed on a recurring subscription basis, in advance, starting on or around the first scheduled service window. The monthly rate is a blended/averaged amount reflecting all included services over the plan term and is not tied to any single visit's price. Either party may cancel at any time with written or emailed notice. Upon cancellation, KECC will calculate the value of services already delivered at KECC's then-current standard (non-subscriber) rates and compare that to subscription payments collected. If delivered service value exceeds payments collected, the ${isResidential ? 'customer' : 'client'} agrees to pay a pro-rated final balance for the difference. If payments collected exceed services delivered, KECC will refund or credit the difference. Scope and pricing may be adjusted with at least 30 days' written notice if property conditions, labor costs, materials, or service requirements materially change.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a1a1a;">Access, Scheduling &amp; Safety</p>
  <p style="margin:0 0 8px;">${isResidential ? 'Customer' : 'Client'} will provide reasonable safe access (unlocked gates, codes, removal of aggressive ${isResidential ? 'pets' : 'animals'}, etc.). KECC schedules services during normal business hours based on routing efficiency and weather. KECC may skip, modify, or reschedule services if unsafe or impractical conditions exist (severe weather, unsafe ladder/roof access, hazardous materials, blocked areas, active construction). Skipped items may be rolled into a future visit where practical, as pricing is based on blended subscription value, not per-visit charges. KECC is not responsible for loss of business or consequential damages related to normal schedule changes or delays.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a1a1a;">Scope Limitations &amp; Exclusions</p>
  <p style="margin:0 0 8px;">This agreement covers only services explicitly listed in the Included Recurring Services section above. Work requiring specialty trades (roofing, structural repairs, electrical, plumbing, HVAC, major concrete/asphalt repair${!isResidential ? ', sign fabrication' : ''}) is outside scope unless added in writing. KECC does not include hazardous material cleanup, emergency response, or remediation unless specifically written into the plan. KECC is not responsible for pre-existing damage, existing defects, failing materials, or hidden conditions. KECC is not responsible for damage to underground utilities, unmarked obstacles, or items hidden in turf or work areas not disclosed (${isResidential ? 'hoses, cables, toys, shallow irrigation heads' : 'irrigation heads, cables, buried obstacles'}, etc.). Light wear and minor disturbance of delicate surfaces may occur despite reasonable care.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a1a1a;">Cancellation</p>
  <p style="margin:0 0 8px;">This agreement defines scope, expectations, schedule, and pricing. It is a discretionary service agreement, not a fixed-term long-term contract. The ${isResidential ? 'customer' : 'client'} may cancel at any time, subject only to the pro-rated balancing of services delivered vs. payments described in the Billing section above.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>
  <p style="margin:0 0 4px;font-size:12px;color:#374151;"><strong>${isResidential ? 'Customer' : 'Client'} Acknowledgment:</strong> ${isResidential ? 'Customer' : 'Client'} acknowledges that the services, frequencies, and pricing listed in this agreement represent the complete scope of recurring services, unless amended in writing.</p>
</div>`

  // Signature section
  const funcUrl = `/.netlify/functions/esign?token=${encodeURIComponent(token)}`
  const sigLabel = isResidential ? '✓  I Agree & Sign' : '✓  I Agree & Sign as Authorized Representative'

  const signatureSection = alreadySigned
    ? `<div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
        <span style="font-size:24px;line-height:1;">✅</span>
        <div>
          <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#166534;">Signed — ${esc(customerName)}</p>
          ${signedAt ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">${fmtDateLong(signedAt)}</p>` : ''}
          <p style="margin:0;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding</p>
        </div>
      </div>`
    : `<div id="sigCard">
        <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#111827;">
          ${isResidential ? 'Customer Signature' : 'Authorized Representative Signature'}
        </p>
        <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">
          I have read the full agreement above and agree to its terms. Draw your signature below.
        </p>
        <div style="position:relative;border:2px solid #d1d5db;border-radius:10px;background:#fff;overflow:hidden;margin-bottom:10px;">
          <canvas id="sigCanvas" style="display:block;cursor:crosshair;touch-action:none;"></canvas>
          <button type="button" id="clearBtn" style="position:absolute;bottom:8px;right:8px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 12px;font-size:11px;color:#6b7280;cursor:pointer;">Clear</button>
        </div>
        <button type="button" id="submitBtn" style="width:100%;padding:16px;background:#3d6b35;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.01em;">
          ${esc(sigLabel)}
        </button>
        <p id="errMsg" style="color:#dc2626;font-size:13px;text-align:center;margin:8px 0 0;display:none;"></p>
        <p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:12px;line-height:1.5;">
          By signing you confirm you have read and agree to the terms of this service agreement.
          This constitutes a legally binding electronic signature.
        </p>
      </div>
      <div id="successCard" style="display:none;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:32px 16px;text-align:center;">
        <div style="font-size:44px;margin-bottom:12px;">✅</div>
        <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#166534;">Thank you, ${esc(customerName)}!</p>
        <p style="margin:0;font-size:13px;color:#15803d;">Your agreement has been signed. We'll send you a copy for your records.</p>
      </div>
      ${sigScript(token, sigLabel, funcUrl)}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${isResidential ? 'Residential' : 'Commercial'} Service Agreement — ${esc(companyName)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827;-webkit-text-size-adjust:100%;}
    .wrap{max-width:720px;margin:0 auto;padding:16px 12px 40px;}
    @media(min-width:760px){.wrap{padding:32px 16px 60px;}}
    .doc{background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.09);overflow:hidden;}
    .sec{padding:20px 24px;border-bottom:1px solid #f0f0f0;}
    .sec:last-child{border-bottom:none;}
    .sec-title{font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin:0 0 12px;}
    .field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;}
    @media(max-width:500px){.field-row{grid-template-columns:1fr;}}
    .field label{display:block;font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;}
    .field p{margin:0;font-size:13px;color:#111827;font-weight:500;}
    .check-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
    .check-box{width:16px;height:16px;border:2px solid #d1d5db;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;}
    .check-box.checked{background:#3d6b35;border-color:#3d6b35;}
    .sig-divider{border:none;border-top:2px dashed #e5e7eb;margin:24px 0 20px;}
  </style>
</head>
<body>
<div class="wrap">
  <div class="doc">

    <!-- Header -->
    <div class="sec" style="background:#3d6b35;color:#fff;border-bottom:none;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          ${logoHtml}
          <p style="margin:0;font-size:18px;font-weight:800;color:#fff;">${esc(companyName)}</p>
          ${companyPhone ? `<p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,.8);">${esc(companyPhone)}</p>` : ''}
          ${companyEmail ? `<p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,.8);">${esc(companyEmail)}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <p style="margin:0;font-size:14px;font-weight:700;color:rgba(255,255,255,.9);">${isResidential ? 'Residential' : 'Commercial'} Master Recurring</p>
          <p style="margin:0;font-size:14px;font-weight:700;color:#fff;">Service Agreement</p>
        </div>
      </div>
    </div>

    <!-- Customer / Business Info -->
    <div class="sec">
      <p class="sec-title">${isResidential ? 'Customer &amp; Property Information' : 'Business &amp; Property Information'}</p>
      <div class="field-row">
        ${isResidential
          ? `<div class="field"><label>Customer Name</label><p>${esc(customerName)}</p></div>`
          : `<div class="field"><label>Business / Client Name</label><p>${esc(businessName || customerName)}</p></div>`
        }
        ${isResidential
          ? `<div class="field"><label>Email</label><p>${esc(email || '—')}</p></div>`
          : `<div class="field"><label>Authorized Representative</label><p>${esc(repName || customerName)}</p></div>`
        }
      </div>
      <div class="field-row">
        <div class="field"><label>Service Address</label><p>${esc(serviceAddress || '—')}</p></div>
        <div class="field"><label>${isResidential ? 'Phone' : 'Title'}</label><p>${isResidential ? esc(phone || '—') : esc(repTitle || '—')}</p></div>
      </div>
      ${!isResidential ? `<div class="field-row">
        <div class="field"><label>Email</label><p>${esc(email || '—')}</p></div>
        <div class="field"><label>Phone</label><p>${esc(phone || '—')}</p></div>
      </div>` : ''}
      ${billingAddress ? `<div class="field" style="margin-bottom:10px;"><label>Billing Address (if different)</label><p>${esc(billingAddress)}</p></div>` : ''}
      ${accessNotes ? `<div class="field"><label>Access Instructions / Gate Codes / Notes</label><p style="white-space:pre-wrap;">${esc(accessNotes)}</p></div>` : ''}
    </div>

    <!-- Plan Selection -->
    <div class="sec">
      <p class="sec-title">Plan Selection</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px 24px;margin-bottom:14px;">
        <div class="check-row">
          <div class="check-box ${isAutopilot ? 'checked' : ''}">${isAutopilot ? '✓' : ''}</div>
          <span style="font-size:13px;">One-Service Autopilot</span>
        </div>
        <div class="check-row">
          <div class="check-box ${isTCEP ? 'checked' : ''}">${isTCEP ? '✓' : ''}</div>
          <span style="font-size:13px;">Total Care Exterior Plan (TCEP)</span>
        </div>
        <div class="check-row">
          <div class="check-box ${isTPC ? 'checked' : ''}">${isTPC ? '✓' : ''}</div>
          <span style="font-size:13px;">Total Property Care (TPC)</span>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Monthly Rate</label><p style="font-size:18px;font-weight:800;color:#3d6b35;">${fmtMoney(monthlyRate)}<span style="font-size:13px;font-weight:500;color:#6b7280;"> / month</span></p></div>
        <div class="field"><label>Service Start Date</label><p>${esc(fmtDate(startDate))}</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Billing Frequency</label><p>Monthly</p></div>
        <div class="field"><label>Plan Review / Renewal Date</label><p>${esc(reviewDate)}</p></div>
      </div>
      <div class="field"><label>Date of Agreement</label><p>${esc(agreementDate)}</p></div>
    </div>

    <!-- Included Services -->
    <div class="sec">
      <p class="sec-title">Included Recurring Services</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;">
            <th style="text-align:left;padding:6px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Service</th>
            <th style="text-align:left;padding:6px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Description</th>
            <th style="text-align:center;padding:6px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Frequency</th>
            <th style="text-align:right;padding:6px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">$/Month</th>
          </tr>
        </thead>
        <tbody>${serviceRowsHtml}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #111827;">
            <td colspan="3" style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;">Monthly Total</td>
            <td style="padding:10px 6px;font-size:14px;font-weight:800;text-align:right;color:#3d6b35;">${fmtMoney(monthlyRate)}/mo</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Legal Text -->
    <div class="sec">
      ${legalText}
    </div>

    <!-- Signature -->
    <div class="sec">
      <hr class="sig-divider"/>
      ${signatureSection}
      ${alreadySigned ? '' : `<p style="font-size:11px;color:#9ca3af;margin-top:16px;text-align:center;">
        Knox Exterior Care Co. | Questions? Contact your KECC representative directly.
        Completed agreements should be retained by both parties for the duration of the service relationship
        and for a minimum of one year following cancellation.
      </p>`}
    </div>

  </div>
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

      const quoteRow    = quoteRes.data
      const agreementRow = agreementRes.data
      const settings    = settingsRes.data

      if (!quoteRow && !agreementRow) {
        return {
          statusCode: 404,
          headers: HTML_HEADERS,
          body: errPage('Link Not Found', 'This link is invalid or has already expired. Please contact us for a new one.'),
        }
      }

      const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'
      const logoUrl     = settings?.logo_url ?? null

      // ── Quote page ───────────────────────────────────────────────────────
      if (quoteRow) {
        const lineItems: LineItemData[] = Array.isArray(quoteRow.line_items) ? quoteRow.line_items : []
        const html = buildQuotePage({
          token,
          customerName:    quoteRow.customer_name    ?? '',
          customerAddress: quoteRow.customer_address ?? null,
          customerPhone:   quoteRow.customer_phone   ?? null,
          customerEmail:   quoteRow.customer_email   ?? null,
          businessName:    quoteRow.business_name    ?? null,
          companyName,
          companyAddress: settings?.address     ?? null,
          companyPhone:   settings?.phone       ?? null,
          companyEmail:   settings?.email       ?? null,
          logoUrl,
          quoteId:   quoteRow.id,
          quoteDate: new Date(quoteRow.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          lineItems,
          notes:       quoteRow.notes       ?? null,
          quoteFooter: settings?.quote_footer ?? null,
          alreadySigned:      !!quoteRow.signed_at,
          signedAt:           quoteRow.signed_at ?? null,
          isSubscriptionQuote: isSubscriptionQuote(quoteRow.quote_type),
        })
        return { statusCode: 200, headers: HTML_HEADERS, body: html }
      }

      // ── Full service agreement page ──────────────────────────────────────
      if (agreementRow) {
        // Fetch subscription + contact to populate the full agreement
        const [subRes, contactRes] = await Promise.all([
          agreementRow.subscription_id
            ? supabase.from('subscriptions').select('*').eq('id', agreementRow.subscription_id).single()
            : Promise.resolve({ data: null }),
          agreementRow.contact_id
            ? supabase.from('contacts').select('*').eq('id', agreementRow.contact_id).single()
            : Promise.resolve({ data: null }),
        ])

        const sub     = subRes.data
        const contact = contactRes.data
        const qt      = agreementRow.quote_type ?? ''
        const isRes   = !qt.includes('commercial')

        const services: ServiceRow[] = sub
          ? (Array.isArray(sub.services) ? sub.services : []).map((s: Record<string, unknown>) => ({
              serviceName:  String(s.serviceName ?? ''),
              frequency:    String(s.frequency ?? ''),
              pricePerMonth: Number(s.pricePerMonth ?? 0),
              description:  s.description ? String(s.description) : undefined,
            }))
          : []

        const html = buildFullAgreementPage({
          token,
          isResidential:  isRes,
          quoteType:      qt || null,
          companyName,
          companyPhone:   settings?.phone  ?? null,
          companyEmail:   settings?.email  ?? null,
          logoUrl,
          customerName:   agreementRow.customer_name ?? (contact?.name ?? ''),
          businessName:   contact?.business_name ?? null,
          repName:        contact?.name ?? null,
          repTitle:       null,
          serviceAddress: agreementRow.customer_address ?? (sub?.customer_address ?? null),
          billingAddress: null,
          email:          contact?.email ?? (sub?.customer_email ?? null),
          phone:          contact?.phone ?? (sub?.customer_phone ?? null),
          accessNotes:    null,
          monthlyRate:    sub?.in_season_monthly_total ?? 0,
          startDate:      sub?.start_date ?? null,
          services,
          alreadySigned:  !!agreementRow.signed_at,
          signedAt:       agreementRow.signed_at ?? null,
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

      const quoteRow    = quoteRes.data
      const agreementRow = agreementRes.data

      if (!quoteRow && !agreementRow) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Invalid token' }) }
      }

      let body: { signatureData?: string } = {}
      try { body = JSON.parse(event.body ?? '{}') } catch { /* ignore */ }

      if (!body.signatureData) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'signatureData required' }) }
      }

      const signedAt = new Date().toISOString()
      const signedIp = event.headers['x-forwarded-for']?.split(',')[0].trim() ?? null

      if (quoteRow) {
        if (quoteRow.signed_at) {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
        }
        const { error } = await supabase.from('quotes').update({
          status:         'accepted',
          signed_at:      signedAt,
          signature_data: body.signatureData,
          signed_ip:      signedIp,
        }).eq('id', quoteRow.id)
        if (error) throw new Error(error.message)

        // Log quote signing activity
        if (quoteRow.contact_id) {
          await supabase.from('activities').insert({
            contact_id: quoteRow.contact_id,
            type:       'esign_completed',
            summary:    `Quote signed by ${quoteRow.customer_name}`,
            metadata:   { quoteId: quoteRow.id },
          }).catch(() => {/* non-fatal */})
        }

        // ── Recurring quote: auto-generate & SMS a service agreement ─────────
        const lineItems = Array.isArray(quoteRow.line_items) ? quoteRow.line_items : []
        const hasSubItems = lineItems.some((li: { isSubscription?: boolean }) => li.isSubscription)

        if (hasSubItems && quoteRow.contact_id) {
          try {
            const agreeToken = randomUUID()
            const { data: newAgreement } = await supabase.from('service_agreements').insert({
              contact_id:       quoteRow.contact_id,
              customer_name:    quoteRow.customer_name ?? '',
              customer_address: quoteRow.customer_address ?? null,
              quote_type:       quoteRow.quote_type ?? null,
              status:           'pending_signature',
              accept_token:     agreeToken,
            }).select().single()

            if (newAgreement) {
              // Fetch SMS credentials
              const { data: settings } = await supabase
                .from('company_settings').select('quo_api_key, quo_from_number, company_name').limit(1).single()
              const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
              const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
              const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'

              if (apiKey && fromNumber && quoteRow.customer_phone) {
                const siteUrl = (process.env.URL ?? '').replace(/\/$/, '')
                const agreeUrl = `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(agreeToken)}`
                const firstName = (quoteRow.customer_name ?? 'there').split(' ')[0]
                const agreeMsg =
                  `Hi ${firstName}, ${companyName} here! Thank you for signing your quote. ` +
                  `Please review and sign your service agreement here: ${agreeUrl} ` +
                  `Reply STOP to opt out.`
                await sendSms(apiKey, fromNumber, quoteRow.customer_phone, agreeMsg)
              }

              await supabase.from('activities').insert({
                contact_id: quoteRow.contact_id,
                type:       'esign_sent',
                summary:    `Service agreement auto-generated and sent for signing`,
                metadata:   { agreementId: newAgreement.id, quoteId: quoteRow.id },
              }).catch(() => {})
            }
          } catch (agreeErr) {
            // Non-fatal — quote signing already succeeded
            console.error('[esign] Failed to auto-generate service agreement:', agreeErr)
          }
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) }
      }

      if (agreementRow) {
        if (agreementRow.signed_at) {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
        }
        const { error } = await supabase.from('service_agreements').update({
          status:         'signed',
          signed_at:      signedAt,
          signature_data: body.signatureData,
          signed_ip:      signedIp,
          updated_at:     signedAt,
        }).eq('id', agreementRow.id)
        if (error) throw new Error(error.message)

        // Flip subscription to ACTIVE and link agreement
        if (agreementRow.subscription_id) {
          await supabase.from('subscriptions').update({
            status:       'ACTIVE',
            agreement_id: agreementRow.id,
          }).eq('id', agreementRow.subscription_id).catch(() => {/* non-fatal */})
        }

        // Stamp agreement_signed_at on the most recent non-lost lead for this contact.
        // This gates the "Schedule Job" button in the lead detail sheet.
        if (agreementRow.contact_id) {
          await supabase.from('leads')
            .update({ agreement_signed_at: signedAt })
            .eq('contact_id', agreementRow.contact_id)
            .not('stage', 'eq', 'lost')
            .order('created_at', { ascending: false })
            .limit(1)
            .catch(() => {/* non-fatal */})
        }

        // Advance lead to "Recurring" when service agreement is signed
        await advanceLeadStage(supabase, {
          quoteId:   null,
          contactId: agreementRow.contact_id ?? null,
          stage:     'recurring',
        })

        await supabase.from('activities').insert({
          contact_id: agreementRow.contact_id,
          type:       'esign_completed',
          summary:    `Service agreement signed by ${agreementRow.customer_name} — ready to schedule`,
          metadata:   { agreementId: agreementRow.id, subscriptionId: agreementRow.subscription_id },
        }).catch(() => {/* non-fatal */})

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
