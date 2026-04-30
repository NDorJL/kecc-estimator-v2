import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToQuote } from '../../src/types'
import { randomUUID } from 'crypto'
import { advanceLeadStage } from './_leadSync'
import { sendOpenPhoneSms } from './_smsHelper'

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

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Parse path: /.netlify/functions/quotes[/id[/action]]
  const rawPath = event.path.replace(/\/.netlify\/functions\/quotes\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const action = parts[1]
  const method = event.httpMethod

  try {
    // LIST all non-trashed quotes (optionally filtered by leadId)
    if (method === 'GET' && !id) {
      const trashed = event.queryStringParameters?.trashed === 'true'
      const leadId  = event.queryStringParameters?.leadId
      let query = supabase.from('quotes').select('*').order('created_at', { ascending: false })
      if (trashed) query = query.not('trashed_at', 'is', null)
      else query = query.is('trashed_at', null)
      if (leadId) query = query.eq('lead_id', leadId)
      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToQuote)) }
    }

    // EMPTY TRASH
    if (method === 'DELETE' && id === 'trash' && action === 'empty') {
      await supabase.from('quotes').delete().not('trashed_at', 'is', null)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Trash emptied' }) }
    }

    // GET single quote
    if (method === 'GET' && id && !action) {
      const { data, error } = await supabase.from('quotes').select('*').eq('id', id).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // CREATE quote
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const insert = {
        customer_name: body.customerName ?? '',
        customer_address: body.customerAddress ?? null,
        customer_phone: body.customerPhone ?? null,
        customer_email: body.customerEmail ?? null,
        business_name: body.businessName ?? null,
        quote_type: body.quoteType ?? 'residential_onetime',
        line_items: body.lineItems ?? [],
        subtotal: Number(body.subtotal ?? 0),
        discount: body.discount !== undefined ? Number(body.discount) : null,
        total: Number(body.total ?? 0),
        notes: body.notes ?? null,
        status: body.status ?? 'draft',
        contact_id: body.contactId ?? null,
        expires_at: body.expiresAt ?? null,
        accept_token: randomUUID(),
        lead_id: body.leadId ?? null,
      }
      const { data, error } = await supabase.from('quotes').insert(insert).select().single()
      if (error) throw error
      // Auto-place / advance a lead in "Quoted" whenever a quote is created
      await advanceLeadStage(supabase, {
        leadId:    data.lead_id ?? null,
        quoteId:   data.id,
        contactId: data.contact_id ?? null,
        stage:     'quoted',
        extraInsert: {
          estimated_value:  data.total ?? null,
          service_interest: Array.isArray(data.line_items) && data.line_items.length > 0
            ? (data.line_items[0] as any).serviceName ?? null
            : null,
        },
      })
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // UPDATE quote
    if (method === 'PATCH' && id && !action) {
      let body: Record<string, unknown>
      try { body = JSON.parse(event.body ?? '{}') } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Invalid JSON body' }) } }
      const update: Record<string, unknown> = {}
      if (body.customerName !== undefined) update.customer_name = body.customerName
      if (body.customerAddress !== undefined) update.customer_address = body.customerAddress
      if (body.customerPhone !== undefined) update.customer_phone = body.customerPhone
      if (body.customerEmail !== undefined) update.customer_email = body.customerEmail
      if (body.businessName !== undefined) update.business_name = body.businessName
      if (body.quoteType !== undefined) update.quote_type = body.quoteType
      if (body.lineItems !== undefined) update.line_items = body.lineItems
      if (body.subtotal !== undefined) update.subtotal = Number(body.subtotal)
      if (body.discount !== undefined) update.discount = body.discount !== null ? Number(body.discount) : null
      if (body.total !== undefined) update.total = Number(body.total)
      if (body.notes !== undefined) update.notes = body.notes
      if (body.status !== undefined) update.status = body.status
      if (body.contactId !== undefined)      update.contact_id = body.contactId
      if (body.createdAt !== undefined)      update.created_at = body.createdAt   // allow backdating
      if (body.expiresAt !== undefined)      update.expires_at = body.expiresAt
      if (body.signedAt !== undefined)       update.signed_at = body.signedAt
      if (body.signatureData !== undefined)  update.signature_data = body.signatureData
      if (body.signedIp !== undefined)       update.signed_ip = body.signedIp
      if (body.qbInvoiceId !== undefined)    update.qb_invoice_id = body.qbInvoiceId
      if (body.sentAt !== undefined)         update.sent_at = body.sentAt
      if (Object.keys(update).length === 0) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No fields to update' }) }
      const { data, error } = await supabase.from('quotes').update(update).eq('id', id).select().single()
      if (error) {
        console.error('PATCH /quotes error:', error)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: error.message, details: error.details ?? null }) }
      }
      if (!data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }

      // ── Propagate customer identity changes back to the linked contact ────
      // So editing a name on a quote keeps the contact record in sync.
      if (data.contact_id) {
        const contactSync: Record<string, unknown> = {}
        if (body.customerName !== undefined)  contactSync.name          = body.customerName
        if (body.customerEmail !== undefined) contactSync.email         = body.customerEmail
        if (body.customerPhone !== undefined) contactSync.phone         = body.customerPhone
        if (body.businessName  !== undefined) contactSync.business_name = body.businessName
        if (Object.keys(contactSync).length > 0) {
          try {
            await supabase.from('contacts')
              .update(contactSync)
              .eq('id', data.contact_id)
          } catch (_syncErr) {
            // non-fatal — never let contact sync crash the quote save response
          }
        }
      }

      // NOTE: lead does NOT advance to 'scheduled' here — that only happens
      // when a job is explicitly created from this quote via POST /jobs.
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // SEND quote via SMS — stamps sent_at and fires OpenPhone message
    if (method === 'POST' && id && action === 'send') {
      const { data: quote, error: qErr } = await supabase
        .from('quotes').select('*').eq('id', id).single()
      if (qErr || !quote) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }

      if (!quote.customer_phone) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No phone number on this quote' }) }
      }
      if (!quote.accept_token) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Quote has no accept token — regenerate the quote' }) }
      }

      // Fetch SMS credentials from settings
      const { data: settings } = await supabase
        .from('company_settings').select('quo_api_key, quo_from_number, company_name').limit(1).single()
      const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
      const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
      const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'

      if (!apiKey || !fromNumber) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'SMS not configured in Settings' }) }
      }

      const siteUrl = (process.env.URL ?? '').replace(/\/$/, '')
      const esignUrl = `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(quote.accept_token)}`
      const firstName = (quote.customer_name ?? 'there').split(' ')[0]

      const message =
        `Hi ${firstName}, Knox Exterior Care Co. here! Your quote is ready — follow this link to view. ` +
        `If you'd like to move forward, simply sign the e-sign at the bottom of the quote, and we'll reach out about getting you on the schedule.\n\n` +
        `Please reach out to this number with any questions or concerns - thank you for the opportunity to serve!\n\n` +
        `Automated msg. Reply STOP to opt out.\n\n` +
        esignUrl

      await sendOpenPhoneSms(apiKey, fromNumber, quote.customer_phone, message)

      // Stamp sent_at and flip status to 'sent'
      const now = new Date().toISOString()
      const { data: updated, error: upErr } = await supabase
        .from('quotes')
        .update({ sent_at: now, status: 'sent' })
        .eq('id', id).select().single()
      if (upErr || !updated) throw upErr

      // Log activity on the contact (non-fatal)
      if (updated.contact_id) {
        await supabase.from('activities').insert({
          contact_id: updated.contact_id,
          type: 'sms_out',
          summary: `Quote sent via SMS to ${quote.customer_phone}`,
          metadata: { quoteId: id, esignUrl },
        }).catch(() => {})
      }

      // Return success — frontend invalidates the /quotes cache to pick up sent_at
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // TRASH quote
    if (method === 'POST' && id && action === 'trash') {
      const { data, error } = await supabase.from('quotes').update({ trashed_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // RESTORE quote
    if (method === 'POST' && id && action === 'restore') {
      const { data, error } = await supabase.from('quotes').update({ trashed_at: null }).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // DELETE quote (permanent)
    if (method === 'DELETE' && id && !action) {
      const { error } = await supabase.from('quotes').delete().eq('id', id)
      if (error) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Deleted' }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('quotes error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: msg }) }
  }
}
