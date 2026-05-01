/**
 * monthly-report.ts — Monthly scheduled KPI report
 *
 * Runs on the 1st of every month at 9 AM Eastern (13:00 UTC).
 * Computes KPIs for the prior calendar month, sends an SMS summary to
 * the owner's number (865-603-6396), and stores the report in kpi_reports.
 *
 * Idempotent: checks kpi_reports before doing anything — if sms_sent is
 * already true for this period, exits immediately. Netlify occasionally
 * fires scheduled functions more than once; this prevents duplicate texts.
 *
 * Will NOT send if no bank transactions have been uploaded for the month.
 * Instead logs a warning and exits so the owner can upload first.
 */

import { schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { sendOpenPhoneSms } from './_smsHelper'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

const handler = schedule('0 13 1 * *', async () => {
  console.log('[monthly-report] Starting monthly KPI report')

  const { start, end, label, period } = priorMonth()
  console.log(`[monthly-report] Reporting on: ${label} (${start} → ${end})`)

  try {
    // ── Idempotency check ────────────────────────────────────────────────────
    // Netlify scheduled functions can fire more than once. If we've already
    // sent for this period, bail immediately before doing anything.
    const { data: existingReport } = await supabase
      .from('kpi_reports')
      .select('id, sms_sent')
      .eq('period', period)
      .maybeSingle()

    if (existingReport?.sms_sent) {
      console.log('[monthly-report] Already sent for this period — skipping duplicate invocation')
      return
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
    // Types are stored as 'Income' and 'Expense' (capital first letter).
    const startDate = start.slice(0, 10)   // 'YYYY-MM-DD'
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

    // ── Jobs Completed ───────────────────────────────────────────────────────
    // Primary: jobs explicitly stamped completed_at in range (added this sprint).
    // Fallback: jobs with status=completed whose scheduled_date falls in range
    // (covers jobs completed before the completed_at column existed).
    const { data: jobsByCompletedAt } = await supabase
      .from('jobs')
      .select('id')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end)

    const { data: jobsByScheduledDate } = await supabase
      .from('jobs')
      .select('id')
      .eq('status', 'completed')
      .is('completed_at', null)
      .gte('scheduled_date', startDate)
      .lt('scheduled_date', endDate)

    // Merge, deduplicate by id
    const allJobIds = new Set([
      ...(jobsByCompletedAt ?? []).map(j => j.id),
      ...(jobsByScheduledDate ?? []).map(j => j.id),
    ])
    const jobsCompleted = allJobIds.size
    const avgJobValue   = jobsCompleted > 0 ? totalRevenue / jobsCompleted : 0

    // ── Quotes created/active in the month ───────────────────────────────────
    // Use created_at for the date range (always set, unlike sent_at which is
    // only populated for quotes sent via the CRM after that feature was added).
    // Include all non-trashed quotes created in range regardless of status,
    // so win rate is calculated against the full cohort.
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
    // Status is stored as 'ACTIVE' (uppercase) in the subscriptions table.
    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select('in_season_monthly_total')
      .eq('status', 'ACTIVE')

    const mrr = (activeSubs ?? []).reduce((s, sub) => s + Number(sub.in_season_monthly_total ?? 0), 0)

    // ── New Leads ────────────────────────────────────────────────────────────
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, source')
      .gte('created_at', start)
      .lt('created_at', end)

    const newLeadsCount = newLeads?.length ?? 0

    // Top lead source
    const sourceCounts: Record<string, number> = {}
    for (const l of (newLeads ?? [])) {
      if (l.source) sourceCounts[l.source] = (sourceCounts[l.source] ?? 0) + 1
    }
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    // ── Marketing Spend ──────────────────────────────────────────────────────
    // marketing_spend stores month as 'YYYY-MM-01' date values.
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

    // ── Mark sms_sent = true BEFORE sending ──────────────────────────────────
    // Stamping true first means a second concurrent invocation that passes the
    // idempotency check above will still see true before it reaches the send call.
    await supabase
      .from('kpi_reports')
      .upsert(
        { period, report_data: reportData, sms_sent: true },
        { onConflict: 'period' }
      )

    // ── Build SMS text ───────────────────────────────────────────────────────
    if (!apiKey || !fromNumber) {
      console.log('[monthly-report] OpenPhone not configured — skipping SMS')
      return
    }

    const profitSign  = netProfit >= 0 ? '+' : ''
    const cplStr      = costPerLead != null ? fmt(costPerLead) : 'N/A'
    const sourceLabel = topSource
      ? topSource.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'N/A'

    let lines: string[]

    if (!hasTransactions) {
      // No financial data — send a reminder instead of zeros
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

  } catch (err) {
    console.error('[monthly-report] Error:', err instanceof Error ? err.message : err)
  }
})

export { handler }
