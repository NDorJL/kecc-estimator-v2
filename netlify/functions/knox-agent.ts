/**
 * knox-agent.ts — Autonomous Knox scheduled agent
 *
 * Runs daily at noon UTC (7 am EST / 8 am EDT).
 * - Every day:       Morning briefing (jobs, stale leads, unsigned quotes)
 * - Every Monday:    + Weekly pipeline & revenue summary
 * - Every 1st:       + Monthly marketing performance snapshot
 *
 * Sends directly to owner's phone via OpenPhone — no approval queue.
 * Falls back to structured text if Claude API is unavailable.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY      — Anthropic API key
 *   OWNER_PHONE            — owner's personal cell, e.g. 8656036396
 *   CLAUDE_AGENT_MODEL     — optional model override (default: claude-sonnet-4-5)
 */
import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { sendOpenPhoneSms } from './_smsHelper'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CLAUDE_MODEL = process.env.CLAUDE_AGENT_MODEL ?? process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5'
const OWNER_PHONE  = process.env.OWNER_PHONE ?? '8656036396'

// ── Data collection helpers ────────────────────────────────────────────────────

async function getDailyData() {
  const today           = new Date().toISOString().slice(0, 10)
  const threeDaysAgo    = new Date(Date.now() -  3 * 86400000).toISOString()
  const sevenDaysAgo    = new Date(Date.now() -  7 * 86400000).toISOString()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  const [todayJobs, activeSubs, staleLeads, unsignedQuotes, overdueJobs] = await Promise.all([
    // Scheduled service jobs for today (exclude quote visits)
    supabase.from('jobs')
      .select('service_name, scheduled_window, customer_name, customer_address')
      .eq('scheduled_date', today).neq('status', 'cancelled').neq('job_type', 'quote_visit').order('scheduled_window'),
    // Active subscriptions — recurring obligations
    supabase.from('subscriptions')
      .select('customer_name, services, in_season_monthly_total')
      .eq('status', 'ACTIVE'),
    supabase.from('leads')
      .select('stage, service_interest, contact_id')
      .in('stage', ['new', 'follow_up'])
      .lt('created_at', sevenDaysAgo).limit(5),
    supabase.from('quotes')
      .select('customer_name, total, sent_at')
      .eq('status', 'sent').lt('sent_at', threeDaysAgo).is('signed_at', null).is('trashed_at', null).limit(5),
    // Service jobs past their date — exclude quote visits, cap lookback at 14 days
    supabase.from('jobs')
      .select('service_name, scheduled_date, customer_name')
      .eq('status', 'scheduled').neq('job_type', 'quote_visit')
      .gte('scheduled_date', fourteenDaysAgo).lt('scheduled_date', today).limit(3),
  ])

  return {
    todayJobs:           todayJobs.data   ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeSubscriptions: (activeSubs.data ?? []).map((s: any) => ({
      customerName: s.customer_name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: (s.services ?? []).map((svc: any) => `${svc.serviceName} (${svc.frequency})`).join(', '),
    })),
    staleLeads:          staleLeads.data     ?? [],
    unsignedQuotes:      unsignedQuotes.data ?? [],
    overdueServiceJobs:  overdueJobs.data    ?? [],
    date:                today,
  }
}

async function getWeeklyData() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const today   = new Date().toISOString().slice(0, 10)

  const [newLeads, closedLeads, quotesActivity, subsRes] = await Promise.all([
    supabase.from('leads').select('id').gte('created_at', weekAgo),
    supabase.from('leads').select('estimated_value')
      .eq('stage', 'finished_paid').gte('created_at', weekAgo),
    supabase.from('quotes').select('status, total').gte('created_at', weekAgo).is('trashed_at', null),
    supabase.from('subscriptions').select('in_season_monthly_total').eq('status', 'ACTIVE'),
  ])

  const revenue = (closedLeads.data ?? []).reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)
  const mrr     = (subsRes.data     ?? []).reduce((s, r) => s + Number(r.in_season_monthly_total), 0)
  const sent     = (quotesActivity.data ?? []).filter(q => q.status === 'sent' || q.status === 'accepted').length
  const accepted = (quotesActivity.data ?? []).filter(q => q.status === 'accepted').length

  return {
    newLeadsCount:  (newLeads.data ?? []).length,
    closedRevenue:  revenue,
    quotesSent:     sent,
    quotesAccepted: accepted,
    mrr,
  }
}

async function getMonthlyMarketingData() {
  const now   = new Date()
  const prev  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  const start = `${month}-01`
  const end   = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).toISOString().slice(0, 10)

  const [spendRes, leadsRes, channels] = await Promise.all([
    supabase.from('marketing_spend').select('channel_id, amount').eq('month', month),
    supabase.from('leads').select('source, stage').gte('created_at', start).lte('created_at', end),
    supabase.from('marketing_channels').select('id, name'),
  ])

  const channelMap  = Object.fromEntries((channels.data ?? []).map(c => [c.id, c.name]))
  const totalSpend  = (spendRes.data ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const totalLeads  = (leadsRes.data ?? []).length
  const totalClosed = (leadsRes.data ?? []).filter(l => l.stage === 'finished_paid').length

  return { month, totalSpend, totalLeads, totalClosed }
}

// ── Claude API call ────────────────────────────────────────────────────────────

async function generateBriefing(dataContext: string): Promise<string | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const systemPrompt = [
      'You are Knox, the KECC AI agent. You are generating an automated morning briefing SMS for the owner.',
      'Rules: plain text only (no markdown, no bullet symbols), concise, direct, actionable.',
      'Keep the total response under 480 characters so it fits in 3 SMS messages.',
      'Start with "Knox AM —" followed by the date.',
      'Mention jobs first, then any urgent items. End with MRR if available.',
    ].join(' ')

    const response = await anthropic.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: `Generate the briefing SMS from this data:\n${dataContext}` }],
      // @ts-expect-error — temperature accepted at runtime
      temperature: 0.4,
    })

    const textBlock = response.content.find(c => c.type === 'text') as { type: 'text'; text: string } | undefined
    return textBlock?.text?.trim() ?? null
  } catch {
    return null  // Claude unavailable — caller uses fallback
  }
}

// ── Fallback template (no LLM needed) ─────────────────────────────────────────

function buildFallbackBriefing(
  daily: Awaited<ReturnType<typeof getDailyData>>,
  weekly: Awaited<ReturnType<typeof getWeeklyData>> | null,
  monthly: Awaited<ReturnType<typeof getMonthlyMarketingData>> | null,
): string {
  const lines: string[] = []
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  lines.push(`Knox AM — ${dateStr}`)

  if (daily.todayJobs.length > 0) {
    lines.push(`${daily.todayJobs.length} job${daily.todayJobs.length > 1 ? 's' : ''} today: ${daily.todayJobs.map(j => `${j.customer_name?.split(' ')[0]} (${j.scheduled_window ?? 'open'})`).join(', ')}`)
  } else {
    lines.push('No jobs scheduled today.')
  }

  const urgent: string[] = []
  if (daily.unsignedQuotes.length > 0) urgent.push(`${daily.unsignedQuotes.length} unsigned quote${daily.unsignedQuotes.length > 1 ? 's' : ''}`)
  if (daily.staleLeads.length > 0)     urgent.push(`${daily.staleLeads.length} stale lead${daily.staleLeads.length > 1 ? 's' : ''}`)
  if (daily.overdueServiceJobs.length > 0)    urgent.push(`${daily.overdueServiceJobs.length} overdue job${daily.overdueServiceJobs.length > 1 ? 's' : ''}`)
  if (urgent.length > 0) lines.push(`Needs attention: ${urgent.join(', ')}`)

  if (weekly) {
    lines.push(`Week: ${weekly.newLeadsCount} new leads, $${weekly.closedRevenue.toFixed(0)} closed, MRR $${weekly.mrr.toFixed(0)}`)
  }

  if (monthly) {
    lines.push(`${monthly.month} marketing: $${monthly.totalSpend.toFixed(0)} spend, ${monthly.totalLeads} leads, ${monthly.totalClosed} closed`)
  }

  return lines.join('\n')
}

// ── Main handler ───────────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  console.log('[knox-agent] Starting autonomous daily run')

  try {
    // Check what kind of day it is
    const now            = new Date()
    const isMonday       = now.getDay() === 1
    const isFirstOfMonth = now.getDate() === 1

    // Collect data
    const [daily, weekly, monthly] = await Promise.all([
      getDailyData(),
      isMonday       ? getWeeklyData()           : Promise.resolve(null),
      isFirstOfMonth ? getMonthlyMarketingData() : Promise.resolve(null),
    ])

    // Build data context for Claude
    const dataContext = JSON.stringify({ daily, weekly: weekly ?? undefined, monthly: monthly ?? undefined }, null, 2)

    // Try Claude API first, fall back to template
    const message = (await generateBriefing(dataContext)) ?? buildFallbackBriefing(daily, weekly, monthly)

    // Get OpenPhone credentials
    const { data: settings } = await supabase
      .from('company_settings')
      .select('quo_api_key, quo_from_number')
      .limit(1).single()

    const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY     ?? ''
    const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''

    if (!apiKey || !fromNumber) {
      console.log('[knox-agent] OpenPhone not configured — logging only')
    } else {
      await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, message)
      console.log('[knox-agent] Briefing sent to owner')
    }

    // Audit log
    await supabase.from('knox_log').insert({
      trigger_type:  'scheduled',
      user_message:  null,
      knox_response: message,
      tools_called:  ['get_daily_briefing', ...(isMonday ? ['get_weekly_data'] : []), ...(isFirstOfMonth ? ['get_monthly_marketing'] : [])],
      actions_taken: [{ tool: 'notify_owner', args: { to: OWNER_PHONE }, result: { sent: !!apiKey } }],
    })

    return { statusCode: 200, body: JSON.stringify({ sent: true, preview: message.slice(0, 100) }) }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[knox-agent] Error:', message)
    return { statusCode: 500, body: JSON.stringify({ error: message }) }
  }
}
