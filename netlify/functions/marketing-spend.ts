import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToMarketingSpend } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/marketing-spend\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod
  const action = event.queryStringParameters?.action

  try {
    // ── GET budget ──────────────────────────────────────────────────────────
    if (method === 'GET' && action === 'budget') {
      const { data } = await supabase.from('marketing_budget').select('*').limit(1).single()
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ monthlyBudget: data?.monthly_budget ?? 0 }) }
    }

    // ── PATCH budget ─────────────────────────────────────────────────────────
    if (method === 'PATCH' && action === 'budget') {
      const { monthlyBudget } = JSON.parse(event.body ?? '{}')
      const { data: existing } = await supabase.from('marketing_budget').select('id').limit(1).single()
      if (existing) {
        await supabase.from('marketing_budget').update({ monthly_budget: monthlyBudget, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await supabase.from('marketing_budget').insert({ monthly_budget: monthlyBudget })
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // ── LIST spend entries ──────────────────────────────────────────────────
    // Optional query params: ?month=YYYY-MM  ?channelId=<uuid>
    if (method === 'GET' && !id && !action) {
      const month     = event.queryStringParameters?.month      // 'YYYY-MM'
      const channelId = event.queryStringParameters?.channelId

      let query = supabase
        .from('marketing_spend')
        .select('*')
        .order('month', { ascending: false })
        .order('created_at', { ascending: false })

      if (month)     query = query.eq('month', month)
      if (channelId) query = query.eq('channel_id', channelId)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToMarketingSpend)) }
    }

    // ── GET single spend entry ──────────────────────────────────────────────
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('marketing_spend')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToMarketingSpend(data)) }
    }

    // ── CREATE / upsert spend entry ─────────────────────────────────────────
    // channelId + month = logical unique key; upsert if already exists
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const { channelId, month, amount, notes, isRecurring } = body
      if (!channelId || !month) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'channelId and month are required' }) }
      }

      // Check if entry for this channel + month already exists
      const { data: existing } = await supabase
        .from('marketing_spend')
        .select('id')
        .eq('channel_id', channelId)
        .eq('month', month)
        .maybeSingle()

      let result
      if (existing) {
        const { data, error } = await supabase
          .from('marketing_spend')
          .update({ amount: Number(amount ?? 0), notes: notes ?? null, is_recurring: isRecurring ?? false })
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw new Error(error.message)
        result = data
      } else {
        const { data, error } = await supabase
          .from('marketing_spend')
          .insert({ channel_id: channelId, month, amount: Number(amount ?? 0), notes: notes ?? null, is_recurring: isRecurring ?? false })
          .select()
          .single()
        if (error) throw new Error(error.message)
        result = data
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToMarketingSpend(result)) }
    }

    // ── UPDATE spend entry ──────────────────────────────────────────────────
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.amount      !== undefined) updates.amount       = Number(body.amount)
      if (body.notes       !== undefined) updates.notes        = body.notes
      if (body.month       !== undefined) updates.month        = body.month
      if (body.channelId   !== undefined) updates.channel_id  = body.channelId
      if (body.isRecurring !== undefined) updates.is_recurring = body.isRecurring

      const { data, error } = await supabase
        .from('marketing_spend')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToMarketingSpend(data)) }
    }

    // ── DELETE spend entry ──────────────────────────────────────────────────
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('marketing_spend').delete().eq('id', id)
      if (error) throw new Error(error.message)
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
