import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToQuote, rowToSettings } from '../../src/types'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')
import { PDFDocument as LibPDF } from 'pdf-lib'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Method not allowed' }) }

  const quoteId = event.queryStringParameters?.quoteId
  if (!quoteId) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'quoteId required' }) }

  try {
    // Fetch quote + settings in parallel
    const [{ data: quoteRow }, { data: settingsRow }] = await Promise.all([
      supabase.from('quotes').select('*').eq('id', quoteId).single(),
      supabase.from('company_settings').select('*').limit(1).single(),
    ])
    if (!quoteRow) return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Quote not found' }) }

    const quote = rowToQuote(quoteRow)
    const settings = settingsRow ? rowToSettings(settingsRow) : { companyName: 'Knox Exterior Care Co.', phone: null, email: null, address: null, logoUrl: null, quoteFooter: null, id: '' }

    const lineItems = quote.lineItems
    const onetimeItems = lineItems.filter(i => !i.isSubscription)
    const subItems = lineItems.filter(i => i.isSubscription)
    const onetimeSubtotal = onetimeItems.reduce((s, i) => s + i.lineTotal, 0)
    const monthlySubtotal = subItems.reduce((s, i) => s + (i.monthlyAmount ?? i.lineTotal), 0)
    const qt = quote.quoteType ?? ''
    let planLabel = ''
    if (qt.includes('autopilot')) planLabel = 'One-Service Autopilot Plan'
    else if (qt.startsWith('residential') && qt.includes('tcep')) planLabel = 'TCEP — Total Care Exterior Plan (Residential)'
    else if (qt.startsWith('commercial') && qt.includes('tcep')) planLabel = 'TPC — Total Property Care (Commercial)'

    // Fetch logo buffer if set
    let logoBuffer: Buffer | null = null
    if (settings.logoUrl) {
      try { logoBuffer = await fetchBuffer(settings.logoUrl) } catch { /* skip */ }
    }

    // Build PDF with PDFKit
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'letter', margin: 50 })
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const pdfDone = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const fmt = (n: number) => '$' + n.toFixed(2)
    const pageW = doc.page.width - 100
    const HEADER_HEIGHT = 110
    let y = 50

    if (logoBuffer) {
      try { doc.image(logoBuffer, 410, y, { width: 100, height: 60, fit: [100, 60] }) } catch { /* skip bad image */ }
    }
    doc.fontSize(16).font('Helvetica-Bold').text(settings.companyName ?? 'Knox Exterior Care Co.', 50, y, { width: 340 })
    y += 22
    doc.fontSize(9).font('Helvetica').fillColor('#555555')
    if (settings.address) { doc.text(settings.address, 50, y, { width: 340 }); y += 13 }
    if (settings.phone) { doc.text(settings.phone, 50, y, { width: 340 }); y += 13 }
    if (settings.email) { doc.text(settings.email, 50, y, { width: 340 }); y += 13 }
    y = Math.max(y + 8, HEADER_HEIGHT)
    doc.moveTo(50, y).lineTo(562, y).strokeColor('#cccccc').stroke()
    y += 15

    if (planLabel) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#4a6741').text(planLabel.toUpperCase(), 50, y)
      y += 14
    }

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#888888').text('ESTIMATE FOR', 50, y)
    doc.text('ESTIMATE #', 400, y)
    y += 14
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text(quote.customerName, 50, y)
    doc.fontSize(10).font('Courier').text(quote.id.slice(0, 8).toUpperCase(), 400, y)
    y += 16
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
    if (quote.businessName) { doc.text(quote.businessName, 50, y); y += 13 }
    if (quote.customerAddress) { doc.text(quote.customerAddress, 50, y); y += 13 }
    if (quote.customerPhone) { doc.text(quote.customerPhone, 50, y); y += 13 }
    if (quote.customerEmail) { doc.text(quote.customerEmail, 50, y); y += 13 }
    doc.fillColor('#555555').text(new Date(quote.createdAt).toLocaleDateString(), 400, y - 13)
    y += 10

    // Columns: Service | Description | Total  (no Qty, no Unit Price, no Frequency)
    const colX = [50, 280, 482]
    const colW = [230, 200, 80]
    const tableHeaders = ['Service', 'Description', 'Total']
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
    tableHeaders.forEach((h, i) => doc.text(h, colX[i], y, { width: colW[i], align: i === 2 ? 'right' : 'left' }))
    y += 14
    doc.moveTo(50, y).lineTo(562, y).strokeColor('#dddddd').stroke()
    y += 6

    doc.fontSize(9).font('Helvetica').fillColor('#000000')
    for (const item of lineItems) {
      if (y > 700) { doc.addPage(); y = 50 }
      // Measure row height to handle multi-line descriptions
      const serviceH     = doc.heightOfString(item.serviceName, { width: colW[0] })
      const descText     = item.description ?? ''
      const descH        = descText ? doc.heightOfString(descText, { width: colW[1] }) : 0
      const rowH         = Math.max(serviceH, descH, 14) + 6
      doc.font('Helvetica-Bold').fillColor('#000000').text(item.serviceName, colX[0], y, { width: colW[0] })
      if (descText) doc.font('Helvetica').fillColor('#555555').text(descText, colX[1], y, { width: colW[1] })
      doc.font('Helvetica-Bold').fillColor('#000000').text(
        fmt(item.lineTotal) + (item.isSubscription ? '/mo' : ''),
        colX[2], y, { width: colW[2], align: 'right' },
      )
      doc.font('Helvetica').fillColor('#000000')
      y += rowH
    }

    y += 8
    doc.moveTo(350, y).lineTo(562, y).strokeColor('#dddddd').stroke()
    y += 10
    doc.fontSize(9).font('Helvetica')
    if (onetimeSubtotal > 0) {
      doc.fillColor('#555555').text('One-Time Subtotal:', 350, y, { width: 130, align: 'right' })
      doc.font('Helvetica-Bold').fillColor('#000000').text(fmt(onetimeSubtotal), 485, y, { width: 75, align: 'right' })
      y += 16
    }
    if (monthlySubtotal > 0) {
      doc.font('Helvetica').fillColor('#555555').text('Monthly Subscription:', 350, y, { width: 130, align: 'right' })
      doc.font('Helvetica-Bold').fillColor('#000000').text(fmt(monthlySubtotal) + '/mo', 485, y, { width: 75, align: 'right' })
      y += 16
    }
    doc.moveTo(350, y).lineTo(562, y).strokeColor('#000000').lineWidth(1).stroke()
    y += 8
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
    doc.text('Total:', 350, y, { width: 130, align: 'right' })
    doc.text(fmt(quote.total), 485, y, { width: 75, align: 'right' })
    y += 28

    if (quote.notes) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#888888').text('NOTES', 50, y)
      y += 14
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(quote.notes, 50, y, { width: pageW })
      y += doc.heightOfString(quote.notes, { width: pageW }) + 16
    }

    // ── Signature block ──────────────────────────────────────────────────────
    if (quote.signedAt) {
      const stampH = quote.signedIp ? 86 : 74
      if (y + stampH + 16 > 730) { doc.addPage(); y = 50 }
      else { y += 14 }

      const signedDate = new Date(quote.signedAt)
      const dayStr  = signedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      const timeStr = signedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

      // Light green background + border (matches in-app style)
      doc.rect(50, y, 512, stampH).fillColor('#f0fdf4').fill()
      doc.rect(50, y, 512, stampH).strokeColor('#bbf7d0').lineWidth(1).stroke()

      // Green circle with checkmark (mimics the icon in the app)
      const cx = 72; const cy = y + 18
      doc.circle(cx, cy, 9).fillColor('#16a34a').fill()
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff').text('✓', cx - 5, cy - 6, { width: 10, align: 'center', lineBreak: false })

      // "E-Signed by [Name]" — bold, larger
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#15803d')
      doc.text(`E-Signed by ${quote.customerName}`, 88, y + 11, { width: 460 })

      // Signed timestamp
      doc.fontSize(8).font('Helvetica').fillColor('#16a34a')
      doc.text(`Signed on ${dayStr} at ${timeStr}`, 88, y + 27, { width: 460 })

      // IP address (if available)
      if (quote.signedIp) {
        doc.text(`IP address: ${quote.signedIp}`, 88, y + 39, { width: 460 })
      }

      // Legal line
      const legalY = quote.signedIp ? y + 53 : y + 41
      doc.fillColor('#4ade80').text('Digital signature on file · Legally binding electronic acceptance', 88, legalY, { width: 460 })

      y += stampH + 6
    } else {
      // Unsigned — show blank signature lines
      if (y > 660) { doc.addPage(); y = 50 }
      y = Math.max(y, 650)
      doc.moveTo(50, y).lineTo(260, y).strokeColor('#888888').lineWidth(0.5).stroke()
      doc.moveTo(310, y).lineTo(520, y).stroke()
      y += 6
      doc.fontSize(8).font('Helvetica').fillColor('#888888')
      doc.text('Customer Signature', 50, y)
      doc.text('Date', 310, y)
    }


    if (settings.quoteFooter) {
      y += 30
      doc.moveTo(50, y).lineTo(562, y).strokeColor('#dddddd').lineWidth(0.5).stroke()
      y += 10
      doc.fontSize(8).font('Helvetica').fillColor('#888888')
      doc.text(settings.quoteFooter, 50, y, { width: pageW, align: 'center' })
    }
    doc.end()

    const quotePdfBytes = await pdfDone

    // Fetch and merge attachments
    const manualIds = event.queryStringParameters?.attachments
      ? String(event.queryStringParameters.attachments).split(',').filter(Boolean)
      : []

    const { data: allAtts } = await supabase.from('quote_attachments').select('*').order('sort_order')
    const atts = allAtts ?? []
    const toMerge = [
      ...atts.filter((a: { enabled: boolean; attach_mode: string }) => a.enabled && a.attach_mode === 'always'),
      ...atts.filter((a: { enabled: boolean; attach_mode: string; id: string }) => a.enabled && a.attach_mode === 'manual' && manualIds.includes(a.id)),
    ]

    if (toMerge.length === 0) {
      const filename = `KECC-Estimate-${quote.customerName.replace(/\s+/g, '-')}-${quote.id.slice(0, 8)}.pdf`
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
        body: quotePdfBytes.toString('base64'),
        isBase64Encoded: true,
      }
    }

    // Merge with pdf-lib
    try {
      const mergedPdf = await LibPDF.create()
      const quoteDoc = await LibPDF.load(quotePdfBytes)
      const qPages = await mergedPdf.copyPages(quoteDoc, quoteDoc.getPageIndices())
      qPages.forEach(p => mergedPdf.addPage(p))

      await Promise.all(toMerge.map(async (att: { file_path: string }) => {
        try {
          const { data: signed } = await supabase.storage.from('attachments').createSignedUrl(att.file_path, 60)
          if (!signed?.signedUrl) return
          const attBuf = await fetchBuffer(signed.signedUrl)
          const attDoc = await LibPDF.load(attBuf)
          const aPages = await mergedPdf.copyPages(attDoc, attDoc.getPageIndices())
          aPages.forEach(p => mergedPdf.addPage(p))
        } catch { /* skip bad attachment */ }
      }))

      const mergedBytes = await mergedPdf.save()
      const filename = `KECC-Estimate-${quote.customerName.replace(/\s+/g, '-')}-${quote.id.slice(0, 8)}.pdf`
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
        body: Buffer.from(mergedBytes).toString('base64'),
        isBase64Encoded: true,
      }
    } catch {
      // Merge failed — send quote PDF alone
      const filename = `KECC-Estimate-${quote.customerName.replace(/\s+/g, '-')}-${quote.id.slice(0, 8)}.pdf`
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
        body: quotePdfBytes.toString('base64'),
        isBase64Encoded: true,
      }
    }
  } catch (err) {
    console.error('pdf-quote error:', err)
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'PDF generation failed' }) }
  }
}
