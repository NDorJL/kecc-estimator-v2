import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function ok(body: unknown, status = 200) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
function err(msg: string, status = 500) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClient(r: any) {
  return {
    id:          r.id,
    name:        r.name,
    accountType: r.account_type,
    creditLimit: Number(r.credit_limit),
    accountKey:  r.account_key ?? null,
    notes:       r.notes ?? null,
    active:      r.active,
    createdAt:   r.created_at,
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({})

  const method = event.httpMethod
  // Extract id from path: /.netlify/functions/credit-accounts/:id
  const pathParts = (event.path || '').split('/').filter(Boolean)
  const id = pathParts[pathParts.length - 1] !== 'credit-accounts' ? pathParts[pathParts.length - 1] : undefined

  // GET — list all credit accounts ordered by name
  if (method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('credit_accounts')
        .select('*')
        .order('name', { ascending: true })
      if (error) return err(error.message)
      return ok((data || []).map(toClient))
    } catch (_e) {
      return err('Failed to fetch credit accounts')
    }
  }

  // POST — create new credit account
  if (method === 'POST') {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(event.body || '{}') } catch (_e) { return err('Invalid JSON', 400) }
    if (!body.name) return err('name is required', 400)
    try {
      const { data, error } = await supabase
        .from('credit_accounts')
        .insert({
          name:         body.name,
          account_type: body.accountType ?? body.account_type ?? 'credit_card',
          credit_limit: Number(body.creditLimit ?? body.credit_limit ?? 0),
          account_key:  body.accountKey ?? body.account_key ?? null,
          notes:        body.notes ?? null,
          active:       body.active !== undefined ? body.active : true,
        })
        .select('*')
        .single()
      if (error) return err(error.message)
      return ok(toClient(data), 201)
    } catch (_e) {
      return err('Failed to create credit account')
    }
  }

  // PATCH /:id — update credit account fields
  if (method === 'PATCH') {
    if (!id) return err('ID required for PATCH', 400)
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(event.body || '{}') } catch (_e) { return err('Invalid JSON', 400) }
    const patch: Record<string, unknown> = {}
    if (body.name        !== undefined) patch.name         = body.name
    if (body.accountType !== undefined) patch.account_type = body.accountType
    if (body.account_type!== undefined) patch.account_type = body.account_type
    if (body.creditLimit !== undefined) patch.credit_limit = Number(body.creditLimit)
    if (body.credit_limit!== undefined) patch.credit_limit = Number(body.credit_limit)
    if (body.accountKey  !== undefined) patch.account_key  = body.accountKey
    if (body.account_key !== undefined) patch.account_key  = body.account_key
    if (body.notes       !== undefined) patch.notes        = body.notes
    if (body.active      !== undefined) patch.active       = body.active
    try {
      const { data, error } = await supabase
        .from('credit_accounts')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) return err(error.message)
      return ok(toClient(data))
    } catch (_e) {
      return err('Failed to update credit account')
    }
  }

  // DELETE /:id — delete credit account
  if (method === 'DELETE') {
    if (!id) return err('ID required for DELETE', 400)
    try {
      const { error } = await supabase
        .from('credit_accounts')
        .delete()
        .eq('id', id)
      if (error) return err(error.message)
      return ok({ deleted: true })
    } catch (_e) {
      return err('Failed to delete credit account')
    }
  }

  return err('Method not allowed', 405)
}
