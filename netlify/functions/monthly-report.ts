/**
 * monthly-report.ts — Manual KPI report trigger
 *
 * Previously ran on a schedule (1st of month, 9 AM ET). Now responds to an
 * HTTP POST so the owner can trigger it manually after uploading transactions.
 *
 * Authorization: if MONTHLY_REPORT_SECRET env var is set, the POST body must
 * include { "secret": "<value>" }. If the env var is not set, any POST is
 * accepted (trusted because this endpoint is only called from the CRM).
 *
 * Idempotent: checks kpi_reports before doing anything — if sms_sent is
 * already true for this period, returns 409 immediately.
 *
 * Will NOT send if no bank transactions have been uploaded for the month.
 * Instead logs a warning and exits so the owner can upload first.
 */

import type { Handler } from '@netlify/functions'   // ← CHANGED: was `schedule`
import { createClient } from '@supabase/supabase-js'
import { sendOpenPhoneSms } from './_smsHelper'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {                                        // ← NEW: HTTP handler needs CORS
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const OWNER_PHONE = '8656036396'   // 865-603-6396

/** Returns {start, end} ISO strings bounding the prior calendar month. */
function priorMonth(): { start: string; end: string; label: string; period: string } {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfPrior = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - 1, 1)
  const start = firstOfPrior.toISOString()
  const end   = firstOfThisMonth.toISOString()
  const label = firstOfPrior.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const period = firstOfPrior.toISOString().slice(0, 10)   // 'YYYY-MM-01'
  return { start, end, label, period }
}

function fmt(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

// ── Subscription occurrence counter ──────────────────────────────────────────
// Mirrors countSubOccurrencesInBucket() from Finance.tsx — counts how many
// individual service visits are scheduled to occur within [rangeStart, rangeEnd).
// Used to align Jobs Completed with what the Analytics tab reports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countSubOccurrencesInRange(subs: any[], rangeStart: Date, rangeEnd: Date): number {
  let count = 0

  for (const sub of subs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedules: any[] = Array.isArray(sub.service_schedules) ? sub.service_schedules : []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function countSchedule(sy: number, sm: number, sd: number, freq: string, dayOfWeekTarget: number): void {
      const schStart = new Date(sy, sm - 1, sd, 12, 0, 0, 0)
      const isDateBased = freq.includes('quarter') || freq.includes('annual')
      const effectiveStart = schStart > rangeStart ? schStart : new Date(rangeStart)
      effectiveStart.setHours(12, 0, 0, 0)
      const endCap = new Date(rangeEnd)
      endCap.setHours(12, 0, 0, 0)

      const cursor = new Date(effectiveStart)
      while (cursor < endCap) {
        const year  = cursor.getFullYear()
        const month = cursor.getMonth()
        const day   = cursor.getDate()
        const daysInMonth = new Date(year, month + 1, 0).getDate()

        if (isDateBased) {
          const totalMonths = (year - sy) * 12 + ((month + 1) - sm)
          const interval = freq.includes('quarter') ? 3 : 12
          if (totalMonths % interval === 0 && day === sd) count++
        } else {
          if (cursor.getDay() === dayOfWeekTarget) {
            if (freq.includes('bi') && freq.includes('week')) {
              const startDow     = new Date(sy, sm - 1, sd).getDay()
              const startSunday  = new Date(sy, sm - 1, sd - startDow)
              const thisSunday   = new Date(year, month, day - cursor.getDay())
              const weekDiff = Math.round((thisSunday.getTime() - startSunday.getTime()) / (7 * 86400000))
              if (weekDiff % 2 === 0) count++
            } else if (freq.includes('month')) {
              const targetDom = sd
              const occs: number[] = []
              for (let d2 = 1; d2 <= daysInMonth; d2++) {
                if (new Date(year, month, d2).getDay() === dayOfWeekTarget) occs.push(d2)
              }
              const best = occs.reduce((a, b2) => Math.abs(a - targetDom) <= Math.abs(b2 - targetDom) ? a : b2)
              if (day === best) {
                if (freq.includes('bi')) {
                  const totalMonths = (year - sy) * 12 + ((month + 1) - sm)
                  if (totalMonths % 2 === 0) count++
                } else {
                  count++
                }
              }
            } else {
              // Weekly: every matching weekday
              count++
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1)
      }
    }

    if (schedules.length > 0) {
      for (const sch of schedules) {
        const parts = (sch.startDate ?? '').split('-').map(Number) as number[]
        if (!parts[0]) continue
        const [sy, sm, sd] = parts
        countSchedule(sy, sm, sd, (sch.frequency ?? '').toLowerCase(), sch.dayOfWeek ?? 0)
      }
    } else {
      // Fallback: subscriptions using services[] + top-level start_date
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const services: any[] = Array.isArray(sub.services) ? sub.services : []
      const parts = (sub.start_date ?? '').split('-').map(Number) as number[]
      if (!parts[0] || services.length === 0) continue
      const [sy, sm, sd] = parts
      const startDow = new Date(sy, sm - 1, sd).getDay()
      for (const svc of services) {
        countSchedule(sy, sm, sd, (svc.frequency ?? '').toLowerCase(), startDow)
      }
    }
  }

  return count
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {   // ← CHANGED: was schedule()

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed — use POST' }) }
  }

  // Authorization: validate secret if MONTHLY_REPORT_SECRET env var is configured
  const expectedSecret = process.env.MONTHLY_REPORT_SECRET
  if (expectedSecret) {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(event.body ?? '{}') } catch (_e) { /* ignore parse errors */ }
    if (body.secret !== expectedSecret) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ message: 'Unauthorized' }) }
    }
  }

  console.log('[monthly-report] Manual trigger received')

  const { start, end, label, period } = priorMonth()
  console.log(`[monthly-report] Reporting on: ${label} (${start} → ${end})`)

  try {
    // ── Idempotency check ────────────────────────────────────────────────────
    const { data: existingReport } = await supabase
      .from('kpi_reports')
      .select('id, sms_sent')
      .eq('period', period)
      .maybeSingle()

    if (existingReport?.sms_sent) {
      console.log('[monthly-report] Already sent for this period')
      return { statusCode: 409, headers: CORS, body: JSON.stringify({ message: `Already sent for ${label}` }) }
    }

    // ── Load company settings ────────────────────────────────────────────────
    const { data: settings } = await supabase
      .from('company_settings')
      .select('quo_api_key, quo_from_number, company_name')
      .limit(1)
      .single()

    const apiKey      = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
    const fromNumber  = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
    const companyName = settings?.company_name    ?? 'KECC'

    // ── Revenue & Expenses (from uploaded bank transactions) ─────────────────
    const startDate = start.slice(0, 10)
    const endDate   = end.slice(0, 10)

    const { data: transactions } = await supabase
      .from('transactions')
      .select('type, amount, category')
      .gte('date', startDate)
      .lt('date', endDate)

    const txs = transactions ?? []
    const totalRevenue  = txs.filter(t => t.type === 'Income').reduce((s, t) => s + Number(t.amount), 0)
    const totalExpenses = txs.filter(t => t.type === 'Expense').reduce((s, t) => s + Number(t.amount), 0)
    const netProfit     = totalRevenue - totalExpenses
    const hasTransactions = txs.length > 0

    if (!hasTransactions) {
      console.log('[monthly-report] No transactions uploaded for this period — report will flag missing financial data')
    }

    // ── Jobs Completed ───────────────────────────────────────────────────────  ← CHANGED
    // Uses the same logic as Finance Analytics tab:
    //   1. Leads that moved to finished_paid or finished_unpaid this month
    //      (using created_at as proxy, same as countJobsDone() in Finance.tsx)
    //   2. Subscription service occurrences that fell within the month
    // The old approach (jobs.completed_at) was removed because completed_at is
    // never stamped — our workflow uses lead stage changes, not the jobs table.

    const { data: finishedLeads } = await supabase
      .from('leads')
      .select('id')
      .in('stage', ['finished_paid', 'finished_unpaid'])
      .gte('created_at', start)
      .lt('created_at', end)

    const finishedLeadCount = finishedLeads?.length ?? 0

    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select('id, service_schedules, services, start_date')
      .eq('status', 'ACTIVE')

    const subOccurrences = countSubOccurrencesInRange(
      activeSubs ?? [],
      new Date(start),
      new Date(end),
    )

    const jobsCompleted = finishedLeadCount + subOccurrences
    const avgJobValue   = jobsCompleted > 0 ? totalRevenue / jobsCompleted : 0

    // ── Quotes created/active in the month ───────────────────────────────────
    const { data: quotesInRange } = await supabase
      .from('quotes')
      .select('id, status, signed_at, trashed_at')
      .gte('created_at', start)
      .lt('created_at', end)
      .is('trashed_at', null)

    const quotes = quotesInRange ?? []
    const quotesSent   = quotes.filter(q => ['sent', 'accepted', 'declined'].includes(q.status)).length
    const quotesSigned = quotes.filter(q => q.signed_at != null).length
    const winRate      = quotesSent > 0 ? Math.round((quotesSigned / quotesSent) * 100) : 0

    // ── MRR (active subscriptions) ───────────────────────────────────────────
    const { data: activeMrrSubs } = await supabase
      .from('subscriptions')
      .select('in_season_monthly_total')
      .eq('status', 'ACTIVE')

    const mrr = (activeMrrSubs ?? []).reduce((s, sub) => s + Number(sub.in_season_monthly_total ?? 0), 0)

    // ── New Leads ────────────────────────────────────────────────────────────
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, source')
      .gte('created_at', start)
      .lt('created_at', end)

    const newLeadsCount = newLeads?.length ?? 0

    const sourceCounts: Record<string, number> = {}
    for (const l of (newLeads ?? [])) {
      if (l.source) sourceCounts[l.source] = (sourceCounts[l.source] ?? 0) + 1
    }
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    // ── Marketing Spend ──────────────────────────────────────────────────────
    const nextMonthDate = new Date(new Date(period).setMonth(new Date(period).getMonth() + 1))
    const nextMonthStr  = nextMonthDate.toISOString().slice(0, 10)

    const { data: mktSpend } = await supabase
      .from('marketing_spend')
      .select('amount')
      .gte('month', period)
      .lt('month', nextMonthStr)

    const totalMarketingSpend = (mktSpend ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const costPerLead = newLeadsCount > 0 && totalMarketingSpend > 0
      ? totalMarketingSpend / newLeadsCount
      : null

    // ── Build & store report data ────────────────────────────────────────────
    const reportData = {
      period:          label,
      hasTransactions,
      revenue:         totalRevenue,
      expenses:        totalExpenses,
      netProfit,
      jobsCompleted,
      avgJobValue,
      quotesSent,
      quotesSigned,
      winRate,
      mrr,
      newLeads:        newLeadsCount,
      topSource,
      marketingSpend:  totalMarketingSpend,
      costPerLead,
    }

    // Stamp sms_sent = true BEFORE sending (prevents duplicate sends on retry)
    await supabase
      .from('kpi_reports')
      .upsert(
        { period, report_data: reportData, sms_sent: true },
        { onConflict: 'period' }
      )

    // ── Build SMS text ───────────────────────────────────────────────────────
    if (!apiKey || !fromNumber) {
      console.log('[monthly-report] OpenPhone not configured — skipping SMS')
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Report saved but SMS not configured' }) }
    }

    const profitSign  = netProfit >= 0 ? '+' : ''
    const cplStr      = costPerLead != null ? fmt(costPerLead) : 'N/A'
    const sourceLabel = topSource
      ? topSource.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
      : 'N/A'

    let lines: string[]

    if (!hasTransactions) {
      lines = [
        `📊 ${companyName} — ${label} KPIs`,
        ``,
        `⚠️ No bank transactions uploaded yet for ${label}.`,
        `Revenue, expenses, and net profit are unavailable.`,
        `Upload your bank CSV in the Finance tab to get full data.`,
        ``,
        `📋 Quotes created: ${quotes.length} (${quotesSigned} signed · ${winRate}% win)`,
        `📣 New Leads: ${newLeadsCount}${topSource ? ` (top: ${sourceLabel})` : ''}`,
        `🔁 MRR: ${mrr > 0 ? fmt(mrr) : 'N/A'}`,
        `🔨 Jobs completed: ${jobsCompleted}`,
        `📢 Mkt Spend: ${totalMarketingSpend > 0 ? fmt(totalMarketingSpend) : '$0 logged'}`,
      ]
    } else {
      lines = [
        `📊 ${companyName} — ${label} KPIs`,
        ``,
        `💰 Revenue:   ${fmt(totalRevenue)}`,
        `📉 Expenses:  ${fmt(totalExpenses)}`,
        `✅ Net:       ${profitSign}${fmt(netProfit)}`,
        ``,
        `🔁 MRR:       ${mrr > 0 ? fmt(mrr) : 'N/A'}`,
        `🔨 Jobs Done: ${jobsCompleted}${jobsCompleted > 0 ? ` (avg ${fmt(avgJobValue)})` : ''}`,
        ``,
        `📋 Quotes:    ${quotesSent} sent · ${quotesSigned} signed · ${winRate}% win`,
        `📣 New Leads: ${newLeadsCount}${topSource ? ` (top: ${sourceLabel})` : ''}`,
        `📢 Mkt Spend: ${fmt(totalMarketingSpend)} · CPL: ${cplStr}`,
      ]
    }

    const message = lines.join('\n')
    console.log('[monthly-report] Sending SMS:\n' + message)

    await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, message)
    console.log(`[monthly-report] ✓ KPI SMS sent to ${OWNER_PHONE}`)
    console.log('[monthly-report] Done')

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: `Monthly report sent for ${label}` }) }

  } catch (err) {
    console.error('[monthly-report] Error:', err instanceof Error ? err.message : err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: err instanceof Error ? err.message : 'Internal error' }) }
  }
}
