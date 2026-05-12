/**
 * knox-observer.ts — Knox weekly insight engine
 *
 * Runs every Monday at midnight UTC (Sunday 7 pm ET).
 * Uses Claude to find non-obvious patterns by comparing this week's data
 * against the prior week.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY    — Anthropic API key
 *   OWNER_PHONE          — owner's personal cell
 *   CLAUDE_AGENT_MODEL   — optional model override (default: claude-3-5-sonnet-20241022)
 */
import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { sendOpenPhoneSms } from './_smsHelper'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CLAUDE_MODEL = process.env.CLAUDE_AGENT_MODEL ?? process.env.CLAUDE_MODEL ?? 'claude-3-5-sonnet-20241022'
const OWNER_PHONE  = process.env.OWNER_PHONE ?? '8656036396'

// ── Date helpers ───────────────────────────────────────────────────────────────

function weekRange(weeksAgo: number): { start: string; end: string } {
  const endMs   = Date.now() - weeksAgo * 7 * 86400000
  const startMs = endMs - 7 * 86400000
  return {
    start: new Date(startMs).toISOString().slice(0, 10),
    end:   new Date(endMs).toISOString().slice(0, 10),
  }
}

function monthRange(monthsAgo: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - monthsAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Data collectors ────────────────────────────────────────────────────────────

async function getWeekData(range: { start: string; end: string }) {
  const [leadsRes, closedRes, quotesRes, jobsRes] = await Promise.all([
    supabase.from('leads').select('source, stage, created_at, contact_id')
      .gte('created_at', `${range.start}T00:00:00`).lt('created_at', `${range.end}T23:59:59`),
    supabase.from('leads').select('estimated_value')
      .in('stage', ['finished_paid', 'finished_unpaid'])
      .gte('created_at', `${range.start}T00:00:00`).lt('created_at', `${range.end}T23:59:59`),
    supabase.from('quotes').select('status, total')
      .gte('created_at', `${range.start}T00:00:00`).lt('created_at', `${range.end}T23:59:59`)
      .is('trashed_at', null),
    supabase.from('jobs').select('service_name, status')
      .eq('status', 'completed')
      .gte('completed_at', `${range.start}T00:00:00`).lt('completed_at', `${range.end}T23:59:59`),
  ])

  const leads  = leadsRes.data   ?? []
  const closed = closedRes.data  ?? []
  const quotes = quotesRes.data  ?? []
  const jobs   = jobsRes.data    ?? []

  // Lead source breakdown
  const bySource: Record<string, number> = {}
  for (const l of leads) {
    const src = l.source ?? 'Unattributed'
    bySource[src] = (bySource[src] ?? 0) + 1
  }

  // Service breakdown for completed jobs
  const byService: Record<string, number> = {}
  for (const j of jobs) {
    const svc = (j.service_name ?? 'Unknown').split(' ').slice(0, 3).join(' ')
    byService[svc] = (byService[svc] ?? 0) + 1
  }

  const sent     = quotes.filter(q => q.status === 'sent' || q.status === 'accepted')
  const accepted = quotes.filter(q => q.status === 'accepted')

  return {
    newLeads:       leads.length,
    leadsBySource:  bySource,
    closedJobs:     closed.length,
    closedRevenue:  closed.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0),
    jobsCompleted:  jobs.length,
    servicesMix:    byService,
    quotesSent:     sent.length,
    quotesAccepted: accepted.length,
    acceptanceRate: sent.length > 0 ? Math.round((accepted.length / sent.length) * 100) : null,
  }
}

async function getBusinessContext() {
  const thisMonth = monthRange(0)
  const lastMonth = monthRange(1)

  const [subsRes, pipelineRes, spendThisRes, spendLastRes, channelRes] = await Promise.all([
    supabase.from('subscriptions').select('status, in_season_monthly_total'),
    supabase.from('leads').select('stage').not('stage', 'in', '("finished_paid","finished_unpaid","lost")'),
    supabase.from('marketing_spend').select('channel_id, amount').eq('month', thisMonth),
    supabase.from('marketing_spend').select('channel_id, amount').eq('month', lastMonth),
    supabase.from('marketing_channels').select('id, name'),
  ])

  const subs   = subsRes.data ?? []
  const active = subs.filter(s => s.status === 'ACTIVE')
  const mrr    = active.reduce((s, r) => s + Number(r.in_season_monthly_total), 0)

  const pipeline = pipelineRes.data ?? []
  const byStage: Record<string, number> = {}
  for (const l of pipeline) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1

  const channelMap = Object.fromEntries((channelRes.data ?? []).map(c => [c.id, c.name]))

  const spendThis: Record<string, number> = {}
  for (const s of (spendThisRes.data ?? [])) {
    const name = channelMap[s.channel_id] ?? s.channel_id
    spendThis[name] = (spendThis[name] ?? 0) + Number(s.amount)
  }
  const spendLast: Record<string, number> = {}
  for (const s of (spendLastRes.data ?? [])) {
    const name = channelMap[s.channel_id] ?? s.channel_id
    spendLast[name] = (spendLast[name] ?? 0) + Number(s.amount)
  }

  return {
    mrr,
    activeSubscriptions:  active.length,
    pausedSubscriptions:  subs.filter(s => s.status === 'PAUSED').length,
    openPipelineLeads:    pipeline.length,
    pipelineByStage:      byStage,
    marketingSpendThisMonth: spendThis,
    marketingSpendLastMonth: spendLast,
  }
}

// ── Claude API — generate weekly insights ─────────────────────────────────────

async function generateInsights(data: object): Promise<string | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const systemPrompt = [
      'You are Knox, KECC\'s AI agent running a weekly business intelligence analysis.',
      'Analyze the week-over-week data and identify 2-3 genuinely non-obvious patterns.',
      'Focus on: unexpected shifts, source concentrations, pipeline anomalies, margin signals.',
      'Do NOT state the obvious ("leads went up"). Explain the implication.',
      'Output: plain text only, no markdown. First line: "Knox Weekly Insights:".',
      'Each insight numbered, max 90 chars each. If nothing notable, say so plainly.',
    ].join(' ')

    const userMsg = `Week ending ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}:\n\n${JSON.stringify(data, null, 2)}`

    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMsg }],
      // @ts-expect-error — temperature accepted at runtime
      temperature: 0.5,
    })

    const textBlock = response.content.find(c => c.type === 'text') as { type: 'text'; text: string } | undefined
    return textBlock?.text?.trim() || null
  } catch {
    return null  // Claude unavailable — caller uses fallback
  }
}

// ── Fallback when Ollama is unreachable ────────────────────────────────────────

function buildFallback(
  thisWeek:  Awaited<ReturnType<typeof getWeekData>>,
  lastWeek:  Awaited<ReturnType<typeof getWeekData>>,
  context:   Awaited<ReturnType<typeof getBusinessContext>>,
): string {
  const dateStr   = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const leadDelta = thisWeek.newLeads - lastWeek.newLeads
  const revDelta  = thisWeek.closedRevenue - lastWeek.closedRevenue
  const topSource = Object.entries(thisWeek.leadsBySource).sort((a, b) => b[1] - a[1])[0]

  return [
    `Knox Weekly (${dateStr})`,
    `Leads: ${thisWeek.newLeads} (${leadDelta >= 0 ? '+' : ''}${leadDelta} vs last wk)`,
    `Revenue: $${thisWeek.closedRevenue.toFixed(0)} (${revDelta >= 0 ? '+' : ''}$${Math.abs(revDelta).toFixed(0)})`,
    topSource ? `Top source: ${topSource[0]} (${topSource[1]} leads)` : null,
    `MRR $${context.mrr.toFixed(0)} | Pipeline: ${context.openPipelineLeads} leads`,
  ].filter(Boolean).join('\n')
}

// ── Main handler ───────────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  console.log('[knox-observer] Starting weekly insight run')

  try {
    const thisWeek = weekRange(0)
    const lastWeek = weekRange(1)

    const [thisWeekData, lastWeekData, context] = await Promise.all([
      getWeekData(thisWeek),
      getWeekData(lastWeek),
      getBusinessContext(),
    ])

    const analysisPayload = {
      thisWeek:  { period: `${thisWeek.start} → ${thisWeek.end}`,  ...thisWeekData },
      lastWeek:  { period: `${lastWeek.start} → ${lastWeek.end}`, ...lastWeekData },
      businessContext: context,
    }

    // Use DeepSeek R1 for insight generation; fall back to template if offline
    const message = (await generateInsights(analysisPayload))
      ?? buildFallback(thisWeekData, lastWeekData, context)

    // Send to owner
    const { data: settings } = await supabase
      .from('company_settings').select('quo_api_key, quo_from_number').limit(1).single()
    const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY     ?? ''
    const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''

    if (apiKey && fromNumber) {
      await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, message)
      console.log('[knox-observer] Insights sent')
    } else {
      console.log('[knox-observer] OpenPhone not configured — skipping send')
    }

    // Audit log
    await supabase.from('knox_log').insert({
      trigger_type:  'scheduled',
      user_message:  null,
      knox_response: message,
      tools_called:  ['weekly_insight_analysis'],
      actions_taken: [{ tool: 'notify_owner', args: { to: OWNER_PHONE }, result: { sent: !!apiKey } }],
    })

    return { statusCode: 200, body: JSON.stringify({ sent: !!apiKey, preview: message.slice(0, 120) }) }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[knox-observer] Error:', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
