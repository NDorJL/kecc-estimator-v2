import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToSubscription, rowToSettings } from '../../src/types'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

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
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Method not allowed' }) }

  const subscriptionId = event.queryStringParameters?.subscriptionId
  if (!subscriptionId) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'subscriptionId required' }) }

  try {
    const [{ data: subRow }, { data: settingsRow }] = await Promise.all([
      supabase.from('subscriptions').select('*').eq('id', subscriptionId).single(),
      supabase.from('company_settings').select('*').limit(1).single(),
    ])
    if (!subRow) return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Subscription not found' }) }

    const sub = rowToSubscription(subRow)
    const settings = settingsRow ? rowToSettings(settingsRow) : { companyName: 'Knox Exterior Care Co.', phone: null, email: null, address: null, logoUrl: null, quoteFooter: null, id: '' }

    let logoBuffer: Buffer | null = null
    if (settings.logoUrl) {
      try { logoBuffer = await fetchBuffer(settings.logoUrl) } catch { /* skip */ }
    }

    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'letter', margin: 50 })
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const pdfDone = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))))

    const fmt = (n: number) => '$' + n.toFixed(2)
    const pageW = doc.page.width - 100
    const HEADER_HEIGHT = 110
    let y = 50

    if (logoBuffer) {
      try { doc.image(logoBuffer, 410, y, { width: 100, height: 60, fit: [100, 60] }) } catch { /* skip */ }
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

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('Subscription Plan — Updated Estimate', 50, y)
    y += 22
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#888888').text('CUSTOMER', 50, y)
    y += 14
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text(sub.customerName, 50, y)
    y += 16
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
    if (sub.businessName) { doc.text(sub.businessName, 50, y); y += 13 }
    if (sub.customerAddress) { doc.text(sub.customerAddress, 50, y); y += 13 }
    if (sub.customerPhone) { doc.text(sub.customerPhone, 50, y); y += 13 }
    y += 10

    const colX = [50, 200, 340, 420, 490]
    const colW = [150, 140, 75, 65, 70]
    const headers = ['Service', 'Category', 'Frequency', 'Season', '/Month']
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
    headers.forEach((h, i) => doc.text(h, colX[i], y, { width: colW[i], align: i >= 2 ? 'right' : 'left' }))
    y += 14
    doc.moveTo(50, y).lineTo(562, y).strokeColor('#dddddd').stroke()
    y += 6

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    doc.fontSize(9).font('Helvetica').fillColor('#000000')
    for (const svc of sub.services) {
      if (y > 680) { doc.addPage(); y = 50 }
      doc.font('Helvetica-Bold').text(svc.serviceName, colX[0], y, { width: colW[0] })
      doc.font('Helvetica').fillColor('#555555').text(svc.category, colX[1], y, { width: colW[1] })
      doc.fillColor('#000000').text(svc.frequency, colX[2], y, { width: colW[2], align: 'right' })
      const seasonLabel = svc.seasonal
        ? monthNames[svc.activeMonths[0]] + '–' + monthNames[svc.activeMonths[svc.activeMonths.length - 1]]
        : 'Year-Round'
      doc.text(seasonLabel, colX[3], y, { width: colW[3], align: 'right' })
      doc.font('Helvetica-Bold').text(fmt(svc.pricePerMonth), colX[4], y, { width: colW[4], align: 'right' })
      doc.font('Helvetica').fillColor('#000000')
      y += 18
    }

    y += 8
    doc.moveTo(350, y).lineTo(562, y).strokeColor('#dddddd').stroke()
    y += 10
    doc.fontSize(10).font('Helvetica-Bold')
    doc.fillColor('#4a6741').text('In-Season (Mar–Nov):', 300, y, { width: 185, align: 'right' })
    doc.text(fmt(sub.inSeasonMonthlyTotal) + '/mo', 490, y, { width: 70, align: 'right' })
    y += 18
    doc.fillColor('#6b7280').text('Off-Season (Dec–Feb):', 300, y, { width: 185, align: 'right' })
    doc.text(fmt(sub.offSeasonMonthlyTotal) + '/mo', 490, y, { width: 70, align: 'right' })
    y += 28

    doc.fontSize(9).font('Helvetica').fillColor('#333333')
    const noteText = 'Upon your approval of this revised plan, KECC will update your subscription and adjust your recurring billing accordingly.'
    doc.text(noteText, 50, y, { width: pageW })
    y += doc.heightOfString(noteText, { width: pageW }) + 20

    if (y > 660) { doc.addPage(); y = 50 }
    y = Math.max(y, 650)
    doc.moveTo(50, y).lineTo(260, y).strokeColor('#888888').lineWidth(0.5).stroke()
    doc.moveTo(310, y).lineTo(520, y).stroke()
    y += 6
    doc.fontSize(8).font('Helvetica').fillColor('#888888')
    doc.text('Customer Signature', 50, y)
    doc.text('Date', 310, y)

    if (settings.quoteFooter) {
      y += 30
      doc.moveTo(50, y).lineTo(562, y).strokeColor('#dddddd').lineWidth(0.5).stroke()
      y += 10
      doc.fontSize(8).font('Helvetica').fillColor('#888888')
      doc.text(settings.quoteFooter, 50, y, { width: pageW, align: 'center' })
    }
    doc.end()

    const pdfBytes = await pdfDone
    const filename = `KECC-Subscription-${sub.customerName.replace(/\s+/g, '-')}-${sub.id.slice(0, 8)}.pdf`
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
      body: pdfBytes.toString('base64'),
      isBase64Encoded: true,
    }
  } catch (err) {
    console.error('pdf-subscription error:', err)
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'PDF generation failed' }) }
  }
}
