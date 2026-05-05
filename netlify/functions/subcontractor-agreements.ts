import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')
import { sendOpenPhoneSms } from './_smsHelper'
import { sendEmail } from './_emailHelper'

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

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
}

// ── helpers ────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDateLong(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function errPage(title: string, msg: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100dvh;background:#f3f4f6;}
.box{text-align:center;padding:40px 24px;max-width:360px;}h2{margin:0 0 8px;color:#111;}p{color:#6b7280;font-size:14px;margin:0;}</style>
</head><body><div class="box"><div style="font-size:48px;margin-bottom:16px;">⚠️</div>
<h2>${esc(title)}</h2><p>${esc(msg)}</p></div></body></html>`
}

// ── SCA HTML page ──────────────────────────────────────────────────────────

function buildScaPage(opts: {
  token: string
  contractorName: string
  entityType: string | null
  effectiveDate: string
  keccSigData: string | null
  subSigData: string | null
  subPrintedName: string | null
  subPhone: string | null
  subEmail: string | null
  signedAt: string | null
  alreadySigned: boolean
  funcUrl: string
}): string {
  const {
    token, contractorName, entityType, effectiveDate, keccSigData,
    subSigData, subPrintedName, subPhone, subEmail, signedAt, alreadySigned, funcUrl,
  } = opts

  const subLabel = entityType ? `${esc(contractorName)} (${esc(entityType)})` : esc(contractorName)
  const effectiveDateFmt = fmtDateLong(effectiveDate)
  const signedAtFmt = signedAt ? new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : ''

  // KECC signature block
  const keccSigBlock = keccSigData
    ? `<img src="${esc(keccSigData)}" alt="KECC Signature" style="max-height:60px;max-width:220px;display:block;"/>`
    : `<span style="font-family:'Brush Script MT',cursive;font-size:28px;color:#1e3a5f;">Nicholas G Dunn</span>`

  // Subcontractor signature block (for already-signed view)
  const subSigBlock = subSigData
    ? `<img src="${esc(subSigData)}" alt="Subcontractor Signature" style="max-height:60px;max-width:220px;display:block;"/>`
    : ''

  const sigCardHtml = alreadySigned ? `
    <div id="successCard" style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px;margin-top:24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">✅</div>
      <p style="margin:0 0 4px;font-weight:600;color:#166534;">Agreement Signed</p>
      <p style="margin:0;font-size:13px;color:#4b7a5a;">Signed by ${esc(subPrintedName ?? contractorName)} on ${signedAtFmt}</p>
      <button onclick="window.print()" class="no-print" style="margin-top:16px;padding:10px 20px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">Download PDF</button>
    </div>` : `
    <div id="sigCard" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-top:24px;">
      <h3 style="margin:0 0 12px;font-size:15px;color:#111827;">Your Signature</h3>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Draw your signature below, then enter your printed name and submit.</p>

      <div style="border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#fafafa;margin-bottom:12px;">
        <canvas id="sigCanvas" style="display:block;touch-action:none;cursor:crosshair;"></canvas>
      </div>

      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Printed Name *</label>
        <input id="printedNameInput" type="text" placeholder="Your full legal name" value="${esc(contractorName)}"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"/>
      </div>

      <div id="errMsg" style="display:none;color:#dc2626;font-size:13px;margin-bottom:8px;"></div>

      <div style="display:flex;gap:8px;">
        <button id="clearBtn" class="no-print" style="flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-size:14px;cursor:pointer;color:#374151;">Clear</button>
        <button id="submitBtn" class="no-print" style="flex:2;padding:10px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;">Sign Agreement</button>
      </div>
    </div>
    <div id="successCard" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px;margin-top:24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">✅</div>
      <p style="margin:0 0 4px;font-weight:600;color:#166534;">Agreement Signed!</p>
      <p style="margin:0;font-size:13px;color:#4b7a5a;">A PDF copy has been sent to you. Thank you!</p>
    </div>`

  // Subcontractor signature section in the signature page
  const subSigSection = alreadySigned ? `
    <div style="border:1px solid #d1d5db;border-radius:8px;padding:14px;min-height:70px;background:#f9fafb;margin-bottom:8px;">
      ${subSigBlock}
    </div>
    <p style="margin:4px 0 2px;font-size:13px;"><strong>Printed Name:</strong> ${esc(subPrintedName ?? '')}</p>
    <p style="margin:2px 0;font-size:13px;"><strong>Date &amp; Time:</strong> ${signedAtFmt}</p>
    ${subPhone ? `<p style="margin:2px 0;font-size:13px;"><strong>Phone:</strong> ${esc(subPhone)}</p>` : ''}
    ${subEmail ? `<p style="margin:2px 0;font-size:13px;"><strong>Email:</strong> ${esc(subEmail)}</p>` : ''}
  ` : `
    <p style="margin:2px 0;font-size:13px;"><strong>Phone:</strong> ${esc(subPhone ?? '')}</p>
    ${subEmail ? `<p style="margin:2px 0;font-size:13px;"><strong>Email:</strong> ${esc(subEmail)}</p>` : ''}
    <p style="margin:6px 0;font-size:12px;color:#6b7280;font-style:italic;">[Signature and date will be captured below]</p>
  `

  const scriptHtml = alreadySigned ? '' : `<script>
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
    var nameVal=document.getElementById('printedNameInput').value.trim();
    if(!hasSig){err.textContent='Please draw your signature before submitting.';err.style.display='block';return;}
    if(!nameVal){err.textContent='Please enter your printed name.';err.style.display='block';return;}
    err.style.display='none';
    btn.disabled=true;
    btn.textContent='Submitting…';
    fetch(FUNC_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({signatureData:canvas.toDataURL('image/png'),printedName:nameVal})
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
        btn.textContent='Sign Agreement';
      }
    })
    .catch(function(){
      err.textContent='Network error. Please check your connection and try again.';
      err.style.display='block';
      btn.disabled=false;
      btn.textContent='Sign Agreement';
    });
  });
})();
</script>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Subcontractor Agreement — Knox Exterior Care Co.</title>
  <style>
    *{box-sizing:border-box;}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#111827;background:#f3f4f6;line-height:1.5;}
    .page{max-width:780px;margin:0 auto;background:#fff;padding:32px 24px 48px;}
    h1{font-size:20px;font-weight:800;color:#1e3a5f;margin:0 0 4px;}
    .subtitle{font-size:13px;color:#6b7280;margin:0 0 20px;}
    h2{font-size:14px;font-weight:700;color:#1e3a5f;margin:20px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;}
    h3{font-size:13px;font-weight:700;color:#1e3a5f;margin:12px 0 4px;}
    p{margin:4px 0;}
    ul{margin:4px 0 4px 18px;padding:0;}
    li{margin:2px 0;}
    .parties{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px;}
    .sig-section{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;}
    .sig-box{border:1px solid #d1d5db;border-radius:8px;padding:14px;}
    .sig-box h4{margin:0 0 10px;font-size:13px;font-weight:700;color:#1e3a5f;}
    .sig-line{border:1px solid #d1d5db;border-radius:6px;min-height:64px;padding:8px;background:#fafafa;margin-bottom:8px;}
    .critical{background:#fff7ed;border-left:3px solid #f97316;padding:8px 12px;margin:8px 0;border-radius:0 6px 6px 0;}
    .critical strong{color:#c2410c;}
    @media(max-width:600px){.sig-section{grid-template-columns:1fr;}}
    @media print{
      .no-print{display:none!important;}
      body{background:#fff;}
      .page{padding:16px;}
    }
  </style>
</head>
<body>
<div class="page">

  <h1>KNOX EXTERIOR CARE CO.</h1>
  <p class="subtitle">Subcontractor Agreement</p>

  <div class="parties">
    <p><strong>EFFECTIVE DATE:</strong> ${esc(effectiveDateFmt)}</p>
    <p style="margin-top:8px;"><strong>BETWEEN:</strong> "KECC" — Knox Exterior Care Co. LLC, a Tennessee business (hereinafter "Contractor")</p>
    <p style="margin-top:4px;"><strong>AND:</strong> "Subcontractor" — ${subLabel} (hereinafter "Subcontractor")</p>
  </div>

  <h2>Section 1 — INDEPENDENT CONTRACTOR STATUS</h2>
  <p>1.1 Subcontractor is engaged as an independent contractor, not as an employee of KECC. Subcontractor shall:</p>
  <ul>
    <li>Maintain complete control over the manner and means of performing the Work</li>
    <li>Provide their own tools, equipment, and materials (unless otherwise agreed in writing)</li>
    <li>Set their own schedule and work hours</li>
    <li>Be solely responsible for all payroll taxes, self-employment taxes, and business expenses</li>
    <li>Not be entitled to employee benefits, workers' compensation coverage, or unemployment insurance</li>
  </ul>
  <p>1.2 Subcontractor acknowledges they will receive a 1099-NEC from KECC for tax reporting purposes if annual payments exceed $600.</p>

  <h2>Section 2 — SCOPE OF WORK</h2>
  <p>2.1 Subcontractor agrees to provide services that are in line with what the Subcontractor routinely and typically offers, potentially including but not limited to: Professional pressure washing, soft washing, gutter cleaning, lawn maintenance, window cleaning, and related exterior cleaning &amp; maintenance</p>
  <p>2.2 Work shall be performed in a professional, safe, and workmanlike manner, in compliance with:</p>
  <ul>
    <li>All applicable Tennessee laws and local codes</li>
    <li>All applicable OSHA safety standards</li>
    <li>KECC's written instructions and quality standards</li>
    <li>The customer's reasonable requests (as communicated by KECC)</li>
  </ul>
  <p>2.3 Subcontractor shall complete the Work by the date(s) specified by KECC. Time is of the essence.</p>

  <h2>Section 3 — COMPENSATION</h2>
  <p>3.1 KECC shall pay Subcontractor the agreed upon rate, in writing, for each specified job.</p>
  <p>3.2 Payment terms:</p>
  <ul>
    <li>Invoices must be submitted within [10] business days of job completion</li>
    <li>Payment will be made within [30] business days of receipt of invoice</li>
    <li>Payment method: any of cash, check, ACH, other</li>
  </ul>
  <p>3.3 Subcontractor is responsible for tracking and reporting their own income to the IRS. KECC will issue a 1099-NEC if total payments in a calendar year exceed $600.</p>
  <p>3.4 No deductions or withholdings will be made from Subcontractor's compensation for taxes, Social Security, Medicare, or any other purpose. Subcontractor is solely responsible for all such obligations.</p>

  <h2>Section 4 — INSURANCE AND LIABILITY</h2>
  <div class="critical"><strong>[THIS IS A CRITICAL SECTION FOR KECC'S PROTECTION]</strong></div>
  <h3>4.1 General Liability Insurance Requirement</h3>
  <p>Subcontractor shall, prior to commencing any Work, obtain and maintain a Commercial General Liability (CGL) insurance policy, issued by an insurer rated A:VII or better by A.M. Best, with the following minimum limits: $1,000,000 per occurrence / $2,000,000 aggregate. Coverage for bodily injury, property damage, and personal/advertising injury. Coverage on an "occurrence" basis (not "claims-made").</p>
  <h3>4.2 Additional Insured Endorsement (CRITICAL)</h3>
  <p>Subcontractor shall provide KECC with a Certificate of Insurance (COI) prior to starting any Work, which names Knox Exterior Care Co. as an "additional insured", coverage as primary and non-contributory (KECC's coverage is excess), both ongoing and completed operations. Subcontractor shall request an ISO Form CG 20 10 (or equivalent) additional insured endorsement from their insurer. A copy of the actual endorsement (not just the COI) is required on file with KECC.</p>
  <h3>4.3 Proof of Coverage</h3>
  <p>Subcontractor shall provide: Original or certified copy of the Certificate of Insurance before any Work begins. Updated COI if coverage changes or renews. Copy of the additional insured endorsement as proof of coverage. Failure to provide proof of adequate insurance will result in immediate termination of this Agreement and suspension of work.</p>
  <h3>4.4 Continuation of Coverage</h3>
  <p>Subcontractor shall maintain continuous coverage for a minimum of 36 months after job completion to cover claims that may arise after Work is finished (completed operations coverage).</p>
  <h3>4.5 Indemnification</h3>
  <p>To the fullest extent permitted by Tennessee law, Subcontractor shall indemnify, defend (at Subcontractor's sole cost and expense), and hold harmless KECC, its owner, employees, agents, and the property owner from: All claims, damages, liabilities, and costs (including attorney fees) arising from or related to Subcontractor's performance or non-performance of the Work. Bodily injury or death caused by Subcontractor's work. Property damage caused by Subcontractor. Subcontractor's violation of any law or regulation. Subcontractor's failure to maintain required insurance.</p>
  <h3>4.6 Worker Classification</h3>
  <p>Subcontractor acknowledges they are responsible for: Their own workers' compensation insurance (if required by law). All employee-related payroll taxes and withholdings. Any employees or sub-subcontractors they may hire (and those parties must also meet KECC's insurance requirements).</p>

  <h2>Section 5 — LIMITATION OF LIABILITY</h2>
  <p>5.1 KECC is not responsible for: Subcontractor's equipment, tools, or personal property brought to the job site. Injury to Subcontractor or Subcontractor's employees or sub-subcontractors. Any property damage caused by Subcontractor's negligence or willful misconduct. Any delay or failure to perform due to circumstances beyond Subcontractor's reasonable control (force majeure).</p>
  <p>5.2 Subcontractor assumes all risk of loss or damage to their own equipment and property while performing Work under this Agreement.</p>

  <h2>Section 6 — QUALITY AND COMPLIANCE</h2>
  <p>6.1 Subcontractor warrants that: All Work will be performed in a professional and workmanlike manner. All Work will comply with applicable Tennessee law, local codes, and industry standards. Subcontractor has the necessary skills, experience, and licensing (if required by law) to perform the Work. Work will be completed safely and without hazard to persons or property.</p>
  <p>6.2 KECC reserves the right to inspect Work at any time. If Work does not meet KECC's quality standards, KECC may: Require Subcontractor to correct defects at no additional cost to KECC or the customer. Hire another contractor to correct defects and deduct the cost from Subcontractor's payment. Terminate this Agreement immediately for non-compliance.</p>
  <p>6.3 Subcontractor shall clean up all debris and restore the job site to its original condition at the end of each Work day.</p>

  <h2>Section 7 — CUSTOMER RELATIONS AND CONFIDENTIALITY</h2>
  <p>7.1 Subcontractor agrees to: Treat all customers professionally and courteously. Not directly solicit or contact KECC customers for independent work. Not disclose customer contact information, pricing, or details to third parties. Represent KECC positively and professionally at all times.</p>
  <p>7.2 Subcontractor acknowledges that customer relationships and pricing information belong to KECC. Violation of this section may result in immediate termination and legal action.</p>

  <h2>Section 8 — TERMINATION</h2>
  <p>8.1 At-Will Relationship: Either party may terminate this Agreement at any time, with or without cause, through verbal or written communication. Upon termination: Subcontractor shall immediately cease performing Work. Subcontractor shall return any KECC property or materials. KECC shall pay for Work already completed (minus any corrections required).</p>
  <p>8.2 Immediate Termination for Cause: KECC may terminate this Agreement immediately if Subcontractor: Fails to maintain required insurance. Violates safety laws or OSHA standards. Misrepresents KECC or acts unprofessionally toward customers. Performs Work that does not meet quality standards. Violates any material term of this Agreement.</p>

  <h2>Section 9 — SAFETY AND COMPLIANCE</h2>
  <p>9.1 Subcontractor shall: Follow all OSHA safety regulations. Use proper safety equipment and clothing as required by law. Report any job site hazards or accidents to KECC immediately. Not operate any equipment under the influence of drugs or alcohol. Comply with all customer property rules and restrictions.</p>
  <p>9.2 Subcontractor is solely responsible for their own safety and the safety of any employees or sub-subcontractors they hire.</p>

  <h2>Section 10 — TOOLS, EQUIPMENT, AND MATERIALS</h2>
  <p>10.1 Unless otherwise agreed in writing, Subcontractor shall provide all tools, equipment, and materials necessary to complete the Work.</p>
  <p>10.2 KECC may provide specified equipment or materials. In that case, Subcontractor shall: Use such equipment only for the specified job. Return all equipment in good condition (normal wear and tear excepted). Reimburse KECC for any loss, theft, or damage caused by Subcontractor's negligence.</p>

  <h2>Section 11 — INVOICING AND PAYMENT DISPUTES</h2>
  <p>11.1 Subcontractor shall submit itemized invoices within [10] business days of job completion, including: Date and description of Work performed. Hours worked (if hourly) or scope (if fixed-price). Any materials or expenses claimed.</p>
  <p>11.2 KECC will pay invoices within [15] business days unless there is a good-faith dispute regarding: Work quality or completeness. Hours or scope discrepancy. Unauthorized charges.</p>
  <p>11.3 Disputed invoices will be handled through good-faith discussion. If unresolved, KECC may withhold payment pending resolution, but will not unreasonably delay payment.</p>

  <h2>Section 12 — NO THIRD-PARTY BENEFICIARIES</h2>
  <p>12.1 This Agreement is between KECC and Subcontractor only. Customers, their families, and third parties have no rights under this Agreement.</p>

  <h2>Section 13 — ENTIRE AGREEMENT AND AMENDMENTS</h2>
  <p>13.1 This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions, emails, and verbal agreements.</p>
  <p>13.2 No amendment or modification is valid unless made in writing and signed by both parties.</p>

  <h2>Section 14 — GOVERNING LAW</h2>
  <p>14.1 This Agreement shall be governed by and construed in accordance with the laws of the State of Tennessee, without regard to its conflict-of-laws principles.</p>
  <p>14.2 Any disputes shall be resolved in the state or federal courts located in Knox County, Tennessee.</p>

  <h2>Section 15 — SEVERABILITY</h2>
  <p>15.1 If any portion of this Agreement is found to be invalid or unenforceable, the remaining portions shall remain in full force and effect.</p>

  <!-- Signatures -->
  <h2 style="margin-top:32px;">SIGNATURES</h2>
  <div class="sig-section">
    <!-- KECC -->
    <div class="sig-box">
      <h4>KECC — CONTRACTOR</h4>
      <div class="sig-line">
        ${keccSigBlock}
      </div>
      <p style="margin:4px 0 2px;font-size:13px;"><strong>Printed Name &amp; Title:</strong> Nicholas G Dunn, Owner</p>
      <p style="margin:2px 0;font-size:13px;"><strong>Date:</strong> ${esc(effectiveDateFmt)}</p>
    </div>

    <!-- Subcontractor -->
    <div class="sig-box">
      <h4>SUBCONTRACTOR</h4>
      ${subSigSection}
    </div>
  </div>

  ${sigCardHtml}

</div>
${scriptHtml}
</body>
</html>`
}

// ── PDF generation (pdfkit) ────────────────────────────────────────────────

async function generateScaPdf(opts: {
  contractorName: string
  entityType: string | null
  effectiveDate: string
  keccSigData: string | null
  subSigData: string | null
  subPrintedName: string | null
  subPhone: string | null
  subEmail: string | null
  signedAt: string | null
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 50, right: 50 } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const BLUE = '#1e3a5f'
    const GRAY = '#6b7280'
    const W = doc.page.width - 100

    const subLabel = opts.entityType
      ? `${opts.contractorName} (${opts.entityType})`
      : opts.contractorName
    const effectiveDateFmt = fmtDateLong(opts.effectiveDate)

    // Header
    doc.fontSize(18).font('Helvetica-Bold').fillColor(BLUE).text('KNOX EXTERIOR CARE CO.', 50, 50)
    doc.fontSize(11).font('Helvetica').fillColor(GRAY).text('Subcontractor Agreement', 50, doc.y + 2)
    doc.moveDown(0.5)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#e5e7eb').stroke()
    doc.moveDown(0.5)

    // Parties
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text('EFFECTIVE DATE: ', { continued: true })
    doc.font('Helvetica').text(effectiveDateFmt)
    doc.moveDown(0.3)
    doc.font('Helvetica-Bold').text('BETWEEN: ', { continued: true })
    doc.font('Helvetica').text('"KECC" — Knox Exterior Care Co. LLC, a Tennessee business (hereinafter "Contractor")')
    doc.moveDown(0.3)
    doc.font('Helvetica-Bold').text('AND: ', { continued: true })
    doc.font('Helvetica').text(`"Subcontractor" — ${subLabel} (hereinafter "Subcontractor")`)
    doc.moveDown(0.8)

    function sectionHeader(title: string) {
      doc.moveDown(0.4)
      doc.fontSize(11).font('Helvetica-Bold').fillColor(BLUE).text(title)
      doc.moveTo(50, doc.y + 2).lineTo(562, doc.y + 2).strokeColor('#e5e7eb').stroke()
      doc.moveDown(0.4)
      doc.fontSize(10).font('Helvetica').fillColor('#111827')
    }

    function para(text: string) {
      doc.fontSize(10).font('Helvetica').fillColor('#111827').text(text, { width: W })
      doc.moveDown(0.3)
    }

    function bullet(items: string[]) {
      for (const item of items) {
        doc.fontSize(10).font('Helvetica').fillColor('#111827').text(`• ${item}`, { indent: 12, width: W - 12 })
      }
      doc.moveDown(0.3)
    }

    // Section 1
    sectionHeader('Section 1 — INDEPENDENT CONTRACTOR STATUS')
    para('1.1 Subcontractor is engaged as an independent contractor, not as an employee of KECC. Subcontractor shall:')
    bullet([
      'Maintain complete control over the manner and means of performing the Work',
      'Provide their own tools, equipment, and materials (unless otherwise agreed in writing)',
      'Set their own schedule and work hours',
      'Be solely responsible for all payroll taxes, self-employment taxes, and business expenses',
      'Not be entitled to employee benefits, workers\' compensation coverage, or unemployment insurance',
    ])
    para('1.2 Subcontractor acknowledges they will receive a 1099-NEC from KECC for tax reporting purposes if annual payments exceed $600.')

    // Section 2
    sectionHeader('Section 2 — SCOPE OF WORK')
    para('2.1 Subcontractor agrees to provide services that are in line with what the Subcontractor routinely and typically offers, potentially including but not limited to: Professional pressure washing, soft washing, gutter cleaning, lawn maintenance, window cleaning, and related exterior cleaning & maintenance')
    para('2.2 Work shall be performed in a professional, safe, and workmanlike manner, in compliance with:')
    bullet([
      'All applicable Tennessee laws and local codes',
      'All applicable OSHA safety standards',
      'KECC\'s written instructions and quality standards',
      'The customer\'s reasonable requests (as communicated by KECC)',
    ])
    para('2.3 Subcontractor shall complete the Work by the date(s) specified by KECC. Time is of the essence.')

    // Section 3
    sectionHeader('Section 3 — COMPENSATION')
    para('3.1 KECC shall pay Subcontractor the agreed upon rate, in writing, for each specified job.')
    para('3.2 Payment terms:')
    bullet([
      'Invoices must be submitted within [10] business days of job completion',
      'Payment will be made within [30] business days of receipt of invoice',
      'Payment method: any of cash, check, ACH, other',
    ])
    para('3.3 Subcontractor is responsible for tracking and reporting their own income to the IRS. KECC will issue a 1099-NEC if total payments in a calendar year exceed $600.')
    para('3.4 No deductions or withholdings will be made from Subcontractor\'s compensation for taxes, Social Security, Medicare, or any other purpose. Subcontractor is solely responsible for all such obligations.')

    // Section 4
    sectionHeader('Section 4 — INSURANCE AND LIABILITY')
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#c2410c').text('[THIS IS A CRITICAL SECTION FOR KECC\'S PROTECTION]')
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#111827')
    para('4.1 General Liability Insurance Requirement: Subcontractor shall, prior to commencing any Work, obtain and maintain a Commercial General Liability (CGL) insurance policy, issued by an insurer rated A:VII or better by A.M. Best, with the following minimum limits: $1,000,000 per occurrence / $2,000,000 aggregate. Coverage for bodily injury, property damage, and personal/advertising injury. Coverage on an "occurrence" basis (not "claims-made").')
    para('4.2 Additional Insured Endorsement (CRITICAL): Subcontractor shall provide KECC with a Certificate of Insurance (COI) prior to starting any Work, which names Knox Exterior Care Co. as an "additional insured", coverage as primary and non-contributory (KECC\'s coverage is excess), both ongoing and completed operations. Subcontractor shall request an ISO Form CG 20 10 (or equivalent) additional insured endorsement from their insurer. A copy of the actual endorsement (not just the COI) is required on file with KECC.')
    para('4.3 Proof of Coverage: Subcontractor shall provide: Original or certified copy of the Certificate of Insurance before any Work begins. Updated COI if coverage changes or renews. Copy of the additional insured endorsement as proof of coverage. Failure to provide proof of adequate insurance will result in immediate termination of this Agreement and suspension of work.')
    para('4.4 Continuation of Coverage: Subcontractor shall maintain continuous coverage for a minimum of 36 months after job completion to cover claims that may arise after Work is finished (completed operations coverage).')
    para('4.5 Indemnification: To the fullest extent permitted by Tennessee law, Subcontractor shall indemnify, defend (at Subcontractor\'s sole cost and expense), and hold harmless KECC, its owner, employees, agents, and the property owner from: All claims, damages, liabilities, and costs (including attorney fees) arising from or related to Subcontractor\'s performance or non-performance of the Work. Bodily injury or death caused by Subcontractor\'s work. Property damage caused by Subcontractor. Subcontractor\'s violation of any law or regulation. Subcontractor\'s failure to maintain required insurance.')
    para('4.6 Worker Classification: Subcontractor acknowledges they are responsible for: Their own workers\' compensation insurance (if required by law). All employee-related payroll taxes and withholdings. Any employees or sub-subcontractors they may hire (and those parties must also meet KECC\'s insurance requirements).')

    // Section 5
    sectionHeader('Section 5 — LIMITATION OF LIABILITY')
    para('5.1 KECC is not responsible for: Subcontractor\'s equipment, tools, or personal property brought to the job site. Injury to Subcontractor or Subcontractor\'s employees or sub-subcontractors. Any property damage caused by Subcontractor\'s negligence or willful misconduct. Any delay or failure to perform due to circumstances beyond Subcontractor\'s reasonable control (force majeure).')
    para('5.2 Subcontractor assumes all risk of loss or damage to their own equipment and property while performing Work under this Agreement.')

    // Section 6
    sectionHeader('Section 6 — QUALITY AND COMPLIANCE')
    para('6.1 Subcontractor warrants that: All Work will be performed in a professional and workmanlike manner. All Work will comply with applicable Tennessee law, local codes, and industry standards. Subcontractor has the necessary skills, experience, and licensing (if required by law) to perform the Work. Work will be completed safely and without hazard to persons or property.')
    para('6.2 KECC reserves the right to inspect Work at any time. If Work does not meet KECC\'s quality standards, KECC may: Require Subcontractor to correct defects at no additional cost to KECC or the customer. Hire another contractor to correct defects and deduct the cost from Subcontractor\'s payment. Terminate this Agreement immediately for non-compliance.')
    para('6.3 Subcontractor shall clean up all debris and restore the job site to its original condition at the end of each Work day.')

    // Section 7
    sectionHeader('Section 7 — CUSTOMER RELATIONS AND CONFIDENTIALITY')
    para('7.1 Subcontractor agrees to: Treat all customers professionally and courteously. Not directly solicit or contact KECC customers for independent work. Not disclose customer contact information, pricing, or details to third parties. Represent KECC positively and professionally at all times.')
    para('7.2 Subcontractor acknowledges that customer relationships and pricing information belong to KECC. Violation of this section may result in immediate termination and legal action.')

    // Section 8
    sectionHeader('Section 8 — TERMINATION')
    para('8.1 At-Will Relationship: Either party may terminate this Agreement at any time, with or without cause, through verbal or written communication. Upon termination: Subcontractor shall immediately cease performing Work. Subcontractor shall return any KECC property or materials. KECC shall pay for Work already completed (minus any corrections required).')
    para('8.2 Immediate Termination for Cause: KECC may terminate this Agreement immediately if Subcontractor: Fails to maintain required insurance. Violates safety laws or OSHA standards. Misrepresents KECC or acts unprofessionally toward customers. Performs Work that does not meet quality standards. Violates any material term of this Agreement.')

    // Section 9
    sectionHeader('Section 9 — SAFETY AND COMPLIANCE')
    para('9.1 Subcontractor shall: Follow all OSHA safety regulations. Use proper safety equipment and clothing as required by law. Report any job site hazards or accidents to KECC immediately. Not operate any equipment under the influence of drugs or alcohol. Comply with all customer property rules and restrictions.')
    para('9.2 Subcontractor is solely responsible for their own safety and the safety of any employees or sub-subcontractors they hire.')

    // Section 10
    sectionHeader('Section 10 — TOOLS, EQUIPMENT, AND MATERIALS')
    para('10.1 Unless otherwise agreed in writing, Subcontractor shall provide all tools, equipment, and materials necessary to complete the Work.')
    para('10.2 KECC may provide specified equipment or materials. In that case, Subcontractor shall: Use such equipment only for the specified job. Return all equipment in good condition (normal wear and tear excepted). Reimburse KECC for any loss, theft, or damage caused by Subcontractor\'s negligence.')

    // Section 11
    sectionHeader('Section 11 — INVOICING AND PAYMENT DISPUTES')
    para('11.1 Subcontractor shall submit itemized invoices within [10] business days of job completion, including: Date and description of Work performed. Hours worked (if hourly) or scope (if fixed-price). Any materials or expenses claimed.')
    para('11.2 KECC will pay invoices within [15] business days unless there is a good-faith dispute regarding: Work quality or completeness. Hours or scope discrepancy. Unauthorized charges.')
    para('11.3 Disputed invoices will be handled through good-faith discussion. If unresolved, KECC may withhold payment pending resolution, but will not unreasonably delay payment.')

    // Section 12
    sectionHeader('Section 12 — NO THIRD-PARTY BENEFICIARIES')
    para('12.1 This Agreement is between KECC and Subcontractor only. Customers, their families, and third parties have no rights under this Agreement.')

    // Section 13
    sectionHeader('Section 13 — ENTIRE AGREEMENT AND AMENDMENTS')
    para('13.1 This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions, emails, and verbal agreements.')
    para('13.2 No amendment or modification is valid unless made in writing and signed by both parties.')

    // Section 14
    sectionHeader('Section 14 — GOVERNING LAW')
    para('14.1 This Agreement shall be governed by and construed in accordance with the laws of the State of Tennessee, without regard to its conflict-of-laws principles.')
    para('14.2 Any disputes shall be resolved in the state or federal courts located in Knox County, Tennessee.')

    // Section 15
    sectionHeader('Section 15 — SEVERABILITY')
    para('15.1 If any portion of this Agreement is found to be invalid or unenforceable, the remaining portions shall remain in full force and effect.')

    // Signatures
    doc.addPage()
    doc.fontSize(13).font('Helvetica-Bold').fillColor(BLUE).text('SIGNATURES', 50, 50)
    doc.moveTo(50, doc.y + 2).lineTo(562, doc.y + 2).strokeColor('#e5e7eb').stroke()
    doc.moveDown(1)

    const sigY = doc.y
    const colW = 220

    // KECC column
    doc.fontSize(11).font('Helvetica-Bold').fillColor(BLUE).text('KECC — CONTRACTOR', 50, sigY)
    doc.moveDown(0.5)
    doc.fontSize(9).font('Helvetica').fillColor(GRAY).text('Signature:', 50)
    doc.moveDown(0.3)

    // KECC sig image or typed name
    if (opts.keccSigData && opts.keccSigData.startsWith('data:image/')) {
      try {
        const base64 = opts.keccSigData.replace(/^data:image\/\w+;base64,/, '')
        const imgBuf = Buffer.from(base64, 'base64')
        doc.image(imgBuf, 50, doc.y, { height: 50, fit: [colW, 50] })
        doc.moveDown(3.5)
      } catch {
        doc.fontSize(20).font('Helvetica-Oblique').fillColor('#1e3a5f').text('Nicholas G Dunn', 50)
        doc.moveDown(0.5)
      }
    } else {
      doc.fontSize(20).font('Helvetica-Oblique').fillColor('#1e3a5f').text('Nicholas G Dunn', 50)
      doc.moveDown(0.5)
    }

    doc.fontSize(9).font('Helvetica').fillColor('#111827')
    doc.text(`Printed Name & Title: Nicholas G Dunn, Owner`, 50)
    doc.text(`Date: ${effectiveDateFmt}`, 50)

    // Subcontractor column
    const subColX = 310
    doc.fontSize(11).font('Helvetica-Bold').fillColor(BLUE).text('SUBCONTRACTOR', subColX, sigY)
    doc.fontSize(9).font('Helvetica').fillColor(GRAY).text('Signature:', subColX, sigY + 22)

    if (opts.subSigData && opts.subSigData.startsWith('data:image/')) {
      try {
        const base64 = opts.subSigData.replace(/^data:image\/\w+;base64,/, '')
        const imgBuf = Buffer.from(base64, 'base64')
        doc.image(imgBuf, subColX, sigY + 36, { height: 50, fit: [colW, 50] })
      } catch {
        doc.rect(subColX, sigY + 36, colW, 50).strokeColor('#d1d5db').stroke()
      }
    } else {
      doc.rect(subColX, sigY + 36, colW, 50).strokeColor('#d1d5db').stroke()
    }

    const subInfoY = sigY + 100
    doc.fontSize(9).font('Helvetica').fillColor('#111827')
    doc.text(`Printed Name: ${opts.subPrintedName ?? ''}`, subColX, subInfoY)
    if (opts.signedAt) {
      const signedFmt = new Date(opts.signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
      doc.text(`Date & Time: ${signedFmt}`, subColX)
    }
    if (opts.subPhone) doc.text(`Phone: ${opts.subPhone}`, subColX)
    if (opts.subEmail) doc.text(`Email: ${opts.subEmail}`, subColX)

    doc.end()
  })
}

// ── Handler ────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const method = event.httpMethod
  const qs = event.queryStringParameters ?? {}
  const action = qs.action
  const token  = qs.token

  const SITE_URL = process.env.SITE_URL ?? process.env.URL ?? 'https://localhost:8888'

  try {
    // ── GET ?action=list ──────────────────────────────────────────────────
    if (method === 'GET' && action === 'list') {
      const { data, error } = await supabase
        .from('subcontractor_agreements')
        .select('id, contractor_id, contractor_name, entity_type, effective_date, status, accept_token, signed_at, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data ?? []) }
    }

    // ── GET ?action=pdf&id=xxx ────────────────────────────────────────────
    if (method === 'GET' && action === 'pdf') {
      const id = qs.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Missing id' }) }

      const { data: sca, error } = await supabase
        .from('subcontractor_agreements')
        .select('*')
        .eq('id', id)
        .single()
      if (error || !sca) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'SCA not found' }) }

      const { data: contractor } = await supabase
        .from('contractors')
        .select('phone, email')
        .eq('id', sca.contractor_id)
        .single()

      const pdfBuf = await generateScaPdf({
        contractorName: sca.contractor_name,
        entityType: sca.entity_type,
        effectiveDate: sca.effective_date,
        keccSigData: sca.kecc_sig_data,
        subSigData: sca.sub_sig_data,
        subPrintedName: sca.sub_printed_name,
        subPhone: contractor?.phone ?? null,
        subEmail: contractor?.email ?? null,
        signedAt: sca.signed_at,
      })

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="KECC-SCA-${id.slice(0, 8)}.pdf"`,
          'Access-Control-Allow-Origin': '*',
        },
        body: pdfBuf.toString('base64'),
        isBase64Encoded: true,
      }
    }

    // ── GET ?token=xxx — serve signing page ───────────────────────────────
    if (method === 'GET' && token) {
      const { data: sca, error } = await supabase
        .from('subcontractor_agreements')
        .select('*')
        .eq('accept_token', token)
        .single()

      if (error || !sca) {
        return { statusCode: 200, headers: HTML_HEADERS, body: errPage('Agreement Not Found', 'This signing link is invalid or has expired.') }
      }

      const { data: contractor } = await supabase
        .from('contractors')
        .select('phone, email')
        .eq('id', sca.contractor_id)
        .single()

      const funcUrl = `${SITE_URL}/.netlify/functions/subcontractor-agreements?token=${token}`

      const html = buildScaPage({
        token,
        contractorName: sca.contractor_name,
        entityType: sca.entity_type,
        effectiveDate: sca.effective_date,
        keccSigData: sca.kecc_sig_data,
        subSigData: sca.sub_sig_data,
        subPrintedName: sca.sub_printed_name,
        subPhone: contractor?.phone ?? null,
        subEmail: contractor?.email ?? null,
        signedAt: sca.signed_at,
        alreadySigned: sca.status === 'signed',
        funcUrl,
      })

      return { statusCode: 200, headers: HTML_HEADERS, body: html }
    }

    // ── POST ?action=create ───────────────────────────────────────────────
    if (method === 'POST' && action === 'create') {
      const body = JSON.parse(event.body ?? '{}')
      const { contractorId } = body
      if (!contractorId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'contractorId required' }) }

      // Fetch contractor
      const { data: contractor, error: cErr } = await supabase
        .from('contractors')
        .select('*')
        .eq('id', contractorId)
        .single()
      if (cErr || !contractor) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contractor not found' }) }

      // Check no existing non-void SCA
      const { data: existing } = await supabase
        .from('subcontractor_agreements')
        .select('id, status')
        .eq('contractor_id', contractorId)
        .neq('status', 'void')
        .limit(1)
        .maybeSingle()
      if (existing) {
        return { statusCode: 409, headers: CORS, body: JSON.stringify({ message: 'An active or pending SCA already exists for this contractor.' }) }
      }

      // Fetch company settings for owner signature
      const { data: settings } = await supabase
        .from('company_settings')
        .select('owner_signature_data, quo_api_key, quo_from_number')
        .limit(1)
        .single()

      const effectiveDate = todayIso()
      const entityType = contractor.company || null

      // Insert SCA
      const { data: sca, error: insErr } = await supabase
        .from('subcontractor_agreements')
        .insert({
          contractor_id: contractorId,
          contractor_name: contractor.name,
          entity_type: entityType,
          effective_date: effectiveDate,
          status: 'pending_signature',
          kecc_sig_data: settings?.owner_signature_data ?? null,
        })
        .select()
        .single()
      if (insErr) throw insErr

      const signingUrl = `${SITE_URL}/.netlify/functions/subcontractor-agreements?token=${sca.accept_token}`

      // Send via email or SMS
      let sentVia: 'email' | 'sms' | 'none' = 'none'

      if (contractor.email) {
        try {
          await sendEmail({
            to: contractor.email,
            subject: 'Subcontractor Agreement — Knox Exterior Care Co.',
            html: `
              <p>Hi ${contractor.name},</p>
              <p>Knox Exterior Care Co. has sent you a Subcontractor Agreement to review and sign.</p>
              <p><a href="${signingUrl}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Review &amp; Sign Agreement</a></p>
              <p>Or copy this link: ${signingUrl}</p>
              <p>If you have any questions, please contact us directly.</p>
              <p>— Knox Exterior Care Co.</p>
            `,
          })
          sentVia = 'email'
        } catch (e) {
          console.error('SCA email send failed:', e)
        }
      } else if (contractor.phone && settings?.quo_api_key && settings?.quo_from_number) {
        try {
          await sendOpenPhoneSms(
            settings.quo_api_key,
            settings.quo_from_number,
            contractor.phone,
            `Knox Exterior Care Co. sent you a Subcontractor Agreement to sign: ${signingUrl}`,
          )
          sentVia = 'sms'
        } catch (e) {
          console.error('SCA SMS send failed:', e)
        }
      }

      return { statusCode: 201, headers: CORS, body: JSON.stringify({ id: sca.id, signingUrl, sentVia }) }
    }

    // ── POST ?token=xxx — receive signature ───────────────────────────────
    if (method === 'POST' && token) {
      const { data: sca, error } = await supabase
        .from('subcontractor_agreements')
        .select('*')
        .eq('accept_token', token)
        .single()

      if (error || !sca) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      if (sca.status === 'signed') return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message: 'Already signed' }) }

      const body = JSON.parse(event.body ?? '{}')
      const { signatureData, printedName } = body
      if (!signatureData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'signatureData required' }) }
      if (!printedName)   return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'printedName required' }) }

      const signedAt = new Date().toISOString()
      const signedIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? event.headers['client-ip'] ?? null

      // Update SCA
      const { error: updateErr } = await supabase
        .from('subcontractor_agreements')
        .update({
          sub_sig_data: signatureData,
          sub_printed_name: printedName,
          signed_at: signedAt,
          signed_ip: signedIp,
          status: 'signed',
        })
        .eq('id', sca.id)
      if (updateErr) throw updateErr

      // Fetch contractor for email/phone
      const { data: contractor } = await supabase
        .from('contractors')
        .select('*')
        .eq('id', sca.contractor_id)
        .single()

      // Log activity (fire-and-forget)
      try {
        await supabase.from('activities').insert({
          type: 'note',
          summary: `Subcontractor Agreement signed by ${printedName}`,
          metadata: { scaId: sca.id, contractorId: sca.contractor_id, signedAt },
        })
      } catch (e) {
        console.error('Activity log failed:', e)
      }

      // Generate PDF and send to subcontractor
      try {
        const { data: settings } = await supabase
          .from('company_settings')
          .select('quo_api_key, quo_from_number')
          .limit(1)
          .single()

        const pdfBuf = await generateScaPdf({
          contractorName: sca.contractor_name,
          entityType: sca.entity_type,
          effectiveDate: sca.effective_date,
          keccSigData: sca.kecc_sig_data,
          subSigData: signatureData,
          subPrintedName: printedName,
          subPhone: contractor?.phone ?? null,
          subEmail: contractor?.email ?? null,
          signedAt,
        })

        if (contractor?.email) {
          try {
            await sendEmail({
              to: contractor.email,
              subject: 'Your Signed Subcontractor Agreement — Knox Exterior Care Co.',
              html: `
                <p>Hi ${printedName},</p>
                <p>Thank you for signing the Subcontractor Agreement with Knox Exterior Care Co. Please find your signed copy attached.</p>
                <p>If you have any questions, please reach out to us directly.</p>
                <p>— Knox Exterior Care Co.</p>
              `,
              pdfBuffer: pdfBuf,
              pdfFilename: `KECC-Subcontractor-Agreement-${sca.id.slice(0, 8)}.pdf`,
            })
          } catch (e) {
            console.error('SCA signed PDF email failed:', e)
          }
        } else if (contractor?.phone && settings?.quo_api_key && settings?.quo_from_number) {
          const viewUrl = `${process.env.SITE_URL ?? process.env.URL ?? ''}/.netlify/functions/subcontractor-agreements?token=${token}`
          try {
            await sendOpenPhoneSms(
              settings.quo_api_key,
              settings.quo_from_number,
              contractor.phone,
              `Your Subcontractor Agreement with Knox Exterior Care Co. has been signed. View it here: ${viewUrl}`,
            )
          } catch (e) {
            console.error('SCA signed SMS failed:', e)
          }
        }
      } catch (e) {
        console.error('SCA post-sign actions failed:', e)
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('subcontractor-agreements error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
