import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToLead } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/leads\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod
  const contactId = event.queryStringParameters?.contactId

  try {
    // LIST leads (optionally filtered by contact)
    if (method === 'GET' && !id) {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (contactId) query = query.eq('contact_id', contactId)

      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToLead)) }
    }

    // GET single lead
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // CREATE lead
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      const { data, error } = await supabase
        .from('leads')
        .insert({
          contact_id: body.contactId ?? null,
          stage: body.stage ?? 'new',
          source: body.source ?? null,
          service_interest: body.serviceInterest ?? null,
          estimated_value: body.estimatedValue ?? null,
          quote_id: body.quoteId ?? null,
          lost_reason: body.lostReason ?? null,
          notes: body.notes ?? null,
          contacted_at: body.stage === 'contacted' ? new Date().toISOString() : null,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // UPDATE lead (stage, notes, etc.)
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.stage !== undefined)           updates.stage = body.stage
      if (body.notes !== undefined)           updates.notes = body.notes
      if (body.lostReason !== undefined)      updates.lost_reason = body.lostReason
      if (body.estimatedValue !== undefined)  updates.estimated_value = body.estimatedValue
      if (body.serviceInterest !== undefined) updates.service_interest = body.serviceInterest
      if (body.quoteId !== undefined)         updates.quote_id = body.quoteId
      if (body.contactId !== undefined)       updates.contact_id = body.contactId
      // Stamp contacted_at whenever a lead is manually moved to 'contacted'
      if (body.stage === 'contacted')         updates.contacted_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // DELETE lead
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
