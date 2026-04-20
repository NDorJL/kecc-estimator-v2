import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToSubscription } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/subscriptions\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod

  try {
    // LIST
    if (method === 'GET' && !id) {
      const { data, error } = await supabase.from('subscriptions').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToSubscription)) }
    }

    // GET single
    if (method === 'GET' && id) {
      const { data, error } = await supabase.from('subscriptions').select('*').eq('id', id).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Subscription not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToSubscription(data)) }
    }

    // CREATE
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const insert = {
        customer_name: body.customerName ?? '',
        customer_address: body.customerAddress ?? null,
        customer_phone: body.customerPhone ?? null,
        customer_email: body.customerEmail ?? null,
        business_name: body.businessName ?? null,
        status: body.status ?? 'ACTIVE',
        start_date: body.startDate ?? new Date().toISOString().slice(0, 10),
        pause_until: body.pauseUntil ?? null,
        services: body.services ?? [],
        in_season_monthly_total: Number(body.inSeasonMonthlyTotal ?? 0),
        off_season_monthly_total: Number(body.offSeasonMonthlyTotal ?? 0),
        quickbooks_reference: body.quickbooksReference ?? null,
        change_history: body.changeHistory ?? [],
        contact_id: body.contactId ?? null,
        agreement_id: body.agreementId ?? null,
        qb_invoice_id: body.qbInvoiceId ?? null,
        service_schedules: body.serviceSchedules ?? [],
      }
      const { data, error } = await supabase.from('subscriptions').insert(insert).select().single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToSubscription(data)) }
    }

    // UPDATE
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const update: Record<string, unknown> = {}
      if (body.customerName !== undefined) update.customer_name = body.customerName
      if (body.customerAddress !== undefined) update.customer_address = body.customerAddress
      if (body.customerPhone !== undefined) update.customer_phone = body.customerPhone
      if (body.customerEmail !== undefined) update.customer_email = body.customerEmail
      if (body.businessName !== undefined) update.business_name = body.businessName
      if (body.status !== undefined) update.status = body.status
      if (body.startDate !== undefined) update.start_date = body.startDate
      if (body.pauseUntil !== undefined) update.pause_until = body.pauseUntil
      if (body.services !== undefined) update.services = body.services
      if (body.inSeasonMonthlyTotal !== undefined) update.in_season_monthly_total = Number(body.inSeasonMonthlyTotal)
      if (body.offSeasonMonthlyTotal !== undefined) update.off_season_monthly_total = Number(body.offSeasonMonthlyTotal)
      if (body.quickbooksReference !== undefined) update.quickbooks_reference = body.quickbooksReference
      if (body.changeHistory !== undefined)       update.change_history = body.changeHistory
      if (body.contactId !== undefined)           update.contact_id = body.contactId
      if (body.agreementId !== undefined)         update.agreement_id = body.agreementId
      if (body.qbInvoiceId !== undefined)         update.qb_invoice_id = body.qbInvoiceId
      if (body.serviceSchedules !== undefined)    update.service_schedules = body.serviceSchedules
      const { data, error } = await supabase.from('subscriptions').update(update).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Subscription not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToSubscription(data)) }
    }

    // DELETE
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('subscriptions').delete().eq('id', id)
      if (error) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Subscription not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Deleted' }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('subscriptions error:', err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'Internal server error' }) }
  }
}
