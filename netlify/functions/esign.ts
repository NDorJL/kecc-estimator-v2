import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { advanceLeadStage } from './_leadSync'
import { sendOpenPhoneSms } from './_smsHelper'
import { sendEmail } from './_emailHelper'

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
  const itemRows = lineItems.map(li => {
    const freqLabel = li.frequency && li.frequency !== 'One-Time' ? li.frequency : null
    const descParts = [li.description, freqLabel].filter(Boolean)
    const descHtml = descParts.length
      ? descParts.map((p, i) => i === 0
          ? esc(p)
          : `<span style="display:block;font-size:11px;color:#6b7280;margin-top:1px;">🔁 ${esc(p)}</span>`)
          .join('')
      : ''
    return `
    <tr>
      <td class="td-main">${esc(li.serviceName)}</td>
      <td class="td-sub td-desc">${descHtml}</td>
      <td class="td-sub td-num td-bold">${li.isSubscription ? fmtMoney(li.monthlyAmount ?? li.lineTotal) + '/mo' : fmtMoney(li.lineTotal)}</td>
    </tr>`
  }).join('')

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
  const downloadBtn = `<button onclick="window.print()" class="no-print" style="display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:12px 24px;background:#fff;color:#166534;border:2px solid #16a34a;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">📄 Download PDF Copy</button>`

  const signatureSection = alreadySigned
    ? `<div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
        <span style="font-size:24px;line-height:1;">✅</span>
        <div style="flex:1;">
          <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#166534;">Signed by ${esc(customerName)}</p>
          ${signedAt ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">${new Date(signedAt).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
          <p style="margin:0 0 12px;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding</p>
          ${downloadBtn}
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
        <p style="margin:0 0 4px;font-size:13px;color:#15803d;">${esc(successMessage)}</p>
        ${downloadBtn}
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
    @media print{
      .no-print{display:none!important;}
      body{background:#fff;}
      .wrap{max-width:100%;padding:0;}
      .doc{box-shadow:none;border-radius:0;}
      #sigCard{display:none!important;}
    }
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

interface CheckedService {
  label: string
  checked: boolean
  modifier: string | null
  price: string | null
  frequency: string | null
  scope: string
}

// ── Service mapping utility ────────────────────────────────────────────────

function mapLineItemsToServices(
  lineItems: LineItemData[],
  isResidential: boolean
): CheckedService[] {
  const RES_SERVICES: Array<{ label: string; keywords: string[]; scope: string }> = [
    {
      label: 'Lawn Care / Mowing',
      keywords: ['lawn', 'mow', 'mowing', 'grass', 'turf', 'cut grass', 'cutting'],
      scope: 'Routine mowing of accessible turf, trimming along edges/obstacles, edging along hard surfaces as needed, and blowing clippings off hardscapes; excludes major grading, sod installation, or large one-time cleanups.',
    },
    {
      label: 'Window Cleaning (Exterior)',
      keywords: ['window', 'glass door'],
      scope: 'Cleaning of safely reachable exterior windows and glass doors using standard tools; excludes high-access windows requiring special equipment, interior glass, and storm windows unless separately noted.',
    },
    {
      label: 'Exterior House Wash / Pressure Washing',
      keywords: ['pressure', 'wash', 'soft wash', 'house wash', 'power wash', 'exterior clean'],
      scope: 'Soft-wash or low-pressure cleaning of designated exterior surfaces as agreed; excludes roofs, unsafe areas, or surfaces not specified in writing.',
    },
    {
      label: 'Trash / Recycling Bin Cleaning',
      keywords: ['trash', 'bin', 'recycling', 'garbage'],
      scope: 'Cleaning and deodorizing standard residential trash/recycling bins to remove typical dirt and organic buildup; excludes hazardous waste, chemicals, or heavy contamination.',
    },
    {
      label: 'Pet Waste Cleanup',
      keywords: ['pet', 'waste', 'dog', 'poop'],
      scope: 'Picking up of pet waste in exterior yard areas of property. Waste will be disposed of off-site, customer understands that price may increase or decrease depending on number of animals. Price reflected here is good for the number of animals owned at the time of this agreement.',
    },
    {
      label: 'Exterior Inspection & Minor Tune-Ups',
      keywords: ['inspection', 'tune', 'handyman', 'check'],
      scope: 'Periodic visual inspection of exterior elements and quick minor adjustments (tightening loose hardware, basic door/hinge tweaks, simple re-securing tasks) using hand tools; excludes structural repairs, painting, electrical, roofing, plumbing, or any work requiring permits or specialty trades.',
    },
    {
      label: 'Dryer Vent Cleaning',
      keywords: ['dryer', 'vent'],
      scope: 'Cleaning of primary dryer vent run from accessible connection points to remove lint buildup; excludes appliance disassembly, cutting into walls, or HVAC modifications.',
    },
    {
      label: 'Gutter Cleaning',
      keywords: ['gutter', 'downspout'],
      scope: 'Removal of debris from accessible gutters/downspouts using ladders/tools where safe; excludes roof-walking, major repairs, and work requiring special equipment unless separately agreed.',
    },
    {
      label: 'Seasonal Ice Prevention (Salting Concrete)',
      keywords: ['salt', 'ice', 'winter', 'snow prevention', 'de-ice'],
      scope: 'Up to a set number of salt applications per winter on designated walkways/entries as requested by customer during snow/ice conditions; reduces but does not eliminate slip risk; customer remains responsible for overall site safety.',
    },
    {
      label: 'Landscape / Mulch Refresh',
      keywords: ['mulch', 'landscape', 'bed', 'flower bed', 'landscaping'],
      scope: 'Periodic refresh of existing beds (mulch or similar) and basic lawn treatment as agreed; quantities and specific products adjusted to property size and may be itemized separately.',
    },
  ]

  const COMM_SERVICES: Array<{ label: string; keywords: string[]; scope: string }> = [
    {
      label: 'Grounds Maintenance / Lawn Care',
      keywords: ['lawn', 'mow', 'mowing', 'grass', 'turf', 'grounds', 'cut grass', 'cutting'],
      scope: 'Routine mowing of designated turf, trimming around obstacles, edging along hard surfaces, and blowing debris from walks/curb lines; excludes redesign, large-scale landscaping, or grading unless separately quoted.',
    },
    {
      label: 'Exterior Window Cleaning',
      keywords: ['window', 'glass door'],
      scope: 'Cleaning of designated, safely reachable exterior windows/doors; excludes upper stories or special-access work requiring lifts or rope access unless separately specified.',
    },
    {
      label: 'Pressure Washing',
      keywords: ['pressure', 'wash', 'soft wash', 'power wash', 'exterior clean'],
      scope: 'Cleaning of agreed exterior surfaces (e.g., sidewalks, entries, curbs) using appropriate pressure/softwash methods; excludes building facades or roofs unless clearly written into scope.',
    },
    {
      label: 'Parking Lot Sweeping',
      keywords: ['parking', 'sweep', 'lot'],
      scope: 'Sweeping or blowing of accessible parking lot surfaces and curbs to remove typical loose debris, trash, and leaves; excludes oil stain removal, paint removal, and structural asphalt/concrete repairs.',
    },
    {
      label: 'Graffiti Removal',
      keywords: ['graffiti'],
      scope: 'Removal or reduction of graffiti from designated surfaces using appropriate methods; results may vary based on material and severity; structural repairs or repainting are excluded unless separately quoted.',
    },
    {
      label: 'Dumpster Enclosure Cleanup',
      keywords: ['dumpster', 'enclosure'],
      scope: 'Cleaning of dumpster pad and enclosure surfaces to remove typical grime; excludes hazardous waste handling, grease trap cleaning, or structural repairs.',
    },
    {
      label: 'Sign Cleaning / Sign Maintenance',
      keywords: ['sign'],
      scope: 'Cleaning of exterior building/monument signs and basic minor maintenance (tightening hardware, replacing accessible bulbs where provided); excludes rewiring, fabrication, rebranding, or structural sign work.',
    },
    {
      label: 'Solar Panel Cleaning',
      keywords: ['solar', 'panel'],
      scope: 'Surface cleaning of accessible solar panels to remove dust/pollen/buildup using non-abrasive methods; excludes electrical work, panel repair, roof repair, or special-safety systems unless separately agreed.',
    },
    {
      label: 'Exterior Inspection with Handyman Tune-Ups',
      keywords: ['inspection', 'tune', 'handyman', 'check'],
      scope: 'Periodic exterior inspection of building and grounds with small handyman-style adjustments (tightening loose hardware, simple re-securing tasks, replacing accessible bulbs); excludes structural work, roofing, electrical, plumbing, HVAC, painting, or any specialty trade work.',
    },
    {
      label: 'Seasonal Ice Prevention (Salting Concrete)',
      keywords: ['salt', 'ice', 'winter', 'snow prevention', 'de-ice'],
      scope: 'Up to a set number of salt applications per winter on designated walkways/entries/critical areas when requested by client during snow/ice conditions; reduces but does not eliminate slip risk; client remains responsible for premises safety and compliance.',
    },
    {
      label: 'On-Call Snow Response',
      keywords: ['snow response', 'snow removal', 'snow plow'],
      scope: 'Response to client-initiated snow/ice service requests as route and weather allow; no guaranteed response time unless separately agreed in writing.',
    },
    {
      label: 'Light Exterior Carpentry / Repair',
      keywords: ['carpentry', 'repair', 'trim', 'wood'],
      scope: 'Minor non-structural exterior repairs within KECC\'s capabilities (e.g., small trim fixes, simple re-secures) as described in notes; excludes structural work, major repairs, or code-permitted trades.',
    },
  ]

  const services = isResidential ? RES_SERVICES : COMM_SERVICES
  const result: CheckedService[] = []
  const matchedLineItems = new Set<number>()

  for (const svc of services) {
    const matchIdx = lineItems.findIndex((li, idx) => {
      if (matchedLineItems.has(idx)) return false
      const name = (li.serviceName ?? '').toLowerCase()
      return svc.keywords.some(kw => name.includes(kw))
    })

    if (matchIdx >= 0) {
      matchedLineItems.add(matchIdx)
      const li = lineItems[matchIdx]
      const price = li.monthlyAmount ?? li.lineTotal
      // li.frequency comes from the calculator (e.g. "Bi-Weekly", "Monthly", "Every 6 Weeks")
      const freq = (li.frequency && li.frequency !== 'One-Time') ? li.frequency : null
      result.push({
        label: svc.label,
        checked: true,
        modifier: null,  // description (acreage etc.) intentionally excluded from SA
        price: price ? `$${Number(price).toFixed(2)}/mo` : null,
        frequency: freq,
        scope: svc.scope,
      })
    } else {
      result.push({
        label: svc.label,
        checked: false,
        modifier: null,
        price: null,
        frequency: null,
        scope: svc.scope,
      })
    }
  }

  // Any unmatched line items → Other / Custom Service
  const unmatched = lineItems.filter((_, i) => !matchedLineItems.has(i))
  if (unmatched.length > 0) {
    const customDesc = unmatched
      .map(li => {
        const parts = [li.serviceName ?? 'Custom Service']
        if (li.monthlyAmount || li.lineTotal) parts.push(`$${Number(li.monthlyAmount ?? li.lineTotal).toFixed(2)}/mo`)
        if (li.frequency && li.frequency !== 'One-Time') parts.push(li.frequency)
        return parts.join(' · ')
      })
      .join('; ')
    result.push({
      label: 'Other / Custom Service',
      checked: true,
      modifier: customDesc,
      price: null,
      frequency: null,
      scope: isResidential
        ? 'Any additional service specifically described here and agreed in writing by KECC and customer.'
        : 'Any additional service specifically described here and agreed in writing by KECC and client.',
    })
  } else {
    result.push({
      label: 'Other / Custom Service',
      checked: false,
      modifier: null,
      price: null,
      frequency: null,
      scope: isResidential
        ? 'Any additional service specifically described here and agreed in writing by KECC and customer.'
        : 'Any additional service specifically described here and agreed in writing by KECC and client.',
    })
  }

  return result
}

function detectPlanType(quoteType: string | null): 'autopilot' | 'tcep' | 'tpc' {
  const qt = (quoteType ?? '').toLowerCase()
  if (qt.includes('autopilot')) return 'autopilot'
  if (qt.includes('tcep')) return 'tcep'
  if (qt.includes('tpc')) return 'tpc'
  return 'autopilot'
}

// ── Lawn-care subscription type detection ─────────────────────────────────────

type LawnType = 'single_service_lawn' | 'bundled_lawn' | 'other'

/**
 * Detect whether lawn care is the sole recurring service or part of a bundle.
 *
 * single_service_lawn  — lawn care is the only checked/recurring service
 * bundled_lawn         — lawn care is present alongside ≥1 other recurring service
 * other                — no lawn care detected
 *
 * Uses the checked services list from mapLineItemsToServices so the source of
 * truth is the actual line-item composition, not the plan name.
 */
function detectLawnType(checkedServices: CheckedService[]): LawnType {
  const LAWN_KEYWORDS = ['lawn', 'mow', 'mowing', 'grass', 'turf', 'grounds', 'cut grass', 'cutting']
  const isLawn = (label: string) => LAWN_KEYWORDS.some(kw => label.toLowerCase().includes(kw))

  const checkedOnes = checkedServices.filter(s => s.checked)
  const lawnServices = checkedOnes.filter(s => isLawn(s.label))
  const otherServices = checkedOnes.filter(s => !isLawn(s.label))

  if (lawnServices.length === 0) return 'other'
  if (otherServices.length === 0) return 'single_service_lawn'
  return 'bundled_lawn'
}

/**
 * Returns the correct Billing / Cancellation clause text based on the
 * detected lawn type. The returned object has separate fields for the
 * Billing paragraph and the Cancellation paragraph so they can be
 * injected into their respective sections independently.
 */
function getLawnClauses(lawnType: LawnType, party: string): {
  billingExtra: string
  cancellationText: string
} {
  if (lawnType === 'single_service_lawn') {
    return {
      billingExtra:
        `<p style="margin:8px 0 0;">` +
        `<strong>Lawn Care Services &#8212; 12-Month Level Billing.</strong> ` +
        `Lawn Care Services provided as a standalone recurring service are offered on a twelve (12) month service term. ` +
        `${party.charAt(0).toUpperCase() + party.slice(1)} acknowledges that monthly billing is structured as level billing across the full twelve-month term, ` +
        `including active and off-season months, in order to provide consistent service scheduling and annual pricing stability.` +
        `</p>`,
      cancellationText:
        `This agreement defines scope, expectations, schedule, and pricing. ` +
        `For this standalone Lawn Care subscription, the service term is twelve (12) months with level monthly billing year-round. ` +
        `Either party may cancel the recurring service upon thirty (30) days&#8217; written notice, ` +
        `subject to any charges incurred or services performed prior to the effective cancellation date. ` +
        `Upon cancellation, KECC will calculate the value of services already delivered at KECC&#8217;s then-current standard (non-subscriber) rates ` +
        `and compare that to subscription payments collected to date; any difference will be settled accordingly.`,
    }
  }

  if (lawnType === 'bundled_lawn') {
    return {
      billingExtra:
        `<p style="margin:8px 0 0;">` +
        `<strong>Seasonal Lawn Care Adjustment.</strong> ` +
        `For bundled recurring service plans that include Lawn Care Services together with other recurring services, the lawn care portion of the plan is seasonally adjusted during the winter season. ` +
        `For purposes of this Agreement, the winter season is defined as December&#160;1 through February&#160;28, or February&#160;29 in a leap year. ` +
        `During that period, Lawn Care Services will be removed from the monthly plan price and automatically reinstated beginning March&#160;1. ` +
        `All other recurring bundled services shall remain active and continue under this Agreement unless otherwise stated in the selected plan. ` +
        `The seasonal lawn care adjustment described above applies only to bundled multi-service plans and does not apply to standalone lawn care subscriptions.` +
        `</p>`,
      cancellationText:
        `This agreement defines scope, expectations, schedule, and pricing. It is a discretionary service agreement, not a fixed-term long-term contract. ` +
        `The ${party} may cancel at any time with written or emailed notice, subject only to the pro-rated balancing of services delivered vs. payments described in the Billing section above. ` +
        `Note: the seasonal removal of Lawn Care Services during the winter season does not constitute cancellation; all other bundled services remain active and billable during that period.`,
    }
  }

  // 'other' — no lawn care, use default text
  return {
    billingExtra: '',
    cancellationText:
      `This agreement defines scope, expectations, schedule, and pricing. It is a discretionary service agreement, not a fixed-term long-term contract. ` +
      `The ${party} may cancel at any time, subject only to the pro-rated balancing of services delivered vs. payments described in the Billing section above.`,
  }
}

function buildFullAgreementPage(opts: {
  token: string
  isResidential: boolean
  quoteType: string | null
  companyName: string
  companyPhone: string | null
  companyEmail: string | null
  logoUrl: string | null
  // Customer/Business info
  customerName: string
  businessName: string | null
  repName: string | null
  repTitle: string | null
  serviceAddress: string | null
  billingAddress: string | null
  email: string | null
  phone: string | null
  accessNotes: string | null
  // Plan
  planType: 'autopilot' | 'tcep' | 'tpc'
  monthlyRate: number
  agreementDate: string
  serviceStartDate: string
  planReviewDate: string
  // Services
  checkedServices: CheckedService[]
  // Lead notes
  leadNotes: string | null
  // Signatures
  keccSigData: string | null
  alreadySigned: boolean
  signedAt: string | null
  signerPrintedName: string | null
  signatureData: string | null
  funcUrl: string
}): string {
  const {
    token, isResidential, companyName, companyPhone, companyEmail, logoUrl,
    customerName, businessName, repName, repTitle,
    serviceAddress, billingAddress, email, phone, accessNotes,
    planType, monthlyRate, agreementDate, serviceStartDate, planReviewDate,
    checkedServices, leadNotes,
    keccSigData, alreadySigned, signedAt, signerPrintedName, signatureData,
    funcUrl,
  } = opts

  const isAutopilot = planType === 'autopilot'
  const isTCEP = planType === 'tcep'
  const isTPC = planType === 'tpc'

  // ── Lawn-care clause detection ─────────────────────────────────────────────
  const party = isResidential ? 'customer' : 'client'
  const lawnType = detectLawnType(checkedServices)
  const { billingExtra, cancellationText } = getLawnClauses(lawnType, party)

  // ── Services checklist rows ────────────────────────────────────────────────
  const serviceRowsHtml = checkedServices.map(svc => {
    const checkHtml = svc.checked
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#16a34a;border-radius:3px;color:#fff;font-size:12px;font-weight:700;flex-shrink:0;">✓</span>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:2px solid #d1d5db;border-radius:3px;flex-shrink:0;"></span>`
    const modifierHtml = svc.checked && (svc.modifier || svc.price || svc.frequency)
      ? `<div style="margin-top:3px;font-size:11px;color:#374151;"><span style="font-weight:600;">Modifier / Price / Frequency:</span> ${esc([svc.price, svc.frequency, svc.modifier].filter(Boolean).join(' · '))}</div>`
      : ''
    return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;align-items:flex-start;">
      <div style="margin-top:2px;">${checkHtml}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:${svc.checked ? '700' : '500'};color:${svc.checked ? '#111827' : '#6b7280'};">${esc(svc.label)}</div>
        ${modifierHtml}
        <div style="margin-top:3px;font-size:10px;color:#9ca3af;line-height:1.4;">${esc(svc.scope)}</div>
      </div>
    </div>`
  }).join('')

  // ── KECC signature block ───────────────────────────────────────────────────
  const keccSigHtml = keccSigData
    ? `<img src="${esc(keccSigData)}" alt="KECC Signature" style="max-height:60px;max-width:220px;display:block;margin-bottom:4px;">`
    : `<span style="font-family:'Brush Script MT',cursive;font-size:28px;color:#111827;display:block;margin-bottom:4px;">Nicholas G Dunn</span>`

  // ── Customer signature section ─────────────────────────────────────────────
  const sigLabel = isResidential ? '✓  I Agree & Sign' : '✓  I Agree & Sign as Authorized Representative'
  const downloadBtn = `<button onclick="window.print()" class="no-print" style="display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:12px 24px;background:#fff;color:#166534;border:2px solid #16a34a;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">Download PDF Copy</button>`

  const customerSigSection = alreadySigned
    ? `<div style="border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;padding:20px 16px;display:flex;gap:12px;align-items:flex-start;">
        <span style="font-size:24px;line-height:1;">&#x2705;</span>
        <div style="flex:1;">
          <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#166534;">Signed — ${esc(customerName)}</p>
          ${signerPrintedName ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">Printed name: ${esc(signerPrintedName)}</p>` : ''}
          ${signedAt ? `<p style="margin:0 0 3px;font-size:12px;color:#15803d;">${new Date(signedAt).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} at ${new Date(signedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}</p>` : ''}
          ${signatureData ? `<img src="${esc(signatureData)}" alt="Customer Signature" style="max-height:60px;max-width:220px;display:block;margin:8px 0 4px;">` : ''}
          <p style="margin:0 0 12px;font-size:11px;color:#16a34a;">Electronic signature on file · Legally binding</p>
          ${downloadBtn}
        </div>
      </div>`
    : `<div id="sigCard">
        <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#111827;">
          ${isResidential ? 'Customer Signature' : 'Authorized Representative Signature'}
        </p>
        <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">
          I have read the full agreement above and agree to its terms. Draw your signature below.
        </p>
        <div style="margin-bottom:10px;">
          <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px;">${isResidential ? 'Printed Name' : 'Printed Name'}</label>
          <input id="printedNameInput" type="text" placeholder="${isResidential ? 'Your full name' : 'Representative full name'}"
            style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#111827;background:#fff;outline:none;">
        </div>
        ${!isResidential ? `<div style="margin-bottom:10px;">
          <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px;">Title</label>
          <input id="titleInput" type="text" placeholder="Your title / role"
            style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;color:#111827;background:#fff;outline:none;">
        </div>` : ''}
        <label style="display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:4px;">Signature</label>
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
        <div style="font-size:44px;margin-bottom:12px;">&#x2705;</div>
        <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#166534;">Thank you, ${esc(customerName)}!</p>
        <p style="margin:0 0 4px;font-size:13px;color:#15803d;">Your agreement has been signed. A link to your signed copy has been sent to your phone.</p>
        ${downloadBtn}
      </div>
      <script>
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
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initCanvas);}else{initCanvas();}

  function getPos(e){var r=canvas.getBoundingClientRect();var src=e.touches?e.touches[0]:e;return{x:src.clientX-r.left,y:src.clientY-r.top};}
  canvas.addEventListener('mousedown',function(e){drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('mousemove',function(e){if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;});
  canvas.addEventListener('mouseup',function(){drawing=false;});
  canvas.addEventListener('mouseleave',function(){drawing=false;});
  canvas.addEventListener('touchstart',function(e){e.preventDefault();drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
  canvas.addEventListener('touchmove',function(e){e.preventDefault();if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasSig=true;},{passive:false});
  canvas.addEventListener('touchend',function(){drawing=false;});

  document.getElementById('clearBtn').addEventListener('click',function(){
    ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);hasSig=false;
  });

  document.getElementById('submitBtn').addEventListener('click',function(){
    var err=document.getElementById('errMsg');
    var btn=document.getElementById('submitBtn');
    var nameInput=document.getElementById('printedNameInput');
    if(!hasSig){err.textContent='Please draw your signature before submitting.';err.style.display='block';return;}
    if(nameInput&&!nameInput.value.trim()){err.textContent='Please enter your printed name.';err.style.display='block';return;}
    err.style.display='none';
    btn.disabled=true;
    btn.textContent='Submitting…';
    fetch(FUNC_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({signatureData:canvas.toDataURL('image/png'),printedName:nameInput?nameInput.value.trim():''})
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
        btn.textContent='${esc(sigLabel)}';
      }
    })
    .catch(function(){
      err.textContent='Network error. Please check your connection and try again.';
      err.style.display='block';
      btn.disabled=false;
      btn.textContent='${esc(sigLabel)}';
    });
  });
})();
</script>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${isResidential ? 'Residential' : 'Commercial'} Service Agreement — ${esc(companyName)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827;-webkit-text-size-adjust:100%;}
    .wrap{max-width:760px;margin:0 auto;padding:16px 12px 40px;}
    @media(min-width:800px){.wrap{padding:32px 16px 60px;}}
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
    .legal-text{background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:12px;color:#374151;line-height:1.6;}
    .legal-text h4{margin:0 0 4px;font-size:13px;font-weight:700;color:#1a1a1a;}
    .legal-text hr{border:none;border-top:1px solid #e5e7eb;margin:12px 0;}
    @media print{
      .no-print{display:none!important;}
      body{background:#fff;}
      .wrap{max-width:100%;padding:0;}
      .doc{box-shadow:none;border-radius:0;}
      #sigCard{display:none!important;}
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="doc">

    <!-- Header -->
    <div class="sec" style="text-align:center;padding:16px 24px 12px;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">865-381-3169 | office@knoxexteriorcareco.com | www.knoxexteriorcare.com</p>
      <p style="margin:0;font-size:18px;font-weight:800;color:#111827;">${isResidential ? 'Residential' : 'Commercial'} Master Recurring Service Agreement</p>
    </div>

    <!-- Customer / Business Info -->
    <div class="sec">
      <p class="sec-title">${isResidential ? 'Customer &amp; Property Information' : 'Business &amp; Property Information'}</p>
      ${isResidential ? `
      <div class="field-row">
        <div class="field"><label>Customer Name</label><p>${esc(customerName)}</p></div>
        <div class="field"><label>Email</label><p>${esc(email || '—')}</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Service Address</label><p>${esc(serviceAddress || '—')}</p></div>
        <div class="field"><label>Phone</label><p>${esc(phone || '—')}</p></div>
      </div>
      ${billingAddress ? `<div class="field" style="margin-bottom:10px;"><label>Billing Address (if different)</label><p>${esc(billingAddress)}</p></div>` : ''}
      ${accessNotes ? `<div class="field"><label>Access Instructions / Gate Codes / Notes</label><p style="white-space:pre-wrap;">${esc(accessNotes)}</p></div>` : ''}
      ` : `
      <div class="field-row">
        <div class="field"><label>Business / Client Name</label><p>${esc(businessName || customerName)}</p></div>
        <div class="field"><label>Authorized Representative Name</label><p>${esc(repName || customerName)}</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Title</label><p>${esc(repTitle || '—')}</p></div>
        <div class="field"><label>Service / Property Address</label><p>${esc(serviceAddress || '—')}</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Email</label><p>${esc(email || '—')}</p></div>
        <div class="field"><label>Phone</label><p>${esc(phone || '—')}</p></div>
      </div>
      ${billingAddress ? `<div class="field" style="margin-bottom:10px;"><label>Billing Address (if different)</label><p>${esc(billingAddress)}</p></div>` : ''}
      ${accessNotes ? `<div class="field"><label>Access Instructions / Gate Codes / Notes</label><p style="white-space:pre-wrap;">${esc(accessNotes)}</p></div>` : ''}
      `}
    </div>

    <!-- Plan Selection -->
    <div class="sec">
      <p class="sec-title">Plan Selection</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px 24px;margin-bottom:14px;">
        <div class="check-row">
          <div class="check-box ${isAutopilot ? 'checked' : ''}">${isAutopilot ? '&#x2713;' : ''}</div>
          <span style="font-size:13px;">One-Service Autopilot</span>
        </div>
        <div class="check-row">
          <div class="check-box ${isTCEP ? 'checked' : ''}">${isTCEP ? '&#x2713;' : ''}</div>
          <span style="font-size:13px;">Total Care Exterior Plan (TCEP)</span>
        </div>
        <div class="check-row">
          <div class="check-box ${isTPC ? 'checked' : ''}">${isTPC ? '&#x2713;' : ''}</div>
          <span style="font-size:13px;">Total Property Command (TPC)</span>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Monthly Rate</label><p style="font-size:18px;font-weight:800;color:#3d6b35;">${fmtMoney(monthlyRate)}<span style="font-size:13px;font-weight:500;color:#6b7280;"> / month</span></p></div>
        <div class="field"><label>Service Start Date</label><p>${esc(serviceStartDate)}</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Billing Frequency</label>
          <div class="check-row" style="margin:0;">
            <div class="check-box checked">&#x2713;</div>
            <span style="font-size:13px;">Monthly</span>
          </div>
        </div>
        <div class="field"><label>Plan Review / Renewal Date</label><p>${esc(planReviewDate)}</p></div>
      </div>
      <div class="field"><label>Date of Agreement</label><p>${esc(agreementDate)}</p></div>
    </div>

    <!-- Included Recurring Services -->
    <div class="sec">
      <p class="sec-title">Included Recurring Services</p>
      ${serviceRowsHtml}
    </div>

    ${leadNotes ? `<!-- Property Notes & Additional Caveats -->
    <div class="sec">
      <p class="sec-title">Property Notes &amp; Additional Caveats</p>
      <p style="margin:0 0 8px;font-size:13px;color:#111827;white-space:pre-wrap;">${esc(leadNotes)}</p>
      <p style="margin:0;font-size:10px;color:#9ca3af;font-style:italic;">The above notes were captured at agreement generation and are incorporated into this agreement's scope context.</p>
    </div>` : ''}

    <!-- Bonuses and Guarantees -->
    <div class="sec">
      <div class="legal-text">
        <h4 style="margin-bottom:10px;font-size:14px;">Bonuses and Guarantees &#8212; Plan Tiers, Definitions, and Limitations</h4>
        <p style="margin:0 0 8px;">The bonuses and guarantees offered by Knox Exterior Care Co. (&#8220;KECC&#8221;) are plan-specific. This section defines exactly which benefits apply to each plan type and sets reasonable limits on their use.</p>

        <h4>One-Service Autopilot &#8212; Limited Bonuses and Guarantees</h4>
        <p style="margin:0 0 6px;">Clients on a One-Service Autopilot plan are eligible for a reduced set of guarantees and bonuses as follows:</p>
        <p style="margin:0 0 4px;font-weight:600;">Guarantees included with One-Service Autopilot</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Zero-Risk First Month&#8221;</strong> &#8212; For the first month of a new One-Service Autopilot plan at a given property, if the client is dissatisfied with the recurring service after KECC has performed the first scheduled visit(s) and notifies KECC in writing within a reasonable time (within 7 days of that visit), KECC will refund or credit up to one month of subscription charges for that plan and/or cancel the plan going forward. This guarantee applies only to workmanship and service quality within KECC&#8217;s control and does not apply to outcomes affected by weather, access issues, pre&#8209;existing conditions, or unrealistic expectations.</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Show Up or It&#8217;s Free&#8221;</strong> &#8212; If KECC fails to make a reasonable attempt to perform the scheduled recurring service during the agreed service window(s) for reasons within KECC&#8217;s control, or does not reschedule a delayed service within 24 hours after the original scheduled date, KECC will credit or refund up to one month of subscription charges for that service. This guarantee does not apply where service is delayed, rescheduled, or prevented by lack of access, unsafe or hazardous conditions, customer-requested changes, severe weather, or other events outside KECC&#8217;s control.</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Loyalty Price Lock&#8221;</strong> &#8212; KECC will honor the recurring service rate for the One-Service Autopilot plan stable for the originally quoted scope and typical property conditions, for 12 months after the service agreement is ratified. KECC may adjust pricing with written notice if there are material changes in property size or condition, scope of work, labor or material costs, regulatory requirements, or if services are added or removed. The price lock applies to recurring service fees only and does not limit adjustments for one-off or out-of-scope work.</p>
        <p style="margin:0 0 4px;font-weight:600;">Bonuses included with One-Service Autopilot</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Property Shield Report&#8221;</strong> &#8212; One-time, high-level written summary of notable exterior conditions and maintenance observations for the property, delivered in a standard format and frequency determined by KECC.</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Curb Appeal Photo Set&#8221;</strong> &#8212; Periodic exterior photos of key serviced areas (such as entry, frontage, or main visible areas), provided in a reasonable number and format determined by KECC to document appearance and improvements over time.</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Neighbor Referral Credit&#8221;</strong> &#8212; $100 Credit applied to one future invoice when a new qualifying customer signs up, remains active under KECC&#8217;s then-current criteria, and lists the client as the referrer. Credits are not cash, may be capped in number or value per client, and may not be stacked beyond KECC&#8217;s referral policy.</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Service Reminders&#8221;</strong> &#8212; Reasonable reminders of upcoming visits using KECC&#8217;s standard communication channels (for example, email, text, phone, or app notifications, as available), subject to system and routing capabilities.</p>
        <p style="margin:0 0 4px;font-weight:600;">Limitations for One-Service Autopilot</p>
        <p style="margin:0 0 4px;">One-Service Autopilot plans do not receive any additional bonuses or guarantees reserved for higher-tier plans unless expressly stated in writing.</p>
        <p style="margin:0 0 4px;">All bonuses are provided in a reasonable, standard format and frequency determined by KECC; they are not unlimited, on-demand, or fully custom deliverables.</p>
        <p style="margin:0 0 10px;">All bonuses and guarantees have no cash value, are non-transferable, and may not be redeemed for cash or combined with other offers except at KECC&#8217;s discretion.</p>

        <hr/>
        <h4>Total Care Exterior Plans and Total Property Command &#8212; Full Bonuses and Guarantees</h4>
        <p style="margin:0 0 6px;">Clients on Total Care Exterior Plans (TCEP) and Total Property Command (TPC) are eligible for the full bonus and guarantee set, which includes everything in the One-Service Autopilot tier above plus any additional plan-specific benefits described here.</p>
        <p style="margin:0 0 4px;font-weight:600;">Guarantees included with TCEP and TPC</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Beat Any Comparable Quote&#8221;</strong> &#8212; KECC will attempt to beat or match a current written quote from another insured provider for a comparable scope and frequency of recurring exterior services at the same property. The client must provide a quote dated within 30 days that clearly describes services and frequency. KECC alone decides if the quote is comparable. KECC is not required to match prices that are unsustainably low, incomplete, promotional loss-leaders, or inconsistent with KECC&#8217;s safety, quality, or insurance standards. KECC may fulfill this by adjusting scope or structure of the plan, not necessarily matching every line item.</p>
        <p style="margin:0 0 4px;font-weight:600;">Bonuses included with TCEP and TPC</p>
        <p style="margin:0 0 6px;">TCEP and TPC plans include all bonuses listed for One-Service Autopilot (Property Shield Report, Curb Appeal Photo Set, Neighbor Referral Credit, Service Reminders) on a broader or more robust basis, plus any higher-tier bonuses KECC may add for these plans. Additionally, TCEP and TPC plans include:</p>
        <p style="margin:0 0 6px;"><strong>&#8220;Seasonal Plan Adjustments&#8221;</strong> &#8212; KECC may shift which tasks are emphasized and when they are performed over the year (for example, more mowing in growth season, more leaf/ice work in fall/winter) while keeping the overall annual service level and blended subscription value roughly consistent. Routine seasonal adjustments do not change the agreed monthly rate, unless a specific service is explicitly paused for more than one month&#8217;s time due to seasonal need or property need.</p>
        <p style="margin:0 0 10px;"><strong>&#8220;Priority Scheduling&#8221;</strong> &#8212; the client&#8217;s property is given preferred placement in KECC&#8217;s normal routing and rescheduling ahead of non-priority customers, especially after weather delays. This is a relative preference only and does not guarantee specific dates, times, or response speeds. All services remain subject to weather, safety, staffing, and routing constraints, and KECC is not liable for business interruption or lost revenue due to schedule changes.</p>

        <hr/>
        <p style="margin:0 0 4px;font-weight:600;">General limitations for all bonuses and guarantees (all plans)</p>
        <p style="margin:0 0 4px;">The client must be active and current on payments for the applicable plan when a bonus or guarantee is earned, delivered, or claimed.</p>
        <p style="margin:0 0 4px;">Bonuses and guarantees do not expand or override the core service scope defined elsewhere in this agreement and do not convert KECC into an unlimited inspection, consulting, or emergency-response provider.</p>
        <p style="margin:0 0 4px;">KECC provides bonuses and guarantees in quantities and frequencies that are reasonable for the plan type; repeat, custom, or on-demand versions beyond normal practice may be declined or quoted separately.</p>
        <p style="margin:0 0 4px;">KECC may adjust, pause, or discontinue specific bonuses or guarantees on a prospective basis, provided that any benefit already earned or specifically promised in writing will be honored under its stated terms.</p>
        <p style="margin:0 0 0;">KECC may reasonably decline or limit claims that appear abusive, fraudulent, or clearly outside the spirit and intent of the offer.</p>
      </div>
    </div>

    <!-- Billing, Term & Proration -->
    <div class="sec">
      <div class="legal-text">
        <h4>Billing, Term &amp; Proration</h4>
        <p style="margin:0;">Services are billed on a recurring subscription basis, in advance, starting on or around the first scheduled service window. The monthly rate is a blended/averaged amount reflecting all included services over the plan term and is not tied to any single visit&#8217;s price. Either party may cancel at any time with written or emailed notice. Upon cancellation, KECC will calculate the value of services already delivered at KECC&#8217;s then-current standard (non-subscriber) rates and compare that to subscription payments collected to date. If delivered service value exceeds payments collected, the ${party} agrees to pay a pro-rated final balance for the difference. If payments collected exceed services delivered, KECC will refund or credit the difference. Scope and pricing may be adjusted with at least 30 days&#8217; written notice if property conditions, labor costs, materials, or service requirements materially change.${billingExtra}</p>
      </div>
    </div>

    <!-- Access, Scheduling & Safety -->
    <div class="sec">
      <div class="legal-text">
        <h4>Access, Scheduling &amp; Safety</h4>
        <p style="margin:0;">${isResidential ? 'Customer' : 'Client'} will provide reasonable safe access (unlocked gates, codes, removal of aggressive ${isResidential ? 'pets' : 'animals'}, etc.). KECC schedules services during normal business hours based on routing efficiency and weather. KECC may skip, modify, or reschedule services if unsafe or impractical conditions exist (severe weather, unsafe ladder/roof access, hazardous materials, blocked areas, active construction). Skipped items may be rolled into a future visit where practical, as pricing is based on blended subscription value, not per-visit charges. KECC is not responsible for loss of business or consequential damages related to normal schedule changes or delays.</p>
      </div>
    </div>

    <!-- Scope Limitations & Exclusions -->
    <div class="sec">
      <div class="legal-text">
        <h4>Scope Limitations &amp; Exclusions</h4>
        <p style="margin:0;">This agreement covers only services explicitly selected (checked) in the checklist and any written custom items in the notes. Work requiring specialty trades (roofing, structural repairs, electrical, plumbing, HVAC, major concrete/asphalt repair${!isResidential ? ', sign fabrication' : ''}) is outside scope. KECC does not include hazardous material cleanup, emergency response, or remediation unless specifically written into the plan. KECC is not responsible for pre-existing damage, existing defects, failing materials, or hidden conditions. KECC is not responsible for damage to underground utilities, unmarked obstacles, or items hidden in turf or work areas not disclosed (hoses, cables, toys, shallow irrigation heads, etc.). Light wear and minor disturbance of delicate surfaces may occur despite reasonable care.</p>
      </div>
    </div>

    <!-- Cancellation -->
    <div class="sec">
      <div class="legal-text">
        <h4>Cancellation</h4>
        <p style="margin:0;">${cancellationText}</p>
      </div>
    </div>

    <!-- Customer Acknowledgment -->
    <div class="sec">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <div class="check-box checked" style="margin-top:2px;">&#x2713;</div>
        <p style="margin:0;font-size:13px;color:#111827;"><strong>${isResidential ? 'Customer' : 'Client'} Acknowledgment:</strong> ${isResidential ? 'Customer' : 'Client'} acknowledges that the services, frequencies, and pricing selected and written on this agreement represent the complete scope of recurring services, unless amended in writing.</p>
      </div>
    </div>

    <!-- Signature Section -->
    <div class="sec">
      <hr class="sig-divider"/>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px;">
        <!-- KECC signature (pre-filled, not interactive) -->
        <div>
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Knox Exterior Care Co. &#8212; Authorized Signature</p>
          ${keccSigHtml}
          <p style="margin:4px 0 0;font-size:12px;color:#374151;border-top:1px solid #e5e7eb;padding-top:4px;">Nicholas G Dunn, Owner</p>
          <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">${esc(agreementDate)}</p>
        </div>
        <!-- Customer/Client section label -->
        <div>
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">${isResidential ? 'Customer Signature' : 'Authorized Representative Signature'}</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;font-style:italic;">See signature pad below</p>
        </div>
      </div>

      ${customerSigSection}

      <p style="font-size:11px;color:#9ca3af;margin-top:16px;text-align:center;">
        Knox Exterior Care Co. | Questions about this agreement? Contact your KECC representative directly. Completed agreements should be retained by both parties for the duration of the service relationship and for a minimum of one year following cancellation.
      </p>
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
        // Fetch linked quote (prefer quote_id on agreement), subscription, contact
        const [quoteLinkedRes, subRes, contactRes] = await Promise.all([
          agreementRow.quote_id
            ? supabase.from('quotes').select('*').eq('id', agreementRow.quote_id).single()
            : Promise.resolve({ data: null }),
          agreementRow.subscription_id
            ? supabase.from('subscriptions').select('*').eq('id', agreementRow.subscription_id).single()
            : Promise.resolve({ data: null }),
          agreementRow.contact_id
            ? supabase.from('contacts').select('*').eq('id', agreementRow.contact_id).single()
            : Promise.resolve({ data: null }),
        ])

        const quoteLinked = quoteLinkedRes.data
        const sub         = subRes.data
        const contact     = contactRes.data
        const qt          = quoteLinked?.quote_type ?? agreementRow.quote_type ?? ''
        const isRes       = !qt.includes('commercial')
        const planType    = detectPlanType(qt)
        const keccSigData = settings?.owner_signature_data ?? null

        // Build line items from linked quote or subscription services
        let lineItems: LineItemData[] = []
        if (quoteLinked && Array.isArray(quoteLinked.line_items)) {
          lineItems = quoteLinked.line_items as LineItemData[]
        } else if (sub && Array.isArray(sub.services)) {
          lineItems = (sub.services as Record<string, unknown>[]).map(s => ({
            serviceName:  String(s.serviceName ?? ''),
            description:  s.description ? String(s.description) : undefined,
            monthlyAmount: Number(s.pricePerMonth ?? 0),
            lineTotal:    Number(s.pricePerMonth ?? 0),
            isSubscription: true,
          }))
        }

        const checkedServices = mapLineItemsToServices(lineItems, isRes)

        // Monthly rate: from linked quote's subscription items, or subscription total
        const monthlyRate = quoteLinked
          ? (Array.isArray(quoteLinked.line_items) ? quoteLinked.line_items : [])
              .filter((li: LineItemData) => li.isSubscription)
              .reduce((sum: number, li: LineItemData) => sum + (li.monthlyAmount ?? li.lineTotal ?? 0), 0)
          : (sub?.in_season_monthly_total ?? 0)

        const today = new Date()
        const agreementDate  = today.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        const planReviewDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
          .toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

        const funcUrl = `/.netlify/functions/esign?token=${encodeURIComponent(token)}`

        const html = buildFullAgreementPage({
          token,
          isResidential:    isRes,
          quoteType:        qt || null,
          companyName,
          companyPhone:     settings?.phone  ?? null,
          companyEmail:     settings?.email  ?? null,
          logoUrl,
          customerName:     agreementRow.customer_name ?? (contact?.name ?? ''),
          businessName:     contact?.business_name ?? null,
          repName:          contact?.name ?? null,
          repTitle:         null,
          serviceAddress:   agreementRow.customer_address ?? (quoteLinked?.customer_address ?? sub?.customer_address ?? null),
          billingAddress:   null,
          email:            agreementRow.customer_email ?? contact?.email ?? quoteLinked?.customer_email ?? sub?.customer_email ?? null,
          phone:            agreementRow.customer_phone ?? contact?.phone ?? quoteLinked?.customer_phone ?? sub?.customer_phone ?? null,
          accessNotes:      null,
          planType,
          monthlyRate,
          agreementDate,
          serviceStartDate: agreementDate,
          planReviewDate,
          checkedServices,
          leadNotes:        agreementRow.lead_notes ?? null,
          keccSigData,
          alreadySigned:    !!agreementRow.signed_at,
          signedAt:         agreementRow.signed_at ?? null,
          signerPrintedName: agreementRow.signer_printed_name ?? null,
          signatureData:    agreementRow.signature_data ?? null,
          funcUrl,
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

      let body: { signatureData?: string; printedName?: string } = {}
      try { body = JSON.parse(event.body ?? '{}') } catch (_e) { /* ignore */ }

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
          // Freeze the original total at signing — amendments layer on top of this
          ...(quoteRow.original_total == null ? { original_total: quoteRow.total } : {}),
        }).eq('id', quoteRow.id)
        if (error) throw new Error(error.message)

        // Log quote signing activity
        if (quoteRow.contact_id) {
          await supabase.from('activities').insert({
            contact_id: quoteRow.contact_id,
            type:       'esign_completed',
            summary:    `Quote signed by ${quoteRow.customer_name}`,
            metadata:   { quoteId: quoteRow.id },
          }).catch(() => {}) // activities insert — always a real Promise, this is fine
        }

        // ── Fetch SMS credentials (needed for both confirmation + agreement SMS) ──
        const { data: settings } = await supabase
          .from('company_settings').select('quo_api_key, quo_from_number, company_name').limit(1).single()
        const apiKey      = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
        const fromNumber  = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
        const companyName = settings?.company_name    ?? 'Knox Exterior Care Co.'
        const siteUrl     = (process.env.URL ?? '').replace(/\/$/, '')
        const firstName   = (quoteRow.customer_name ?? 'there').split(' ')[0]

        // ── Confirmation SMS: signed copy link ────────────────────────────────
        // The esign page already renders a "✅ Signed" receipt view once signed_at is set,
        // so the same URL serves as a permanent signed copy the customer can bookmark.
        if (apiKey && fromNumber && quoteRow.customer_phone) {
          const signedCopyUrl = `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(token)}`
          const confirmMsg =
            `Hi ${firstName}, your estimate with ${companyName} has been signed — thank you! ` +
            `You can view your signed copy anytime here: ${signedCopyUrl} ` +
            `We'll be in touch soon. Reply STOP to opt out.`
          try { await sendOpenPhoneSms(apiKey, fromNumber, quoteRow.customer_phone, confirmMsg) } catch (_e) { /* non-fatal */ }
          try { await supabase.from('activities').insert({
            contact_id: quoteRow.contact_id,
            type:       'sms_out',
            summary:    `Signed copy link sent to ${quoteRow.customer_name}`,
            metadata:   { quoteId: quoteRow.id },
          }) } catch (_e) { /* non-fatal */ }
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) }
      }

      if (agreementRow) {
        if (agreementRow.signed_at) {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: 'Already signed' }) }
        }
        const { error } = await supabase.from('service_agreements').update({
          status:               'signed',
          signed_at:            signedAt,
          signature_data:       body.signatureData,
          signed_ip:            signedIp,
          updated_at:           signedAt,
          signer_printed_name:  body.printedName ?? null,
        }).eq('id', agreementRow.id)
        if (error) throw new Error(error.message)

        // Flip subscription to ACTIVE and link agreement
        if (agreementRow.subscription_id) {
          try {
            await supabase.from('subscriptions').update({
              status:       'ACTIVE',
              agreement_id: agreementRow.id,
            }).eq('id', agreementRow.subscription_id)
          } catch (_e) { /* non-fatal */ }
        }

        // Stamp agreement_signed_at on the most recent non-lost lead for this contact.
        // This gates the "Schedule Job" button in the lead detail sheet.
        if (agreementRow.contact_id) {
          try {
            await supabase.from('leads')
              .update({ agreement_signed_at: signedAt })
              .eq('contact_id', agreementRow.contact_id)
              .not('stage', 'eq', 'lost')
              .order('created_at', { ascending: false })
              .limit(1)
          } catch (_e) { /* non-fatal */ }
        }

        // Advance lead to "Recurring" when service agreement is signed
        await advanceLeadStage(supabase, {
          quoteId:   null,
          contactId: agreementRow.contact_id ?? null,
          stage:     'recurring',
        })

        // Log esign_completed activity on the contact
        if (agreementRow.contact_id) {
          try { await supabase.from('activities').insert({
            contact_id: agreementRow.contact_id,
            type:       'esign_completed',
            summary:    `Service agreement signed by ${agreementRow.customer_name ?? 'customer'}`,
            metadata:   { agreementId: agreementRow.id, quoteId: agreementRow.quote_id ?? null },
          }) } catch (_e) { /* non-fatal */ }
        }

        // ── Confirmation SMS: signed agreement copy link ───────────────────────
        try {
          const { data: agreeSettings } = await supabase
            .from('company_settings').select('quo_api_key, quo_from_number, company_name').limit(1).single()
          const agreeApiKey     = agreeSettings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
          const agreeFromNumber = agreeSettings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
          const agreeCompany    = agreeSettings?.company_name    ?? 'Knox Exterior Care Co.'
          const agrSiteUrl      = (process.env.URL ?? '').replace(/\/$/, '')

          // Use customer_phone directly on agreementRow first, then fall back to contact
          let customerPhone: string | null = agreementRow.customer_phone ?? null
          if (!customerPhone && agreementRow.contact_id) {
            const { data: contactRow } = await supabase
              .from('contacts').select('phone').eq('id', agreementRow.contact_id).single()
            customerPhone = contactRow?.phone ?? null
          }

          if (agreeApiKey && agreeFromNumber && customerPhone) {
            const signedCopyUrl = `${agrSiteUrl}/.netlify/functions/esign?token=${encodeURIComponent(token)}`
            const agreFirstName = (agreementRow.customer_name ?? 'there').split(' ')[0]
            const confirmMsg =
              `Hi ${agreFirstName}, your service agreement with ${agreeCompany} is signed and on file — thank you! ` +
              `View your signed agreement anytime here: ${signedCopyUrl} ` +
              `We'll reach out to get you on the schedule. Reply STOP to opt out.`
            await sendOpenPhoneSms(agreeApiKey, agreeFromNumber, customerPhone, confirmMsg)
            try { await supabase.from('activities').insert({
              contact_id: agreementRow.contact_id,
              type:       'sms_out',
              summary:    `Signed agreement copy link sent to ${agreementRow.customer_name}`,
              metadata:   { agreementId: agreementRow.id },
            }) } catch (_e) { /* non-fatal */ }
          }
        } catch (confirmErr) {
          // Non-fatal — agreement signing already succeeded
          console.error('[esign] Failed to send agreement confirmation SMS:', confirmErr)
        }

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
