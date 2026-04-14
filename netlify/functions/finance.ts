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

// Seed transactions (Feb–Apr 2026)
const SEED_TX = [
  // Feb 2026
  { date: '2026-02-01', description: 'Corterie General Liability Insurance',     amount: 60,      type: 'Expense', category: 'Insurance - General Liability',  account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-02-01', description: 'Social Media Mgmt - Hope',                  amount: 300,     type: 'Expense', category: 'Marketing - Social Media',        account: 'KECC Checking (TVA)',             notes: 'Monthly retainer', review: false },
  { date: '2026-02-01', description: 'Perplexity Subscription',                   amount: 22,      type: 'Expense', category: 'Software - Perplexity',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Claude Pro Subscription',                   amount: 20,      type: 'Expense', category: 'Software - Claude Pro',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Dropbox',                                   amount: 13,      type: 'Expense', category: 'Software - Dropbox',              account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Squarespace',                               amount: 36,      type: 'Expense', category: 'Software - Squarespace',          account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Workflowy Pro',                             amount: 6,       type: 'Expense', category: 'Software - Workflowy',            account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Quo',                                       amount: 22,      type: 'Expense', category: 'Software - Quo',                  account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Canva Pro',                                 amount: 15,      type: 'Expense', category: 'Software - Canva',                account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'Google Workspace',                          amount: 8.50,    type: 'Expense', category: 'Software - Google Workspace',     account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-01', description: 'QuickBooks Simple Start',                   amount: 40,      type: 'Expense', category: 'Software - QuickBooks',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-02-05', description: 'Chase Ink Autopay',                         amount: 40,      type: 'Expense', category: 'Debt Service',                    account: 'KECC Checking (TVA)',             notes: 'Monthly CC payment', review: false },
  { date: '2026-02-10', description: 'Job Payment - Residential Wash',            amount: 1500,    type: 'Income',  category: 'Active Jobs - Residential',       account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-02-15', description: 'Job Payment - Residential Wash',            amount: 686,     type: 'Income',  category: 'Active Jobs - Residential',       account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-02-20', description: 'Cash Withdrawal - Subcontractor',           amount: 764.50,  type: 'Expense', category: 'Subcontracted Labor',             account: 'Cash',                            notes: 'Sub labor - Feb job', review: false },
  // Mar 2026
  { date: '2026-03-01', description: 'Corterie General Liability Insurance',     amount: 60,      type: 'Expense', category: 'Insurance - General Liability',  account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-03-01', description: 'Social Media Mgmt - Hope',                  amount: 300,     type: 'Expense', category: 'Marketing - Social Media',        account: 'KECC Checking (TVA)',             notes: 'Monthly retainer', review: false },
  { date: '2026-03-01', description: 'Perplexity Subscription',                   amount: 22,      type: 'Expense', category: 'Software - Perplexity',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Claude Pro Subscription',                   amount: 20,      type: 'Expense', category: 'Software - Claude Pro',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Dropbox',                                   amount: 13,      type: 'Expense', category: 'Software - Dropbox',              account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Squarespace',                               amount: 36,      type: 'Expense', category: 'Software - Squarespace',          account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Workflowy Pro',                             amount: 6,       type: 'Expense', category: 'Software - Workflowy',            account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Quo',                                       amount: 22,      type: 'Expense', category: 'Software - Quo',                  account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Canva Pro',                                 amount: 15,      type: 'Expense', category: 'Software - Canva',                account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'Google Workspace',                          amount: 8.50,    type: 'Expense', category: 'Software - Google Workspace',     account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-01', description: 'QuickBooks Simple Start',                   amount: 40,      type: 'Expense', category: 'Software - QuickBooks',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-03-05', description: 'Chase Ink Autopay',                         amount: 40,      type: 'Expense', category: 'Debt Service',                    account: 'KECC Checking (TVA)',             notes: 'Monthly CC payment', review: false },
  { date: '2026-03-05', description: 'TCEP Subscription - Steve Bailey',          amount: 210,     type: 'Income',  category: 'Subscription - TCEP',             account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-03-05', description: 'TCEP Subscription - Mike Grimes',           amount: 292,     type: 'Income',  category: 'Subscription - TCEP',             account: 'KECC Checking (TVA)',             notes: '', review: false },
  // Apr 2026
  { date: '2026-04-01', description: 'Corterie General Liability Insurance',     amount: 60,      type: 'Expense', category: 'Insurance - General Liability',  account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-04-01', description: 'Social Media Mgmt - Hope',                  amount: 300,     type: 'Expense', category: 'Marketing - Social Media',        account: 'KECC Checking (TVA)',             notes: 'Monthly retainer', review: false },
  { date: '2026-04-01', description: 'Perplexity Subscription',                   amount: 22,      type: 'Expense', category: 'Software - Perplexity',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Claude Pro Subscription',                   amount: 20,      type: 'Expense', category: 'Software - Claude Pro',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Dropbox',                                   amount: 13,      type: 'Expense', category: 'Software - Dropbox',              account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Squarespace',                               amount: 36,      type: 'Expense', category: 'Software - Squarespace',          account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Workflowy Pro',                             amount: 6,       type: 'Expense', category: 'Software - Workflowy',            account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Quo',                                       amount: 22,      type: 'Expense', category: 'Software - Quo',                  account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Canva Pro',                                 amount: 15,      type: 'Expense', category: 'Software - Canva',                account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'Google Workspace',                          amount: 8.50,    type: 'Expense', category: 'Software - Google Workspace',     account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-01', description: 'QuickBooks Simple Start',                   amount: 40,      type: 'Expense', category: 'Software - QuickBooks',           account: 'Chase Ink Business Unlimited',    notes: '', review: false },
  { date: '2026-04-05', description: 'Chase Ink Autopay',                         amount: 40,      type: 'Expense', category: 'Debt Service',                    account: 'KECC Checking (TVA)',             notes: 'Monthly CC payment', review: false },
  { date: '2026-04-05', description: 'TCEP Subscription - Steve Bailey',          amount: 210,     type: 'Income',  category: 'Subscription - TCEP',             account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-04-05', description: 'TCEP Subscription - Mike Grimes',           amount: 292,     type: 'Income',  category: 'Subscription - TCEP',             account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-04-10', description: 'Job Payment - Residential Wash',            amount: 1500,    type: 'Income',  category: 'Active Jobs - Residential',       account: 'KECC Checking (TVA)',             notes: '', review: false },
  { date: '2026-04-18', description: 'Cash Withdrawal - Subcontractor',           amount: 1415,    type: 'Expense', category: 'Subcontracted Labor',             account: 'Cash',                            notes: 'Sub labor - April job', review: false },
]

const SEED_BS = [
  { month: 2, year: 2026, checking: 1015,  savings: 0, equipment: 0, vehicles: 0, real_estate: 0, other_assets: 0, chase_ink: 0,    auto_loan: 0, biz_loan: 0, other_liab: 0 },
  { month: 3, year: 2026, checking: 2564,  savings: 5, equipment: 0, vehicles: 0, real_estate: 0, other_assets: 0, chase_ink: 140,  auto_loan: 0, biz_loan: 0, other_liab: 0 },
  { month: 4, year: 2026, checking: 2878,  savings: 5, equipment: 0, vehicles: 0, real_estate: 0, other_assets: 0, chase_ink: 1979, auto_loan: 0, biz_loan: 0, other_liab: 0 },
]

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const action = event.queryStringParameters?.action ?? ''

  // ── PIN Verification ────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST' && action === 'verify-pin') {
    try {
      const { pin } = JSON.parse(event.body ?? '{}')
      const expected = process.env.FINANCE_PIN
      if (!expected) return err('FINANCE_PIN not configured', 500)
      if (String(pin) === String(expected)) return ok({ valid: true })
      return ok({ valid: false }, 200)
    } catch { return err('Invalid request', 400) }
  }

  // ── Seed Data ──────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST' && action === 'seed') {
    try {
      const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) return ok({ seeded: false, message: 'Already has data' })

      await supabase.from('transactions').insert(SEED_TX.map(t => ({ ...t, source: 'seed' })))
      await supabase.from('balance_sheet_snapshots').upsert(SEED_BS, { onConflict: 'month,year' })
      return ok({ seeded: true })
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }

  // ── Transactions ───────────────────────────────────────────────────────────
  if (event.path.includes('finance') && (action === '' || action === 'transactions' || action.startsWith('tx'))) {
    // GET list
    if (event.httpMethod === 'GET' && !event.queryStringParameters?.id) {
      try {
        const { year, month, type, review } = event.queryStringParameters ?? {}
        let q = supabase.from('transactions').select('*').order('date', { ascending: false })
        if (year) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
        if (month && year) {
          const m = String(month).padStart(2, '0')
          q = q.gte('date', `${year}-${m}-01`).lte('date', `${year}-${m}-31`)
        }
        if (type) q = q.eq('type', type)
        if (review === 'true') q = q.eq('review', true)
        const { data, error } = await q
        if (error) throw error
        return ok(data)
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }

    // GET single
    if (event.httpMethod === 'GET' && event.queryStringParameters?.id) {
      const { data, error } = await supabase.from('transactions').select('*').eq('id', event.queryStringParameters.id).single()
      if (error) return err(error.message, 404)
      return ok(data)
    }

    // POST create (or bulk insert from CSV)
    if (event.httpMethod === 'POST' && (action === '' || action === 'create')) {
      try {
        const body = JSON.parse(event.body ?? '{}')
        // Support both single object and array
        const rows = Array.isArray(body) ? body : [body]
        const { data, error } = await supabase.from('transactions').insert(rows).select()
        if (error) throw error
        return ok(data, 201)
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }

    // PATCH update
    if (event.httpMethod === 'PATCH') {
      try {
        const id = event.queryStringParameters?.id
        if (!id) return err('id required', 400)
        const body = JSON.parse(event.body ?? '{}')
        const { data, error } = await supabase.from('transactions').update(body).eq('id', id).select().single()
        if (error) throw error
        return ok(data)
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }

    // DELETE
    if (event.httpMethod === 'DELETE') {
      try {
        const id = event.queryStringParameters?.id
        if (!id) return err('id required', 400)
        const { error } = await supabase.from('transactions').delete().eq('id', id)
        if (error) throw error
        return ok({ deleted: true })
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }
  }

  // ── Balance Sheet Snapshots ────────────────────────────────────────────────
  if (action === 'snapshots') {
    // GET all snapshots (optionally by year)
    if (event.httpMethod === 'GET') {
      try {
        const { year } = event.queryStringParameters ?? {}
        let q = supabase.from('balance_sheet_snapshots').select('*').order('year').order('month')
        if (year) q = q.eq('year', Number(year))
        const { data, error } = await q
        if (error) throw error
        return ok(data)
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }

    // POST upsert snapshot
    if (event.httpMethod === 'POST') {
      try {
        const body = JSON.parse(event.body ?? '{}')
        const { data, error } = await supabase.from('balance_sheet_snapshots').upsert(body, { onConflict: 'month,year' }).select().single()
        if (error) throw error
        return ok(data, 201)
      } catch (e: unknown) { return err(e instanceof Error ? e.message : String(e)) }
    }
  }

  return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) }
}
