/**
 * monthly-report.ts — Monthly scheduled KPI report
 *
 * Runs on the 1st of every month at 9 AM Eastern (13:00 UTC).
 * Computes KPIs for the prior calendar month, sends an SMS summary to
 * the owner's number (865-603-6396), and stores the report in kpi_reports.
 *
 * KPIs:
 *   - Total Revenue (transactions Income)
 *   - Total Expenses (transactions Expense)
 *   - Net Profit
 *   - Jobs Completed
 *   - Avg Job Value (revenue / jobs)
 *   - Quotes Sent
 *   - Quotes Signed
 *   - Win Rate %
 *   - MRR (active subscriptions)
 *   - New Leads
 *   - Total Marketing Spend (marketing_spend table)
 *   - Cost Per Lead (marketing spend / new leads)
 *   - Top Lead Source
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
  const period = firstOfPrior.toISOString().slice(0, 10)  // YYYY-MM-01
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
    // ── Load company settings ────────────────────────────────────────────────
    const { data: settings } = await supabase
      .from('company_settings')
      .select('quo_api_key, quo_from_number, company_name')
      .limit(1)
      .single()

    const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
    const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
    const companyName = settings?.company_name ?? 'KECC'

    // ── Revenue & Expenses ───────────────────────────────────────────────────
    const { data: transactions } = await supabase
      .from('transactions')
      .select('type, amount, category')
      .gte('date', start.slice(0, 10))
      .lt('date', end.slice(0, 10))

    const txs = transactions ?? []
    const totalRevenue  = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
    const totalExpenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
    const netProfit     = totalRevenue - totalExpenses

    // ── Jobs Completed ───────────────────────────────────────────────────────
    const { data: completedJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end)

    const jobsCompleted = completedJobs?.length ?? 0
    const avgJobValue   = jobsCompleted > 0 ? totalRevenue / jobsCompleted : 0

    // ── Quotes ───────────────────────────────────────────────────────────────
    const { data: quotesSentRows } = await supabase
      .from('quotes')
      .select('id, status, signed_at, sent_at')
      .or(`status.eq.sent,status.eq.accepted`)
      .gte('sent_at', start)
      .lt('sent_at', end)

    const quotesSent   = quotesSentRows?.length ?? 0
    const quotesSigned = quotesSentRows?.filter(q => q.signed_at).length ?? 0
    const winRate      = quotesSent > 0 ? Math.round((quotesSigned / quotesSent) * 100) : 0

    // ── MRR (all active subscriptions) ──────────────────────────────────────
    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select('in_season_monthly_total')
      .eq('status', 'active')

    const mrr = (activeSubs ?? []).reduce((s, sub) => s + Number(sub.in_season_monthly_total ?? 0), 0)

    // ── New leads ────────────────────────────────────────────────────────────
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

    // ── Marketing spend ──────────────────────────────────────────────────────
    const monthStart = period  // YYYY-MM-01
    const nextMonthDate = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() + 1))
    const monthEnd = nextMonthDate.toISOString().slice(0, 10)

    const { data: mktSpend } = await supabase
      .from('marketing_spend')
      .select('amount')
      .gte('month', monthStart)
      .lt('month', monthEnd)

    const totalMarketingSpend = (mktSpend ?? []).reduce((s, r) => s + Number(r.amount), 0)
    const costPerLead = newLeadsCount > 0 && totalMarketingSpend > 0
      ? totalMarketingSpend / newLeadsCount
      : null

    // ── Build report data ────────────────────────────────────────────────────
    const reportData = {
      period: label,
      revenue:             totalRevenue,
      expenses:            totalExpenses,
      netProfit,
      jobsCompleted,
      avgJobValue,
      quotesSent,
      quotesSigned,
      winRate,
      mrr,
      newLeads:            newLeadsCount,
      topSource,
      marketingSpend:      totalMarketingSpend,
      costPerLead,
    }

    // ── Store in kpi_reports ─────────────────────────────────────────────────
    await supabase
      .from('kpi_reports')
      .upsert({
        period: period,
        report_data: reportData,
        sms_sent: false,
      }, { onConflict: 'period' })

    // ── Build SMS text ───────────────────────────────────────────────────────
    const profitSign  = netProfit >= 0 ? '+' : ''
    const cplStr      = costPerLead != null ? fmt(costPerLead) : 'N/A'
    const sourceLabel = topSource
      ? topSource.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'N/A'

    const lines: string[] = [
      `📊 ${companyName} — ${label} KPIs`,
      ``,
      `💰 Revenue:   ${fmt(totalRevenue)}`,
      `📉 Expenses:  ${fmt(totalExpenses)}`,
      `✅ Net:       ${profitSign}${fmt(netProfit)}`,
      ``,
      `🔁 MRR:       ${fmt(mrr)}`,
      `🔨 Jobs Done: ${jobsCompleted} (avg ${fmt(avgJobValue)})`,
      ``,
      `📋 Quotes:    ${quotesSent} sent · ${quotesSigned} signed · ${winRate}% win`,
      `📣 New Leads: ${newLeadsCount} (top: ${sourceLabel})`,
      `📢 Mkt Spend: ${fmt(totalMarketingSpend)} · CPL: ${cplStr}`,
    ]

    const message = lines.join('\n')
    console.log('[monthly-report] SMS preview:\n' + message)

    // ── Send SMS ─────────────────────────────────────────────────────────────
    if (apiKey && fromNumber) {
      await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, message)

      // Stamp sms_sent = true
      await supabase
        .from('kpi_reports')
        .update({ sms_sent: true })
        .eq('period', period)

      console.log(`[monthly-report] ✓ KPI SMS sent to ${OWNER_PHONE}`)
    } else {
      console.log('[monthly-report] OpenPhone not configured — skipping SMS send')
    }

    console.log('[monthly-report] Done')
  } catch (err) {
    console.error('[monthly-report] Error:', err instanceof Error ? err.message : err)
  }
})

export { handler }
