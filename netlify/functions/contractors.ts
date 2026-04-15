import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToContractor } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/contractors\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod

  try {
    // LIST contractors
    if (method === 'GET' && !id) {
      const search = event.queryStringParameters?.search ?? ''
      let query = supabase
        .from('contractors')
        .select('*')
        .order('created_at', { ascending: false })
      if (search) {
        query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,specialty.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
      }
      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToContractor)) }
    }

    // GET single contractor
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .eq('id', id)
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contractor not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToContractor(data)) }
    }

    // CREATE contractor
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const { data, error } = await supabase
        .from('contractors')
        .insert({
          name: body.name,
          phone: body.phone ?? null,
          email: body.email ?? null,
          company: body.company ?? null,
          specialty: body.specialty ?? null,
          rate_per_job: body.ratePerJob !== undefined && body.ratePerJob !== '' ? Number(body.ratePerJob) : null,
          notes: body.notes ?? null,
          is_1099: body.is1099 !== undefined ? body.is1099 : true,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToContractor(data)) }
    }

    // UPDATE contractor
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.name !== undefined)      updates.name = body.name
      if (body.phone !== undefined)     updates.phone = body.phone
      if (body.email !== undefined)     updates.email = body.email
      if (body.company !== undefined)   updates.company = body.company
      if (body.specialty !== undefined) updates.specialty = body.specialty
      if (body.ratePerJob !== undefined) updates.rate_per_job = body.ratePerJob !== '' ? Number(body.ratePerJob) : null
      if (body.notes !== undefined)     updates.notes = body.notes
      if (body.is1099 !== undefined)    updates.is_1099 = body.is1099

      const { data, error } = await supabase
        .from('contractors')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contractor not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToContractor(data)) }
    }

    // DELETE contractor
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('contractors').delete().eq('id', id)
      if (error) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Contractor not found' }) }
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
