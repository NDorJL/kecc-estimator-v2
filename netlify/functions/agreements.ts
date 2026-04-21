import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToServiceAgreement } from '../../src/types'
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

  const rawPath = event.path.replace(/\/.netlify\/functions\/agreements\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const sub = parts[1] // e.g. 'send'
  const action = event.queryStringParameters?.action
  const method = event.httpMethod

  try {
    // LIST agreements
    if (method === 'GET' && !id) {
      const contactId      = event.queryStringParameters?.contactId
      const subscriptionId = event.queryStringParameters?.subscriptionId
      let query = supabase.from('service_agreements').select('*').order('created_at', { ascending: false })
      if (contactId)      query = query.eq('contact_id', contactId)
      if (subscriptionId) query = query.eq('subscription_id', subscriptionId)
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

    // POST /agreements/:id/send — generate token, flip to pending_signature
    if (method === 'POST' && id && sub === 'send') {
      const token = randomUUID()
      const { data, error } = await supabase
        .from('service_agreements')
        .update({ accept_token: token, status: 'pending_signature', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const signUrl = `${baseUrl}/.netlify/functions/esign?token=${token}`
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ token, signUrl, agreement: rowToServiceAgreement(data) }) }
    }

    // ── POST ?action=generate-for-subscription ───────────────────────────────
    // Creates a ready-to-sign agreement from a subscription (+ optional contact).
    // No PDF is generated — the agreement is rendered live as HTML by esign.ts.
    if (method === 'POST' && !id && action === 'generate-for-subscription') {
      const body = JSON.parse(event.body ?? '{}')
      const { subscriptionId, contactId, quoteType } = body

      if (!subscriptionId) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'subscriptionId required' }) }
      }

      // Always fetch the subscription; contact is optional (may not be linked yet)
      const subRes = await supabase.from('subscriptions').select('*').eq('id', subscriptionId).single()
      if (!subRes.data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Subscription not found' }) }
      const s = subRes.data

      // Resolve contactId: use provided value, else fall back to subscription's contact_id
      const resolvedContactId: string | null = contactId ?? s.contact_id ?? null

      // Fetch contact if we have an id
      let contactName: string = s.customer_name
      let contactAddress: string | null = s.customer_address ?? null
      if (resolvedContactId) {
        const contactRes = await supabase.from('contacts').select('*').eq('id', resolvedContactId).single()
        if (contactRes.data) {
          contactName = contactRes.data.name
          contactAddress = s.customer_address ?? contactRes.data.address ?? null
        }
      }

      // Void any existing pending/draft agreements for this subscription
      await supabase
        .from('service_agreements')
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('subscription_id', subscriptionId)
        .in('status', ['draft', 'pending_signature'])

      const token = randomUUID()
      const { data: agreementRow, error: insertError } = await supabase
        .from('service_agreements')
        .insert({
          contact_id:       resolvedContactId,
          subscription_id:  subscriptionId,
          customer_name:    contactName,
          customer_address: contactAddress,
          status:           'pending_signature',
          accept_token:     token,
          quote_type:       quoteType ?? null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Log activity (non-fatal)
      if (resolvedContactId) {
        await supabase.from('activities').insert({
          contact_id: resolvedContactId,
          type:       'esign_sent',
          summary:    `Service agreement generated for ${contactName}`,
          metadata:   { agreementId: agreementRow.id, subscriptionId },
        }).catch(() => {/* non-fatal */})
      }

      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const signUrl = `${baseUrl}/.netlify/functions/esign?token=${token}`
      return {
        statusCode: 201,
        headers: CORS,
        body: JSON.stringify({ agreement: rowToServiceAgreement(agreementRow), signUrl }),
      }
    }

    // CREATE agreement (legacy — kept for backward compat)
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const { contactId, subscriptionId, quoteType } = body
      if (!contactId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'contactId required' }) }

      const contactRes = await supabase.from('contacts').select('*').eq('id', contactId).single()
      if (!contactRes.data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contact not found' }) }
      const c = contactRes.data

      const token = randomUUID()
      const { data: agreementRow, error: insertError } = await supabase
        .from('service_agreements')
        .insert({
          contact_id:      contactId,
          subscription_id: subscriptionId ?? null,
          customer_name:   c.name,
          customer_address: c.address ?? null,
          status:          'pending_signature',
          accept_token:    token,
          quote_type:      quoteType ?? null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      const baseUrl = process.env.URL ?? 'http://localhost:8888'
      const signUrl = `${baseUrl}/.netlify/functions/esign?token=${token}`
      return {
        statusCode: 201,
        headers: CORS,
        body: JSON.stringify({ agreement: rowToServiceAgreement(agreementRow), signUrl }),
      }
    }

    // PATCH agreement
    if (method === 'PATCH' && id && !sub) {
      const body = JSON.parse(event.body ?? '{}')
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.status !== undefined)          update.status = body.status
      if (body.signedAt !== undefined)        update.signed_at = body.signedAt
      if (body.signatureData !== undefined)   update.signature_data = body.signatureData
      if (body.signedIp !== undefined)        update.signed_ip = body.signedIp
      if (body.qbInvoiceId !== undefined)     update.qb_invoice_id = body.qbInvoiceId
      if (body.subscriptionId !== undefined)  update.subscription_id = body.subscriptionId
      if (body.quoteType !== undefined)       update.quote_type = body.quoteType

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
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Agreement not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToServiceAgreement(data)) }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === 'object' && 'message' in err)
        ? String((err as Record<string,unknown>).message)
        : String(err)
    console.error('agreements error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
