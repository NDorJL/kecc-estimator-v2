import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToServiceAgreement, rowToContact, rowToSubscription, rowToSettings } from '../../src/types'
import { randomUUID } from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Fill {{placeholders}} in template text
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// Generate a service agreement PDF and return as Buffer
async function generateAgreementPDF(
  template: string,
  vars: Record<string, string>,
  companyName: string,
  logoUrl: string | null
): Promise<Buffer> {
  const filled = fillTemplate(template, vars)
  const chunks: Buffer[] = []
  const doc = new PDFDocument({ size: 'letter', margin: 60 })
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))))

  // Header
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        doc.image(buf, 410, 50, { width: 100, height: 60, fit: [100, 60] })
      }
    } catch { /* skip */ }
  }
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a1a')
    .text(companyName, 60, 50, { width: 340 })
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text('Service Agreement', 60, 72)
  doc.moveTo(60, 100).lineTo(552, 100).lineWidth(0.5).strokeColor('#cccccc').stroke()

  // Date / customer line
  const dateStr = vars.date ?? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  doc.fontSize(9).fillColor('#555')
    .text(`Date: ${dateStr}`, 60, 114)
    .text(`Customer: ${vars.customerName ?? ''}`, 60, 128)
  if (vars.customerAddress) {
    doc.text(`Property: ${vars.customerAddress}`, 60, 142)
  }
  doc.moveTo(60, 162).lineTo(552, 162).lineWidth(0.5).strokeColor('#cccccc').stroke()

  // Body text
  doc.fontSize(10).font('Helvetica').fillColor('#1a1a1a')
    .text(filled, 60, 178, { width: 492, lineGap: 4 })

  // Signature block
  const sigY = Math.max(doc.y + 40, 620)
  if (sigY > doc.page.height - 120) doc.addPage()
  const finalSigY = sigY > doc.page.height - 120 ? 60 : sigY

  doc.moveTo(60, finalSigY).lineTo(280, finalSigY).lineWidth(0.5).strokeColor('#1a1a1a').stroke()
  doc.fontSize(8).fillColor('#555')
    .text('Customer Signature', 60, finalSigY + 4)
  doc.moveTo(310, finalSigY).lineTo(450, finalSigY).lineWidth(0.5).strokeColor('#1a1a1a').stroke()
  doc.text('Date', 310, finalSigY + 4)
  doc.fontSize(7).fillColor('#888')
    .text(`By signing, you agree to the terms outlined above. ${companyName}`, 60, finalSigY + 22, { width: 492 })

  doc.end()
  return done
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const rawPath = event.path.replace(/\/.netlify\/functions\/agreements\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const sub = parts[1] // e.g. 'send'
  const method = event.httpMethod

  try {
    // LIST agreements
    if (method === 'GET' && !id) {
      const contactId = event.queryStringParameters?.contactId
      let query = supabase.from('service_agreements').select('*').order('created_at', { ascending: false })
      if (contactId) query = query.eq('contact_id', contactId)
      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToServiceAgreement)) }
    }

    // GET single agreement
    if (method === 'GET' && id && !sub) {
      const { data, error } = await supabase.from('service_agreements').select('*').eq('id', id).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToServiceAgreement(data)) }
    }

    // POST /agreements/:id/send — generate token and flip to pending_signature
    if (method === 'POST' && id && sub === 'send') {
      const token = randomUUID()
      const { data, error } = await supabase
        .from('service_agreements')
        .update({ accept_token: token, status: 'pending_signature' })
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const signUrl = `${baseUrl}/.netlify/functions/esign?token=${token}`
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ token, signUrl, agreement: rowToServiceAgreement(data) }) }
    }

    // CREATE agreement (generate PDF)
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const { contactId, subscriptionId } = body

      if (!contactId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'contactId required' }) }

      // Fetch contact, subscription, settings in parallel
      const [contactRes, subRes, settingsRes] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', contactId).single(),
        subscriptionId
          ? supabase.from('subscriptions').select('*').eq('id', subscriptionId).single()
          : Promise.resolve({ data: null, error: null }),
        supabase.from('company_settings').select('*').limit(1).single(),
      ])

      if (!contactRes.data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contact not found' }) }
      const contact = rowToContact(contactRes.data)
      const subscription = subRes.data ? rowToSubscription(subRes.data) : null
      const settings = settingsRes.data ? rowToSettings(settingsRes.data) : null

      // Fetch primary property address
      const { data: propData } = await supabase
        .from('properties')
        .select('address')
        .eq('contact_id', contactId)
        .limit(1)
        .single()
      const propertyAddress = propData?.address ?? contact.customerAddress ?? ''

      // Build template variables
      const today = new Date()
      const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      const services = subscription
        ? subscription.services.map(s => s.serviceName).join(', ')
        : ''
      const pricing = subscription
        ? `$${subscription.inSeasonMonthlyTotal.toFixed(2)}/month (in-season)`
        : ''
      const frequency = subscription
        ? [...new Set(subscription.services.map(s => s.frequency))].join(', ')
        : ''

      const vars: Record<string, string> = {
        customerName: contact.name,
        customerAddress: (propertyAddress as string) || '',
        customerPhone: contact.phone ?? '',
        customerEmail: contact.email ?? '',
        businessName: contact.businessName ?? '',
        services,
        pricing,
        frequency,
        date: dateStr,
        companyName: settings?.companyName ?? 'Knox Exterior Care Co.',
        startDate: subscription?.startDate ?? dateStr,
      }

      const defaultTemplate = `This Service Agreement is entered into between ${vars.companyName} ("Company") and {{customerName}} ("Customer"), effective {{date}}.

SERVICES: The Company agrees to provide the following services at the property located at {{customerAddress}}:
{{services}}

PRICING: {{pricing}}
FREQUENCY: {{frequency}}

TERMS: Payment is due upon receipt of invoice. The Company reserves the right to adjust pricing with 30 days' written notice. This agreement may be terminated by either party with 14 days' written notice.

PROPERTY ACCESS: Customer grants Company permission to access the property for the purpose of providing the agreed services.

SATISFACTION: Company will perform all services in a professional manner. If Customer is unsatisfied, Company will make reasonable efforts to correct any issues within 5 business days of notification.`

      const template = settings?.serviceAgreementTemplate || defaultTemplate
      const companyName = settings?.companyName ?? 'Knox Exterior Care Co.'
      const logoUrl = settings?.logoUrl ?? null

      // Generate PDF
      const pdfBuffer = await generateAgreementPDF(template, vars, companyName, logoUrl)

      // Upload to Supabase Storage
      const fileName = `${contact.name.replace(/[^a-zA-Z0-9]/g, '-')}-Service-Agreement-${randomUUID().slice(0, 8)}.pdf`
      const storagePath = `${contactId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('agreements')
        .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })

      if (uploadError) throw uploadError

      // Get a signed URL (valid 1 year)
      const { data: signedData, error: signedError } = await supabase.storage
        .from('agreements')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

      if (signedError) throw signedError

      // Insert agreement record
      const { data: agreementRow, error: insertError } = await supabase
        .from('service_agreements')
        .insert({
          contact_id: contactId,
          subscription_id: subscriptionId ?? null,
          customer_name: contact.name,
          customer_address: (propertyAddress as string) || null,
          status: 'draft',
          pdf_path: storagePath,
          pdf_url: signedData.signedUrl,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Log activity
      await supabase.from('activities').insert({
        contact_id: contactId,
        type: 'note',
        summary: `Service agreement generated for ${contact.name}`,
        metadata: { agreementId: agreementRow.id },
      })

      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToServiceAgreement(agreementRow)) }
    }

    // PATCH agreement
    if (method === 'PATCH' && id && !sub) {
      const body = JSON.parse(event.body ?? '{}')
      const update: Record<string, unknown> = {}
      if (body.status !== undefined)      update.status = body.status
      if (body.signedAt !== undefined)    update.signed_at = body.signedAt
      if (body.signatureData !== undefined) update.signature_data = body.signatureData
      if (body.signedIp !== undefined)    update.signed_ip = body.signedIp
      if (body.qbInvoiceId !== undefined) update.qb_invoice_id = body.qbInvoiceId
      if (body.subscriptionId !== undefined) update.subscription_id = body.subscriptionId

      const { data, error } = await supabase
        .from('service_agreements')
        .update(update)
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToServiceAgreement(data)) }
    }

    // DELETE (void) agreement
    if (method === 'DELETE' && id && !sub) {
      const { data, error } = await supabase
        .from('service_agreements')
        .update({ status: 'void' })
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToServiceAgreement(data)) }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('agreements error:', message)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
