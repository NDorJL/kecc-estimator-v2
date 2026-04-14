import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToProperty } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/properties\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod
  const contactId = event.queryStringParameters?.contactId

  try {
    // LIST properties for a contact
    if (method === 'GET' && !id) {
      if (!contactId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'contactId required' }) }
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToProperty)) }
    }

    // GET single property
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToProperty(data)) }
    }

    // CREATE property
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      const { data, error } = await supabase
        .from('properties')
        .insert({
          contact_id: body.contactId,
          label: body.label ?? null,
          address: body.address,
          type: body.type ?? 'residential',
          mowable_acres: body.mowableAcres ?? null,
          sqft: body.sqft ?? null,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
          notes: body.notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToProperty(data)) }
    }

    // UPDATE property
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.label !== undefined)        updates.label = body.label
      if (body.address !== undefined)      updates.address = body.address
      if (body.type !== undefined)         updates.type = body.type
      if (body.mowableAcres !== undefined) updates.mowable_acres = body.mowableAcres
      if (body.sqft !== undefined)         updates.sqft = body.sqft
      if (body.lat !== undefined)          updates.lat = body.lat
      if (body.lng !== undefined)          updates.lng = body.lng
      if (body.notes !== undefined)        updates.notes = body.notes

      const { data, error } = await supabase
        .from('properties')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToProperty(data)) }
    }

    // DELETE property
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('properties').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
