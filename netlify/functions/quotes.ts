import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToQuote } from '../../src/types'
import { randomUUID } from 'crypto'

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
    // LIST all non-trashed quotes
    if (method === 'GET' && !id) {
      const trashed = event.queryStringParameters?.trashed === 'true'
      let query = supabase.from('quotes').select('*').order('created_at', { ascending: false })
      if (trashed) query = query.not('trashed_at', 'is', null)
      else query = query.is('trashed_at', null)
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
      }
      const { data, error } = await supabase.from('quotes').insert(insert).select().single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // UPDATE quote
    if (method === 'PATCH' && id && !action) {
      const body = JSON.parse(event.body ?? '{}')
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
      const { data, error } = await supabase.from('quotes').update(update).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
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
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
