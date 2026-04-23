import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToContact } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/contacts\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod

  try {
    // LIST contacts (with optional search)
    if (method === 'GET' && !id) {
      const search = event.queryStringParameters?.search ?? ''
      const type = event.queryStringParameters?.type ?? ''
      let query = supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false })

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,business_name.ilike.%${search}%`)
      }
      if (type && type !== 'all') {
        query = query.eq('type', type)
      }

      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToContact)) }
    }

    // GET single contact
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToContact(data)) }
    }

    // CREATE contact
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          name: body.name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          type: body.type ?? 'residential',
          business_name: body.businessName ?? null,
          source: body.source ?? null,
          notes: body.notes ?? null,
          tags: body.tags ?? [],
          custom_fields: body.customFields ?? {},
          next_followup: body.nextFollowup ?? null,
          referred_by: body.referredBy ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToContact(data)) }
    }

    // UPDATE contact
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.name !== undefined)          updates.name = body.name
      if (body.email !== undefined)         updates.email = body.email
      if (body.phone !== undefined)         updates.phone = body.phone
      if (body.type !== undefined)          updates.type = body.type
      if (body.businessName !== undefined)  updates.business_name = body.businessName
      if (body.source !== undefined)        updates.source = body.source
      if (body.notes !== undefined)         updates.notes = body.notes
      if (body.tags !== undefined)          updates.tags = body.tags
      if (body.customFields !== undefined)  updates.custom_fields = body.customFields
      if (body.nextFollowup !== undefined)  updates.next_followup = body.nextFollowup
      if (body.leadScore !== undefined)     updates.lead_score = body.leadScore

      const { data, error } = await supabase
        .from('contacts')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // ── Propagate identity changes to all linked records ──────────────────
      // Quotes: customer_name, customer_email, customer_phone, business_name
      const quoteSync: Record<string, unknown> = {}
      if (body.name !== undefined)         quoteSync.customer_name  = body.name
      if (body.email !== undefined)        quoteSync.customer_email = body.email
      if (body.phone !== undefined)        quoteSync.customer_phone = body.phone
      if (body.businessName !== undefined) quoteSync.business_name  = body.businessName
      if (Object.keys(quoteSync).length > 0) {
        await supabase.from('quotes')
          .update(quoteSync)
          .eq('contact_id', id)
          .is('trashed_at', null)
          .catch(() => {/* non-fatal */})
      }

      // Subscriptions: customer_name, customer_email, customer_phone
      const subSync: Record<string, unknown> = {}
      if (body.name !== undefined)  subSync.customer_name  = body.name
      if (body.email !== undefined) subSync.customer_email = body.email
      if (body.phone !== undefined) subSync.customer_phone = body.phone
      if (Object.keys(subSync).length > 0) {
        await supabase.from('subscriptions')
          .update(subSync)
          .eq('contact_id', id)
          .catch(() => {/* non-fatal */})
      }

      // Jobs: customer_name, customer_email, customer_phone
      const jobSync: Record<string, unknown> = {}
      if (body.name !== undefined)  jobSync.customer_name  = body.name
      if (body.email !== undefined) jobSync.customer_email = body.email
      if (body.phone !== undefined) jobSync.customer_phone = body.phone
      if (Object.keys(jobSync).length > 0) {
        await supabase.from('jobs')
          .update(jobSync)
          .eq('contact_id', id)
          .catch(() => {/* non-fatal */})
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToContact(data)) }
    }

    // DELETE contact
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('contacts').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
