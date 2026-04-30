import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

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

  const action = event.queryStringParameters?.action

  try {
    // ── GET budget ──────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && action === 'budget') {
      const { data } = await supabase.from('marketing_budget').select('*').limit(1).single()
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ monthlyBudget: data?.monthly_budget ?? 0 }) }
    }

    // ── PATCH budget ─────────────────────────────────────────────────────────
    if (event.httpMethod === 'PATCH' && action === 'budget') {
      const { monthlyBudget } = JSON.parse(event.body ?? '{}')
      const { data: existing } = await supabase.from('marketing_budget').select('id').limit(1).single()
      if (existing) {
        await supabase.from('marketing_budget').update({ monthly_budget: monthlyBudget, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await supabase.from('marketing_budget').insert({ monthly_budget: monthlyBudget })
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // ── GET spend entries (optionally filtered by month YYYY-MM) ────────────
    if (event.httpMethod === 'GET' && !action) {
      const month = event.queryStringParameters?.month  // e.g. '2026-04'
      let query = supabase.from('marketing_spend').select('*').order('channel')
      if (month) {
        const monthStart = `${month}-01`
        const nextMonth = new Date(monthStart)
        nextMonth.setMonth(nextMonth.getMonth() + 1)
        const monthEnd = nextMonth.toISOString().slice(0, 10)
        query = query.gte('month', monthStart).lt('month', monthEnd)
      }
      const { data, error } = await query
      if (error) throw error
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify((data ?? []).map(r => ({
          id: r.id,
          channel: r.channel,
          amount: Number(r.amount),
          month: r.month,
          notes: r.notes,
          createdAt: r.created_at,
        }))),
      }
    }

    // ── POST upsert spend entry (channel + month = unique) ──────────────────
    if (event.httpMethod === 'POST') {
      const { channel, amount, month, notes } = JSON.parse(event.body ?? '{}')
      if (!channel || !month) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'channel and month required' }) }

      const monthDate = `${month}-01`
      // Check if entry for this channel+month already exists
      const { data: existing } = await supabase
        .from('marketing_spend')
        .select('id')
        .eq('channel', channel)
        .eq('month', monthDate)
        .single()

      if (existing) {
        await supabase.from('marketing_spend').update({ amount: Number(amount ?? 0), notes: notes ?? null }).eq('id', existing.id)
      } else {
        await supabase.from('marketing_spend').insert({ channel, amount: Number(amount ?? 0), month: monthDate, notes: notes ?? null })
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // ── DELETE spend entry ──────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'id required' }) }
      await supabase.from('marketing_spend').delete().eq('id', id)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message }) }
  }
}
