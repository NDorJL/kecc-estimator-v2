import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToMarketingChannel } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/marketing-channels\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod

  try {
    // LIST channels (optionally filtered by type or active status)
    if (method === 'GET' && !id) {
      const type = event.queryStringParameters?.type
      const activeOnly = event.queryStringParameters?.active === 'true'
      let query = supabase
        .from('marketing_channels')
        .select('*')
        .order('type')
        .order('name')

      if (type) query = query.eq('type', type)
      if (activeOnly) query = query.eq('is_active', true)

      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToMarketingChannel)) }
    }

    // GET single channel
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('marketing_channels')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToMarketingChannel(data)) }
    }

    // CREATE channel
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      if (!body.name || !body.type) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'name and type are required' }) }
      }
      const { data, error } = await supabase
        .from('marketing_channels')
        .insert({
          name:      body.name,
          type:      body.type,
          is_active: body.isActive ?? true,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToMarketingChannel(data)) }
    }

    // UPDATE channel (name, type, isActive)
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.name      !== undefined) updates.name      = body.name
      if (body.type      !== undefined) updates.type      = body.type
      if (body.isActive  !== undefined) updates.is_active = body.isActive

      const { data, error } = await supabase
        .from('marketing_channels')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToMarketingChannel(data)) }
    }

    // DELETE channel
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('marketing_channels').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
