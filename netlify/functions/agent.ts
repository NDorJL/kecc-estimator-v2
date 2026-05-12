/**
 * Knox — KECC AI Agent
 *
 * Runs an agentic tool-use loop using the Anthropic Claude API.
 *
 * Required env vars (set in Netlify dashboard):
 *   ANTHROPIC_API_KEY — Anthropic API key
 *   CLAUDE_MODEL      — optional model override (default: claude-3-5-haiku-20241022)
 */
import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { services as priceBookServices } from '../../src/lib/pricing'
import { sendOpenPhoneSms } from './_smsHelper'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-3-5-haiku-20241022'

// Write tools — used for audit logging and frontend cache invalidation signals
export const WRITE_TOOLS = new Set([
  'create_contact', 'create_lead', 'update_lead_stage', 'add_note',
  'queue_sms', 'complete_job', 'schedule_job', 'batch_queue_review_requests',
  'remember_fact', 'notify_owner',
])

const OWNER_PHONE = process.env.OWNER_PHONE ?? '8656036396'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ── Tool definitions (exported for conversion to Anthropic format below) ─────

export const tools = [
  {
    type: 'function',
    function: {
      name: 'search_contacts',
      description: 'Search for contacts by name, phone number, email, or business name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search term' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact_details',
      description: 'Get full details for a contact — including property notes, gate codes, dog warnings, and custom field data',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'The contact UUID' },
        },
        required: ['contactId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_leads',
      description: 'Get leads from the sales pipeline, optionally filtered by stage',
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            description: 'Pipeline stage: new | contacted | follow_up | quoted | scheduled | recurring | finished_unpaid | finished_paid',
          },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_jobs_today',
      description: "Get all jobs scheduled for today, including customer addresses and any crew notes",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_jobs',
      description: 'Get jobs filtered by date or status',
      parameters: {
        type: 'object',
        properties: {
          date:   { type: 'string', description: 'ISO date YYYY-MM-DD' },
          status: { type: 'string', description: 'scheduled | in_progress | completed | cancelled' },
          limit:  { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quotes',
      description: 'Get quotes, optionally filtered by status or minimum amount',
      parameters: {
        type: 'object',
        properties: {
          status:    { type: 'string', description: 'draft | sent | accepted | declined' },
          minAmount: { type: 'number', description: 'Minimum quote total' },
          limit:     { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_subscriptions',
      description: 'Get recurring subscriptions, optionally filtered by status',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'ACTIVE | PAUSED | CANCELED' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_stats',
      description: 'Get a high-level business snapshot: MRR, open leads, open quote value, and jobs scheduled today',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_jobs',
      description: 'Get jobs scheduled in the next N days',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days ahead to look (default 7)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_job',
      description: 'Find jobs by customer name, address, or service name. Use this when field crew reference a job by name or location rather than ID.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Customer name, address, or service name' },
          date:  { type: 'string', description: 'Optional: filter to a specific date YYYY-MM-DD' },
        },
        required: ['query'],
      },
    },
  },
  // ── Write tools (always confirm with user before calling these) ───────────────
  {
    type: 'function',
    function: {
      name: 'create_contact',
      description: 'Create a new contact in the CRM. Search for existing contacts first to avoid duplicates.',
      parameters: {
        type: 'object',
        properties: {
          name:         { type: 'string', description: 'Full name' },
          phone:        { type: 'string', description: 'Phone number' },
          email:        { type: 'string' },
          type:         { type: 'string', description: 'residential or commercial (default: residential)' },
          businessName: { type: 'string' },
          source:       { type: 'string', description: 'How they found KECC' },
          notes:        { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lead',
      description: 'Create a new lead linked to an existing contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId:       { type: 'string', description: 'The contact UUID to link the lead to' },
          serviceInterest: { type: 'string', description: 'What service they are interested in' },
          estimatedValue:  { type: 'number', description: 'Estimated job value in dollars' },
          source:          { type: 'string', description: 'Lead source/channel' },
          notes:           { type: 'string' },
        },
        required: ['contactId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lead_stage',
      description: 'Move a lead to a different pipeline stage.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          stage:  { type: 'string', description: 'new | contacted | follow_up | quoted | scheduled | recurring | finished_unpaid | finished_paid | lost' },
        },
        required: ['leadId', 'stage'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Add or update notes on a lead, job, or contact. Also updates contact custom fields (gate codes, dog warnings, parking notes).',
      parameters: {
        type: 'object',
        properties: {
          recordType:   { type: 'string', description: 'lead | job | contact' },
          recordId:     { type: 'string', description: 'The UUID of the record' },
          notes:        { type: 'string', description: 'The note text to add' },
          customFields: { type: 'object', description: 'For contacts: key-value pairs like { gateCode: "1234", dogOnProperty: "yes - lab mix", parkingNotes: "use driveway" }' },
        },
        required: ['recordType', 'recordId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queue_sms',
      description: 'Queue an SMS message for human approval in the dashboard. The message will NOT be sent automatically — a human must approve it first.',
      parameters: {
        type: 'object',
        properties: {
          toPhone:   { type: 'string', description: 'Recipient phone number' },
          message:   { type: 'string', description: 'The full SMS message text' },
          contactId: { type: 'string', description: 'Contact UUID if known' },
          type:      { type: 'string', description: 'Message type label, e.g. follow_up, review_request, custom' },
        },
        required: ['toPhone', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_job',
      description: 'Mark a job as completed.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          notes: { type: 'string', description: 'Optional completion notes to log' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_job',
      description: 'Set or update the scheduled date and time window for a job.',
      parameters: {
        type: 'object',
        properties: {
          jobId:           { type: 'string' },
          scheduledDate:   { type: 'string', description: 'ISO date YYYY-MM-DD' },
          scheduledWindow: { type: 'string', description: 'morning | afternoon | evening | anytime' },
        },
        required: ['jobId', 'scheduledDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_history',
      description: 'Get the full service history for a contact — leads, quotes, jobs, and subscriptions combined into one timeline.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
        required: ['contactId'],
      },
    },
  },
  // ── Session 6: Automation triggers ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'preview_review_requests',
      description: 'Preview which jobs are eligible for a review request SMS — completed jobs with no review sent yet. Call this before batch_queue_review_requests to show the user what will be queued.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date YYYY-MM-DD to check (default: yesterday)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_queue_review_requests',
      description: 'Queue review request SMS messages for all eligible completed jobs. Always call preview_review_requests first and confirm with the user before calling this.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date YYYY-MM-DD (default: yesterday)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_untouched_leads',
      description: 'Find active leads that have had no stage change or follow-up in N days — leads falling through the cracks.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'How many days of inactivity to flag (default 7)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_marketing_report',
      description: 'Generate a comprehensive marketing report for a given month — spend by channel, leads, closed jobs, CPL, CPA, ROI, and top-performing channel.',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'YYYY-MM format (default: last month)' },
        },
        required: [],
      },
    },
  },
  // ── Session 5: Conversational & voice skills ─────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_price_book',
      description: 'Get the full KECC service catalog and pricing. Use this to answer questions about pricing, estimate a job, or explain what a service costs.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional: filter by category e.g. "Lawn Care", "Pressure Washing", "Gutter"' },
          serviceType: { type: 'string', description: 'Optional: residential | commercial | both' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_reengagement_message',
      description: 'Draft a re-engagement SMS for a contact who has gone quiet — a past customer or inactive lead. Returns a ready-to-review message. Use queue_sms afterward if the user approves.',
      parameters: {
        type: 'object',
        properties: {
          contactName:  { type: 'string', description: 'Customer first name' },
          lastService:  { type: 'string', description: 'What service they last had or were interested in' },
          context:      { type: 'string', description: 'Any extra context: how long ago, seasonal, etc.' },
        },
        required: ['contactName'],
      },
    },
  },
  // ── Session 4: Analytics & marketing tools ───────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_marketing_analytics',
      description: 'Get marketing performance by channel: spend, leads generated, jobs closed, CPL, CPA, and ROI. Includes a recommendation on which channel is performing best.',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'number', description: 'How many recent months to include (default 3)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_customers',
      description: 'Get the top customers ranked by total revenue from completed jobs and accepted quotes.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of customers to return (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_analytics',
      description: 'Breakdown of jobs and revenue by service type — shows which services are most in demand and most profitable.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_monthly_revenue_trend',
      description: 'Monthly revenue trend for the last N months — completed job revenue plus MRR.',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'number', description: 'Number of months to look back (default 6)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quote_analytics',
      description: 'Quote performance stats: acceptance rate, average value, average days to sign, and pipeline value.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ── Session 3: Proactive intelligence tools ───────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_daily_briefing',
      description: 'Compile a full daily briefing: today\'s jobs, stale leads needing attention, unsigned quotes past 3 days, overdue jobs, and any urgent pipeline issues.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'audit_pipeline',
      description: 'Audit the entire pipeline for problems: leads with no contact, no source attribution, stale stages, unsigned quotes, unscheduled jobs, and jobs past their scheduled date.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_upsell_opportunities',
      description: 'Find customers who have completed one-time jobs but have no active subscription — candidates to pitch on a recurring maintenance plan.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revenue_forecast',
      description: 'Forecast revenue for the current month: MRR from active subscriptions + completed job revenue so far this month + estimated value of remaining scheduled jobs.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_churn_risks',
      description: 'Identify churn risks: paused subscriptions, contacts with no job in 60+ days, and one-time customers who have never been pitched a subscription.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ── Phase 4: On-demand insight analysis ──────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_weekly_comparison',
      description: 'Compare this week\'s performance against last week across leads, revenue, quotes, and marketing sources. Returns structured data for insight analysis.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ── Autonomous / direct owner channel ────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'notify_owner',
      description: 'Send a direct SMS message to the KECC owner\'s personal phone — bypasses the approval queue. Use for summaries, alerts, or insights you want to push proactively. Never use for customer-facing messages.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message text to send to the owner' },
        },
        required: ['message'],
      },
    },
  },
  // ── Memory tools ──────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: 'Store a fact in Knox\'s persistent memory so it\'s available in future sessions. Use for things worth remembering across conversations: owner preferences, standing instructions, recurring notes.',
      parameters: {
        type: 'object',
        properties: {
          key:   { type: 'string', description: 'Short descriptive key, e.g. "owner_scheduling_preference"' },
          value: { type: 'string', description: 'The fact to remember' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Retrieve all facts stored in Knox\'s persistent memory.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

// ── Anthropic tool format (converted from the OpenAI-style definitions above) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const anthropicTools: Anthropic.Tool[] = (tools as any[]).map(t => ({
  name:         t.function.name,
  description:  t.function.description ?? '',
  input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
}))

// ── System prompt builder (exported for reuse in agent-stream.ts) ─────────────

export function buildSystemPrompt(
  context: { page?: string; recordLabel?: string } | undefined,
  memory: Array<{ key: string; value: string }>,
): string {
  const now = new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
  return `You are Knox — the AI assistant built specifically for Knox Exterior Care Co. (KECC). You are not a generic assistant. You were built for this business, you know this operation inside and out, and you are a trusted member of the KECC team.

YOUR IDENTITY
Name: Knox
Purpose: Built exclusively for KECC's internal operations — owner, office, and field crew.
Personality: Direct, confident, and field-savvy. You know the difference between Farragut and Hardin Valley. You know what MRR means and why it matters. You're not corporate or stiff — you're a trusted team member who happens to know everything about the operation. You have a dry sense of humor when it's appropriate, but you stay professional.

IF ASKED ABOUT YOURSELF, tell them:
- Your name is Knox, and you were built specifically for Knox Exterior Care Co.
- You have live access to the CRM — contacts, leads, jobs, quotes, subscriptions, and the full customer database
- You can look up gate codes, dog warnings, and property access notes
- You can pull today's route or check any day's schedule
- You can move leads through the pipeline, add notes to any record, and create new leads or contacts
- You can draft and queue SMS messages for approval (you never send without a human approving)
- You can mark jobs complete, schedule jobs, and pull a customer's full service history
- You know KECC's services, markets, pricing philosophy, and business strategy in detail
- You can answer questions about Knoxville's neighborhoods, service areas, and routing

GENERAL RULES
- Always call the right tool to retrieve actual data — never guess or make up CRM data
- If a question requires multiple tool calls, make them all before answering
- Keep responses short and direct — this is a mobile-friendly chat widget used in the field and office
- Use plain language. Bullet points for lists. No essays.
- If you don't know something, say so clearly rather than guessing

FIELD CREW GUIDANCE
- Field crew will refer to jobs and customers by name or address, not by ID — use find_job or search_contacts to look them up first
- For gate codes, dog warnings, or access notes: search_contacts → get_contact_details → read custom_fields and notes
- "Mark the Johnson job done" → find_job("Johnson") → confirm which job → complete_job
- "What's my route today?" → get_jobs_today → list in order by time window with addresses
- Log field notes with add_note so the office sees them immediately

WRITE TOOL RULES (create_contact, create_lead, update_lead_stage, add_note, queue_sms, complete_job, schedule_job)
- Always look up the relevant record first to confirm you have the right one
- Describe exactly what you're about to do and ask for confirmation before executing
- Example: "Found Mike Davis — lawn care, currently in Quoted. Move to Scheduled?" → wait for yes → then call the tool
- queue_sms never sends automatically — it goes to the Dashboard approval panel. Always show the drafted message text before queuing
- After any write action, confirm what was done: "Done — Davis is now in Scheduled."

AUTONOMOUS TOOLS (no confirmation needed — safe to execute immediately):
- notify_owner: sends a direct SMS to the owner's personal phone. Say what you're sending first, then send it. Never use for customers.
- remember_fact: stores a memory key. Just do it.
- recall_memory: reads memory. Just do it.

CONVERSATIONAL SKILLS
- Pricing questions: use get_price_book to pull real pricing, then explain it in plain language.
- Service explanations: explain what the service includes, why it matters, how often it's needed.
- Objection handling: if a customer says price is too high, remind them of value, offer to adjust scope, or suggest a lower-frequency plan. Never apologize for the price.
- Re-engagement drafts: use draft_reengagement_message to generate a message, show it to the user, let them edit if needed, then use queue_sms to submit for approval.

When someone asks about gate codes, access notes, dog warnings, or property-specific info — use get_contact_details or search_contacts and read the custom_fields and notes.

━━━ KECC KNOWLEDGE BASE ━━━

COMPANY
- Legal name: Knox Exterior Care Co. (KECC)
- Owner: Single owner-operator, late 20s, married, based in Powell, TN
- Founded: January 2026
- Website: https://www.knoxexteriorcare.com
- Brand voice: Professional but approachable. Local, reliable, personal service with a professional system behind it.

SERVICE AREA
Greater Knoxville, TN metro. Primary markets: Vonore, Oak Ridge, Louisville, Farragut, Lenoir City, Alcoa, Maryville, Loudon, Hardin Valley, Sequoyah Hills.

SERVICES
- Pressure washing / soft washing: house washing, driveway, deck, fence, roof, commercial buildings
- Lawn care: mowing, edging, trimming, blowing, seasonal maintenance — one-time and recurring
- Gutter services: cleaning, brightening, guard installation
- Window cleaning: exterior, interior/exterior, screens
- Christmas/holiday light installation and removal
- Other exterior maintenance as quoted

REVENUE MODEL
Two streams: (1) Recurring maintenance plans (MRR) — subscriptions, growing MRR is the #1 priority. (2) One-time / project jobs — quote-driven pipeline.

BUSINESS METRICS
- MRR: Monthly recurring subscription revenue. Primary health metric.
- CPL (Cost Per Lead): Marketing spend ÷ leads generated.
- CPA (Cost Per Acquisition): Marketing spend ÷ jobs closed.
- ROI: (Revenue − Spend) ÷ Spend × 100.
- Early traction: ~$1,000/month MRR within the first month of operation (January 2026).

MARKETING CHANNELS
Facebook Ads, Google Ads, Google Business Profile, Instagram, Nextdoor, door hangers, yard signs, truck wrap, referral/word of mouth, direct mail.

CRM DATA FLOW
Lead created → Quote built → Quote accepted → Job created → Job completed → Finance entry → If recurring → Subscription → MRR updated → Review request SMS sent automatically.

LEAD PIPELINE STAGES
new → contacted → follow_up → quoted → scheduled → recurring → finished_unpaid → finished_paid (lost = dead lead)

OWNER'S GOALS & PHILOSOPHY
- Near-term income goal: $150,000/year personal income
- Systems-first: build systems so the business runs without constant owner presence
- Data-driven: make decisions from real numbers, not intuition
- Long-term: KECC runs independently; owner works on it, not in it

ROUTING CLUSTERS (schedule same-cluster jobs on same day)
- Cluster A (West Knox/Core): Farragut, Hardin Valley, Sequoyah Hills, West Knoxville — 15–30 min
- Cluster B (Anderson Co.): Oak Ridge — 20–30 min
- Cluster C (Blount Co.): Maryville, Alcoa, Louisville — 25–35 min
- Cluster D (Loudon Co.): Lenoir City, Loudon — 35–50 min
- Cluster E (Outer): Vonore — 50–65 min, bundled high-value jobs only

SEASONAL DEMAND
- Spring (Mar–May): PEAK — pressure/soft washing, gutters, lawn startup, windows.
- Summer (Jun–Aug): Lawn care, windows, soft washing.
- Fall (Sep–Nov): Gutter cleaning (leaf drop), pressure washing, holiday lights.
- Winter (Dec–Feb): Slowest ops. Best time for subscription sales + renewals.

━━━ END KNOWLEDGE BASE ━━━

Current date/time: ${now}
Current CRM page: ${context?.page ?? 'unknown'}${context?.recordLabel ? `\nCurrently viewing: ${context.recordLabel}` : ''}${
    memory.length > 0
      ? `\n\nKNOX MEMORY (facts stored across sessions):\n${memory.map(m => `- ${m.key}: ${m.value}`).join('\n')}`
      : ''
  }`
}

// ── Convert frontend messages (OpenAI-compat) to Anthropic format ─────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAnthropicMessages(messages: any[]): Anthropic.MessageParam[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return messages.map((m: any): Anthropic.MessageParam => {
    const role = m.role as 'user' | 'assistant'
    if (!Array.isArray(m.content)) {
      return { role, content: String(m.content ?? '') }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (m.content as any[]).map((c: any): Anthropic.ContentBlockParam => {
      if (c.type === 'image_url') {
        // OpenAI format: { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
        // Anthropic format: { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
        const url: string = c.image_url?.url ?? ''
        const match = url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          return {
            type: 'image',
            source: {
              type:       'base64',
              media_type: match[1] as Anthropic.Base64ImageSource['media_type'],
              data:        match[2],
            },
          }
        }
      }
      return c as Anthropic.TextBlockParam
    })
    return { role, content }
  })
}

// ── Tool execution (all queries run server-side with the service key) ─────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {

    case 'search_contacts': {
      const q = String(args.query ?? '')
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone, email, type, business_name, custom_fields, notes, tags')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,business_name.ilike.%${q}%`)
        .limit(10)
      return data ?? []
    }

    case 'get_contact_details': {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', String(args.contactId))
        .single()
      return data ?? { error: 'Contact not found' }
    }

    case 'get_leads': {
      let query = supabase
        .from('leads')
        .select('id, stage, source, service_interest, estimated_value, notes, created_at, contact_id, quote_id, contacted_at, follow_up_sent_at')
        .order('created_at', { ascending: false })
        .limit(Number(args.limit ?? 20))
      if (args.stage) query = query.eq('stage', args.stage)
      const { data } = await query
      return data ?? []
    }

    case 'get_jobs_today': {
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('jobs')
        .select('id, service_name, status, scheduled_date, scheduled_window, customer_name, customer_address, customer_phone, notes, internal_notes, property_info')
        .eq('scheduled_date', today)
        .neq('status', 'cancelled')
        .order('scheduled_window')
      return data ?? []
    }

    case 'get_jobs': {
      let query = supabase
        .from('jobs')
        .select('id, service_name, status, scheduled_date, scheduled_window, customer_name, customer_address, notes, property_info')
        .order('scheduled_date', { ascending: false })
        .limit(Number(args.limit ?? 20))
      if (args.date)   query = query.eq('scheduled_date', args.date)
      if (args.status) query = query.eq('status', args.status)
      const { data } = await query
      return data ?? []
    }

    case 'get_quotes': {
      let query = supabase
        .from('quotes')
        .select('id, customer_name, total, status, created_at, sent_at, signed_at, quote_type, expires_at')
        .is('trashed_at', null)
        .order('created_at', { ascending: false })
        .limit(Number(args.limit ?? 20))
      if (args.status)    query = query.eq('status', args.status)
      if (args.minAmount) query = query.gte('total', Number(args.minAmount))
      const { data } = await query
      return data ?? []
    }

    case 'get_subscriptions': {
      let query = supabase
        .from('subscriptions')
        .select('id, customer_name, customer_address, status, in_season_monthly_total, services, start_date, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (args.status) query = query.eq('status', args.status)
      const { data } = await query
      return data ?? []
    }

    case 'get_dashboard_stats': {
      const today = new Date().toISOString().slice(0, 10)
      const [subsRes, leadsRes, quotesRes, jobsRes] = await Promise.all([
        supabase.from('subscriptions').select('in_season_monthly_total').eq('status', 'ACTIVE'),
        supabase.from('leads').select('stage').not('stage', 'in', '("finished_paid","finished_unpaid","lost")'),
        supabase.from('quotes').select('total, status').is('trashed_at', null).in('status', ['draft', 'sent']),
        supabase.from('jobs').select('id, status').eq('scheduled_date', today).neq('status', 'cancelled'),
      ])
      const mrr            = (subsRes.data ?? []).reduce((s, r) => s + Number(r.in_season_monthly_total), 0)
      const openLeads      = (leadsRes.data ?? []).length
      const openQuoteValue = (quotesRes.data ?? []).reduce((s, r) => s + Number(r.total), 0)
      const todayJobs      = (jobsRes.data ?? []).length
      return { mrr, openLeads, openQuoteValue, todayJobs, date: today }
    }

    case 'get_upcoming_jobs': {
      const days  = Number(args.days ?? 7)
      const start = new Date().toISOString().slice(0, 10)
      const end   = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
      const { data } = await supabase
        .from('jobs')
        .select('id, service_name, status, scheduled_date, scheduled_window, customer_name, customer_address, notes, property_info')
        .gte('scheduled_date', start)
        .lte('scheduled_date', end)
        .neq('status', 'cancelled')
        .order('scheduled_date')
        .order('scheduled_window')
      return data ?? []
    }

    case 'find_job': {
      const q = String(args.query ?? '')
      let query = supabase
        .from('jobs')
        .select('id, service_name, status, scheduled_date, scheduled_window, customer_name, customer_address, customer_phone, notes, property_info')
        .or(`customer_name.ilike.%${q}%,customer_address.ilike.%${q}%,service_name.ilike.%${q}%`)
        .neq('status', 'cancelled')
        .order('scheduled_date', { ascending: false })
        .limit(5)
      if (args.date) query = query.eq('scheduled_date', String(args.date))
      const { data } = await query
      return data ?? []
    }

    // ── Write tools ────────────────────────────────────────────────────────────

    case 'create_contact': {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          name:          String(args.name),
          phone:         args.phone        ?? null,
          email:         args.email        ?? null,
          type:          args.type         ?? 'residential',
          business_name: args.businessName ?? null,
          source:        args.source       ?? null,
          notes:         args.notes        ?? null,
          tags:          [],
          custom_fields: {},
        })
        .select('id, name, phone, email, type')
        .single()
      if (error) throw error
      return { success: true, contact: data }
    }

    case 'create_lead': {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          contact_id:       String(args.contactId),
          stage:            'new',
          service_interest: args.serviceInterest ?? null,
          estimated_value:  args.estimatedValue  ?? null,
          source:           args.source          ?? null,
          notes:            args.notes           ?? null,
        })
        .select('id, stage, service_interest, estimated_value, contact_id')
        .single()
      if (error) throw error
      return { success: true, lead: data }
    }

    case 'update_lead_stage': {
      const updates: Record<string, unknown> = { stage: String(args.stage) }
      if (args.stage === 'contacted') updates.contacted_at = new Date().toISOString()
      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', String(args.leadId))
        .select('id, stage, contact_id')
        .single()
      if (error) throw error
      return { success: true, lead: data }
    }

    case 'add_note': {
      const type = String(args.recordType)
      const id   = String(args.recordId)

      if (type === 'lead') {
        const { error } = await supabase.from('leads').update({ notes: args.notes }).eq('id', id)
        if (error) throw error
        return { success: true, updated: 'lead', id }
      }

      if (type === 'job') {
        const { error } = await supabase.from('jobs').update({ notes: args.notes }).eq('id', id)
        if (error) throw error
        return { success: true, updated: 'job', id }
      }

      if (type === 'contact') {
        const updates: Record<string, unknown> = {}
        if (args.notes)        updates.notes         = args.notes
        if (args.customFields) updates.custom_fields = args.customFields
        const { error } = await supabase.from('contacts').update(updates).eq('id', id)
        if (error) throw error
        return { success: true, updated: 'contact', id }
      }

      return { error: `Unknown recordType: ${type}` }
    }

    case 'queue_sms': {
      const { error } = await supabase.from('sms_queue').insert({
        to_phone:   String(args.toPhone),
        message:    String(args.message),
        type:       String(args.type ?? 'custom'),
        contact_id: args.contactId ?? null,
        status:     'pending',
      })
      if (error) throw error
      return { success: true, queued: true, note: 'Message queued for approval in the Dashboard SMS panel.' }
    }

    case 'complete_job': {
      const updates: Record<string, unknown> = {
        status:       'completed',
        completed_at: new Date().toISOString(),
      }
      if (args.notes) updates.notes = args.notes
      const { data, error } = await supabase
        .from('jobs')
        .update(updates)
        .eq('id', String(args.jobId))
        .select('id, service_name, status, customer_name')
        .single()
      if (error) throw error
      return { success: true, job: data }
    }

    case 'schedule_job': {
      const updates: Record<string, unknown> = {
        scheduled_date: String(args.scheduledDate),
      }
      if (args.scheduledWindow) updates.scheduled_window = args.scheduledWindow
      const { data, error } = await supabase
        .from('jobs')
        .update(updates)
        .eq('id', String(args.jobId))
        .select('id, service_name, scheduled_date, scheduled_window, customer_name')
        .single()
      if (error) throw error
      return { success: true, job: data }
    }

    case 'get_customer_history': {
      const cid = String(args.contactId)
      const [leadsRes, quotesRes, jobsRes, subsRes] = await Promise.all([
        supabase.from('leads').select('id, stage, service_interest, estimated_value, created_at, notes').eq('contact_id', cid).order('created_at', { ascending: false }),
        supabase.from('quotes').select('id, customer_name, total, status, created_at, signed_at, quote_type').eq('contact_id', cid).is('trashed_at', null).order('created_at', { ascending: false }),
        supabase.from('jobs').select('id, service_name, status, scheduled_date, completed_at, notes').eq('contact_id', cid).order('scheduled_date', { ascending: false }),
        supabase.from('subscriptions').select('id, status, in_season_monthly_total, services, start_date').eq('contact_id', cid).order('created_at', { ascending: false }),
      ])
      return {
        leads:         leadsRes.data   ?? [],
        quotes:        quotesRes.data  ?? [],
        jobs:          jobsRes.data    ?? [],
        subscriptions: subsRes.data    ?? [],
      }
    }

    // ── Session 6: Automation triggers ─────────────────────────────────────────

    case 'preview_review_requests': {
      const target = args.date
        ? String(args.date)
        : new Date(Date.now() - 86400000).toISOString().slice(0, 10)

      const { data } = await supabase
        .from('jobs')
        .select('id, service_name, customer_name, customer_phone, completed_at')
        .eq('status', 'completed')
        .gte('completed_at', `${target}T00:00:00`)
        .lte('completed_at', `${target}T23:59:59`)
        .is('review_sent_at', null)
        .not('customer_phone', 'is', null)

      return {
        date:     target,
        eligible: data ?? [],
        count:    (data ?? []).length,
        note:     'Call batch_queue_review_requests to queue these after user confirms.',
      }
    }

    case 'batch_queue_review_requests': {
      const target = args.date
        ? String(args.date)
        : new Date(Date.now() - 86400000).toISOString().slice(0, 10)

      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, service_name, customer_name, customer_phone, contact_id')
        .eq('status', 'completed')
        .gte('completed_at', `${target}T00:00:00`)
        .lte('completed_at', `${target}T23:59:59`)
        .is('review_sent_at', null)
        .not('customer_phone', 'is', null)

      const queued: string[] = []
      const failed: string[] = []

      for (const job of (jobs ?? [])) {
        const firstName = (job.customer_name ?? 'there').split(' ')[0]
        const message   = `Hi ${firstName}! Thank you for choosing Knox Exterior Care Co.! We hope your ${job.service_name} service exceeded your expectations. If you have a moment, we'd love to hear about your experience:\nhttps://g.page/r/CYjpuP4I4MbiEBM/review\nIt means the world to us! — Knox Exterior Care Co. Reply STOP to opt out.`

        const { error } = await supabase.from('sms_queue').insert({
          to_phone:   job.customer_phone,
          message,
          type:       'review_request',
          contact_id: job.contact_id ?? null,
          status:     'pending',
        })

        if (error) { failed.push(job.customer_name ?? job.id) }
        else        { queued.push(job.customer_name ?? job.id) }
      }

      // Stamp review_sent_at on successfully queued jobs
      if (queued.length > 0) {
        const queuedNames = new Set(queued)
        const jobIds = (jobs ?? []).filter(j => queuedNames.has(j.customer_name ?? j.id)).map(j => j.id)
        await supabase.from('jobs').update({ review_sent_at: new Date().toISOString() }).in('id', jobIds)
      }

      return { queued, failed, totalQueued: queued.length, note: 'Messages are pending approval in the Dashboard SMS panel.' }
    }

    case 'get_untouched_leads': {
      const days    = Number(args.days ?? 7)
      const cutoff  = new Date(Date.now() - days * 86400000).toISOString()
      const activeStages = ['new', 'contacted', 'follow_up', 'quoted', 'scheduled']

      const { data } = await supabase
        .from('leads')
        .select('id, stage, service_interest, created_at, contact_id, contacted_at, follow_up_sent_at')
        .in('stage', activeStages)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(30)

      // Enrich with contact names
      const contactIds = [...new Set((data ?? []).map(l => l.contact_id).filter(Boolean))]
      const { data: contacts } = contactIds.length > 0
        ? await supabase.from('contacts').select('id, name, phone').in('id', contactIds)
        : { data: [] }
      const contactMap = Object.fromEntries((contacts ?? []).map(c => [c.id, c]))

      return (data ?? []).map(l => ({
        ...l,
        contactName:  contactMap[l.contact_id]?.name  ?? 'Unknown',
        contactPhone: contactMap[l.contact_id]?.phone ?? null,
        daysSinceCreated: Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000),
      }))
    }

    case 'generate_marketing_report': {
      const now      = new Date()
      const month    = args.month
        ? String(args.month)
        : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}` // last month
      const start = `${month}-01`
      const end   = new Date(
        Number(month.split('-')[0]),
        Number(month.split('-')[1]),  // month already 1-indexed → this gives next month at index
        0
      ).toISOString().slice(0, 10)

      const [spendData, leadsData, channels] = await Promise.all([
        supabase.from('marketing_spend').select('channel_id, amount').eq('month', month),
        supabase.from('leads').select('id, source, campaign_id, stage, estimated_value').gte('created_at', start).lte('created_at', end),
        supabase.from('marketing_channels').select('id, name'),
      ])

      const channelMap = Object.fromEntries((channels.data ?? []).map(c => [c.id, c.name]))
      const spendByChannel: Record<string, number> = {}
      for (const s of (spendData.data ?? [])) {
        const name = channelMap[s.channel_id] ?? 'Unknown'
        spendByChannel[name] = (spendByChannel[name] ?? 0) + Number(s.amount)
      }

      const totalSpend = Object.values(spendByChannel).reduce((a, b) => a + b, 0)
      const totalLeads = (leadsData.data ?? []).length
      const closedLeads = (leadsData.data ?? []).filter(l => l.stage === 'finished_paid' || l.stage === 'finished_unpaid')
      const totalRevenue = closedLeads.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)

      // Per-channel breakdown
      const leadsBySource: Record<string, { leads: number; closed: number; revenue: number }> = {}
      for (const l of (leadsData.data ?? [])) {
        const src = l.source ?? 'Unattributed'
        if (!leadsBySource[src]) leadsBySource[src] = { leads: 0, closed: 0, revenue: 0 }
        leadsBySource[src].leads++
        if (l.stage === 'finished_paid' || l.stage === 'finished_unpaid') {
          leadsBySource[src].closed++
          leadsBySource[src].revenue += Number(l.estimated_value ?? 0)
        }
      }

      const channels2 = Object.keys({ ...spendByChannel, ...leadsBySource }).map(src => {
        const spend  = spendByChannel[src] ?? 0
        const stats  = leadsBySource[src]  ?? { leads: 0, closed: 0, revenue: 0 }
        return {
          channel:  src,
          spend,
          leads:    stats.leads,
          closed:   stats.closed,
          revenue:  stats.revenue,
          cpl:      stats.leads  > 0 && spend > 0 ? +(spend / stats.leads).toFixed(2)  : null,
          cpa:      stats.closed > 0 && spend > 0 ? +(spend / stats.closed).toFixed(2) : null,
          roi:      spend > 0 ? +((( stats.revenue - spend) / spend) * 100).toFixed(1)  : null,
        }
      }).sort((a, b) => b.spend - a.spend)

      const best = channels2.filter(c => c.cpa !== null && c.closed > 0).sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity))[0]

      return {
        month, totalSpend, totalLeads, totalClosed: closedLeads.length, totalRevenue,
        blendedCPL: totalLeads > 0 && totalSpend > 0 ? +(totalSpend / totalLeads).toFixed(2) : null,
        blendedCPA: closedLeads.length > 0 && totalSpend > 0 ? +(totalSpend / closedLeads.length).toFixed(2) : null,
        blendedROI: totalSpend > 0 ? +(((totalRevenue - totalSpend) / totalSpend) * 100).toFixed(1) : null,
        bestChannel: best?.channel ?? null,
        channels: channels2,
      }
    }

    // ── Session 5: Conversational & voice skills ────────────────────────────────

    case 'get_price_book': {
      let svcs = priceBookServices
      if (args.category)    svcs = svcs.filter(s => s.category.toLowerCase().includes(String(args.category).toLowerCase()))
      if (args.serviceType && args.serviceType !== 'both') {
        svcs = svcs.filter(s => s.serviceType === args.serviceType || s.serviceType === 'both')
      }
      return svcs.map(s => ({
        id:          s.id,
        name:        s.name,
        category:    s.category,
        serviceType: s.serviceType,
        pricingModel: s.pricingModel,
        unitLabel:   s.unitLabel,
        minimum:     s.minimum ?? null,
        tiers:       s.tiers.map(t => ({ label: t.label, min: t.min, max: t.max, price: t.price })),
        frequencies: s.frequencies.map(f => ({ frequency: f.frequency, label: f.label, discountPct: f.discountPct })),
        notes:       s.notes ?? null,
      }))
    }

    case 'draft_reengagement_message': {
      const name    = String(args.contactName ?? 'there')
      const service = args.lastService ? `your ${args.lastService}` : 'your property'
      const context = args.context ? ` ${args.context}` : ''
      const message = `Hey ${name}! This is Knox Exterior Care Co. — just wanted to check in on ${service}.${context} We'd love to get you scheduled for the season. Reply here or call us anytime. — KECC`
      return { draft: message, note: 'Review and edit before queuing. Use queue_sms to send for approval.' }
    }

    // ── Session 4: Analytics & marketing ───────────────────────────────────────

    case 'get_marketing_analytics': {
      const months = Number(args.months ?? 3)
      const since  = new Date(Date.now() - months * 30 * 86400000).toISOString()

      const [spendData, leadsData] = await Promise.all([
        supabase.from('marketing_spend').select('channel_id, amount, month').gte('month', since.slice(0, 7)),
        supabase.from('leads').select('id, source, campaign_id, stage, estimated_value').gte('created_at', since),
      ])

      // Get channel names
      const { data: channels } = await supabase.from('marketing_channels').select('id, name')
      const channelMap = Object.fromEntries((channels ?? []).map(c => [c.id, c.name]))

      // Aggregate spend by channel
      const spendByChannel: Record<string, number> = {}
      for (const s of (spendData.data ?? [])) {
        const name = channelMap[s.channel_id] ?? s.channel_id
        spendByChannel[name] = (spendByChannel[name] ?? 0) + Number(s.amount)
      }

      // Aggregate leads by source
      const leadsBySource: Record<string, { leads: number; closed: number; revenue: number }> = {}
      for (const l of (leadsData.data ?? [])) {
        const src = l.source ?? 'Unattributed'
        if (!leadsBySource[src]) leadsBySource[src] = { leads: 0, closed: 0, revenue: 0 }
        leadsBySource[src].leads++
        if (l.stage === 'finished_paid' || l.stage === 'finished_unpaid') {
          leadsBySource[src].closed++
          leadsBySource[src].revenue += Number(l.estimated_value ?? 0)
        }
      }

      // Build channel performance rows
      const allSources = new Set([...Object.keys(spendByChannel), ...Object.keys(leadsBySource)])
      const rows = Array.from(allSources).map(src => {
        const spend   = spendByChannel[src] ?? 0
        const stats   = leadsBySource[src] ?? { leads: 0, closed: 0, revenue: 0 }
        const cpl     = stats.leads  > 0 && spend > 0 ? spend / stats.leads  : null
        const cpa     = stats.closed > 0 && spend > 0 ? spend / stats.closed : null
        const roi     = spend > 0 ? ((stats.revenue - spend) / spend) * 100 : null
        return { channel: src, spend, ...stats, cpl, cpa, roi }
      }).sort((a, b) => b.spend - a.spend)

      // Best channel: lowest CPA with ≥1 closed job
      const best = rows.filter(r => r.cpa !== null && r.closed > 0).sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity))[0]

      return { period: `last ${months} months`, channels: rows, bestChannel: best?.channel ?? null }
    }

    case 'get_top_customers': {
      const limit = Number(args.limit ?? 10)
      const { data: leads } = await supabase
        .from('leads').select('contact_id, quote_id, estimated_value')
        .eq('stage', 'finished_paid').not('contact_id', 'is', null)

      // Sum revenue per contact
      const revenueByContact: Record<string, number> = {}
      for (const l of (leads ?? [])) {
        revenueByContact[l.contact_id] = (revenueByContact[l.contact_id] ?? 0) + Number(l.estimated_value ?? 0)
      }

      // Sort and take top N
      const topIds = Object.entries(revenueByContact)
        .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id)

      const { data: contacts } = await supabase
        .from('contacts').select('id, name, phone, type').in('id', topIds)
      const contactMap = Object.fromEntries((contacts ?? []).map(c => [c.id, c]))

      return topIds.map(id => ({
        ...contactMap[id],
        totalRevenue: revenueByContact[id],
      }))
    }

    case 'get_service_analytics': {
      const { data: jobs } = await supabase
        .from('jobs').select('service_name, status, quote_id').eq('status', 'completed')

      const byService: Record<string, { count: number }> = {}
      for (const j of (jobs ?? [])) {
        const svc = j.service_name ?? 'Unknown'
        if (!byService[svc]) byService[svc] = { count: 0 }
        byService[svc].count++
      }

      return Object.entries(byService)
        .map(([service, d]) => ({ service, jobsCompleted: d.count }))
        .sort((a, b) => b.jobsCompleted - a.jobsCompleted)
    }

    case 'get_monthly_revenue_trend': {
      const months = Number(args.months ?? 6)
      const trend = []

      for (let i = months - 1; i >= 0; i--) {
        const d     = new Date()
        d.setMonth(d.getMonth() - i)
        const ym    = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const start = `${ym}-01`
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)

        const [leadsRes, subsRes] = await Promise.all([
          supabase.from('leads').select('estimated_value')
            .eq('stage', 'finished_paid').gte('created_at', start).lte('created_at', end),
          supabase.from('subscriptions').select('in_season_monthly_total').eq('status', 'ACTIVE'),
        ])

        const jobRevenue = (leadsRes.data ?? []).reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)
        const mrr        = (subsRes.data  ?? []).reduce((s, r) => s + Number(r.in_season_monthly_total), 0)

        trend.push({ month: ym, jobRevenue, mrr, total: jobRevenue + mrr })
      }

      return trend
    }

    case 'get_quote_analytics': {
      const { data: quotes } = await supabase
        .from('quotes').select('id, total, status, created_at, sent_at, signed_at')
        .is('trashed_at', null).in('status', ['sent', 'accepted', 'declined'])

      const sent     = (quotes ?? []).filter(q => q.status === 'sent'     || q.status === 'accepted')
      const accepted = (quotes ?? []).filter(q => q.status === 'accepted')
      const declined = (quotes ?? []).filter(q => q.status === 'declined')

      const acceptanceRate = sent.length > 0 ? (accepted.length / sent.length) * 100 : null
      const avgValue       = accepted.length > 0
        ? accepted.reduce((s, q) => s + Number(q.total), 0) / accepted.length : null
      const avgDaysToSign  = accepted.filter(q => q.sent_at && q.signed_at).map(q => {
        const diff = new Date(q.signed_at).getTime() - new Date(q.sent_at).getTime()
        return diff / 86400000
      })
      const avgDays = avgDaysToSign.length > 0
        ? avgDaysToSign.reduce((a, b) => a + b, 0) / avgDaysToSign.length : null

      const { data: openQuotes } = await supabase
        .from('quotes').select('total').in('status', ['draft', 'sent']).is('trashed_at', null)
      const pipelineValue = (openQuotes ?? []).reduce((s, q) => s + Number(q.total), 0)

      return {
        totalSent: sent.length, totalAccepted: accepted.length, totalDeclined: declined.length,
        acceptanceRate, avgAcceptedValue: avgValue, avgDaysToSign: avgDays, pipelineValue,
      }
    }

    // ── Session 3: Proactive intelligence ──────────────────────────────────────

    case 'get_daily_briefing': {
      const today        = new Date().toISOString().slice(0, 10)
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
      const fiveDaysAgo  = new Date(Date.now() - 5 * 86400000).toISOString()
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

      const [todayJobs, staleNew, staleFollowUp, unsignedQuotes, overdueJobs] = await Promise.all([
        // Jobs scheduled today
        supabase.from('jobs')
          .select('id, service_name, status, scheduled_window, customer_name, customer_address, customer_phone, property_info')
          .eq('scheduled_date', today).neq('status', 'cancelled').order('scheduled_window'),
        // Leads stuck in 'new' for 7+ days
        supabase.from('leads')
          .select('id, stage, service_interest, created_at, contact_id')
          .eq('stage', 'new').lt('created_at', sevenDaysAgo).limit(10),
        // Leads stuck in 'follow_up' for 5+ days
        supabase.from('leads')
          .select('id, stage, service_interest, created_at, contact_id')
          .eq('stage', 'follow_up').lt('created_at', fiveDaysAgo).limit(10),
        // Quotes sent 3+ days ago, not yet signed
        supabase.from('quotes')
          .select('id, customer_name, total, sent_at, status')
          .eq('status', 'sent').lt('sent_at', threeDaysAgo).is('signed_at', null).is('trashed_at', null).limit(10),
        // Jobs still 'scheduled' past their date
        supabase.from('jobs')
          .select('id, service_name, scheduled_date, customer_name, customer_address')
          .eq('status', 'scheduled').lt('scheduled_date', today).limit(10),
      ])

      return {
        date: today,
        todayJobs:       todayJobs.data      ?? [],
        staleNewLeads:   staleNew.data       ?? [],
        staleFollowUps:  staleFollowUp.data  ?? [],
        unsignedQuotes:  unsignedQuotes.data ?? [],
        overdueJobs:     overdueJobs.data    ?? [],
      }
    }

    case 'audit_pipeline': {
      const today        = new Date().toISOString().slice(0, 10)
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

      const [noContact, noSource, staleNew, staleFollowUp, quotedNoQuote,
             unsignedQuotes, unscheduledJobs, overdueJobs] = await Promise.all([
        // Leads with no contact linked
        supabase.from('leads').select('id, stage, service_interest, created_at')
          .is('contact_id', null).not('stage', 'in', '("lost","finished_paid","finished_unpaid")').limit(20),
        // Leads with no source attribution
        supabase.from('leads').select('id, stage, service_interest, created_at, contact_id')
          .is('source', null).is('campaign_id', null)
          .not('stage', 'in', '("lost","finished_paid","finished_unpaid")').limit(20),
        // Stale new leads (7+ days, never contacted)
        supabase.from('leads').select('id, service_interest, created_at, contact_id')
          .eq('stage', 'new').lt('created_at', sevenDaysAgo).limit(15),
        // Stale follow-up leads (7+ days)
        supabase.from('leads').select('id, service_interest, created_at, contact_id')
          .eq('stage', 'follow_up').lt('created_at', sevenDaysAgo).limit(15),
        // Leads in 'quoted' stage with no quote_id
        supabase.from('leads').select('id, service_interest, created_at, contact_id')
          .eq('stage', 'quoted').is('quote_id', null).limit(15),
        // Quotes sent 3+ days ago, unsigned
        supabase.from('quotes').select('id, customer_name, total, sent_at')
          .eq('status', 'sent').lt('sent_at', threeDaysAgo).is('signed_at', null).is('trashed_at', null).limit(15),
        // Jobs with no scheduled date
        supabase.from('jobs').select('id, service_name, customer_name, created_at')
          .eq('status', 'scheduled').is('scheduled_date', null).limit(15),
        // Jobs past their scheduled date, still open
        supabase.from('jobs').select('id, service_name, scheduled_date, customer_name')
          .eq('status', 'scheduled').lt('scheduled_date', today).limit(15),
      ])

      return {
        leadsWithNoContact:    noContact.data      ?? [],
        leadsWithNoSource:     noSource.data       ?? [],
        staleNewLeads:         staleNew.data       ?? [],
        staleFollowUpLeads:    staleFollowUp.data  ?? [],
        quotedLeadsNoQuote:    quotedNoQuote.data  ?? [],
        unsignedQuotes:        unsignedQuotes.data ?? [],
        unscheduledJobs:       unscheduledJobs.data ?? [],
        overdueJobs:           overdueJobs.data    ?? [],
      }
    }

    case 'find_upsell_opportunities': {
      // Get contact_ids with active subscriptions
      const { data: activeSubs } = await supabase
        .from('subscriptions').select('contact_id').eq('status', 'ACTIVE')
      const activeSubContactIds = new Set((activeSubs ?? []).map(s => s.contact_id).filter(Boolean))

      // Get contacts who have a finished_paid lead (i.e., completed paying customers)
      const { data: closedLeads } = await supabase
        .from('leads').select('contact_id, service_interest, created_at')
        .eq('stage', 'finished_paid').not('contact_id', 'is', null).limit(100)

      // Filter out those who already have an active subscription
      const opportunities = (closedLeads ?? []).filter(l => !activeSubContactIds.has(l.contact_id))

      // Deduplicate by contact_id
      const seen = new Set<string>()
      const unique = opportunities.filter(l => {
        if (seen.has(l.contact_id)) return false
        seen.add(l.contact_id); return true
      })

      // Fetch contact names for the results
      const contactIds = unique.slice(0, 20).map(l => l.contact_id)
      const { data: contacts } = await supabase
        .from('contacts').select('id, name, phone').in('id', contactIds)
      const contactMap = Object.fromEntries((contacts ?? []).map(c => [c.id, c]))

      return unique.slice(0, 20).map(l => ({
        contactId:       l.contact_id,
        contactName:     contactMap[l.contact_id]?.name ?? 'Unknown',
        contactPhone:    contactMap[l.contact_id]?.phone ?? null,
        lastService:     l.service_interest,
        lastJobDate:     l.created_at,
      }))
    }

    case 'get_revenue_forecast': {
      const now   = new Date()
      const year  = now.getFullYear()
      const month = now.getMonth() + 1
      const monthStr   = `${year}-${String(month).padStart(2, '0')}`
      const monthStart = `${monthStr}-01`
      const today      = now.toISOString().slice(0, 10)
      // Last day of current month
      const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10)

      const [subsRes, completedLeads, scheduledJobs] = await Promise.all([
        // Active subscription MRR
        supabase.from('subscriptions').select('in_season_monthly_total').eq('status', 'ACTIVE'),
        // Leads closed (finished_paid) this month — use estimated_value or linked quote
        supabase.from('leads').select('id, estimated_value, quote_id')
          .eq('stage', 'finished_paid').gte('created_at', monthStart).lte('created_at', today),
        // Scheduled jobs remaining this month (not yet completed)
        supabase.from('jobs').select('id, quote_id')
          .eq('status', 'scheduled').gte('scheduled_date', today).lte('scheduled_date', monthEnd),
      ])

      const mrr = (subsRes.data ?? []).reduce((s, r) => s + Number(r.in_season_monthly_total), 0)

      // Fetch quote totals for closed leads
      const closedQuoteIds = (completedLeads.data ?? []).map(l => l.quote_id).filter(Boolean)
      const { data: closedQuotes } = closedQuoteIds.length > 0
        ? await supabase.from('quotes').select('id, total').in('id', closedQuoteIds)
        : { data: [] }
      const closedQuoteMap = Object.fromEntries((closedQuotes ?? []).map(q => [q.id, Number(q.total)]))
      const completedRevenue = (completedLeads.data ?? []).reduce((s, l) =>
        s + (l.quote_id ? (closedQuoteMap[l.quote_id] ?? 0) : (l.estimated_value ?? 0)), 0)

      // Fetch quote totals for scheduled jobs
      const scheduledQuoteIds = (scheduledJobs.data ?? []).map(j => j.quote_id).filter(Boolean)
      const { data: scheduledQuotes } = scheduledQuoteIds.length > 0
        ? await supabase.from('quotes').select('id, total').in('id', scheduledQuoteIds)
        : { data: [] }
      const projectedRevenue = (scheduledQuotes ?? []).reduce((s, q) => s + Number(q.total), 0)

      return {
        month: monthStr,
        mrr,
        completedRevenue,
        projectedRevenue,
        totalForecast: mrr + completedRevenue + projectedRevenue,
        completedJobCount:  (completedLeads.data  ?? []).length,
        scheduledJobCount:  (scheduledJobs.data   ?? []).length,
      }
    }

    case 'get_churn_risks': {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString()

      const [pausedSubs, finishedUnpaid] = await Promise.all([
        // Paused subscriptions — already at risk
        supabase.from('subscriptions')
          .select('id, customer_name, customer_phone, in_season_monthly_total, pause_until, contact_id')
          .eq('status', 'PAUSED').limit(20),
        // Leads stuck in finished_unpaid (job done, not paid — revenue at risk)
        supabase.from('leads')
          .select('id, contact_id, service_interest, estimated_value, created_at')
          .eq('stage', 'finished_unpaid').limit(20),
      ])

      // Contacts with no job completed in 60+ days (from jobs table)
      const { data: recentJobs } = await supabase
        .from('jobs').select('contact_id')
        .eq('status', 'completed').gte('completed_at', sixtyDaysAgo)
      const recentContactIds = new Set((recentJobs ?? []).map(j => j.contact_id).filter(Boolean))

      // Active subs whose contact has no recent job
      const { data: activeSubs } = await supabase
        .from('subscriptions').select('id, customer_name, customer_phone, contact_id, in_season_monthly_total')
        .eq('status', 'ACTIVE').not('contact_id', 'is', null)
      const inactiveActiveSubs = (activeSubs ?? []).filter(s => !recentContactIds.has(s.contact_id))

      return {
        pausedSubscriptions:      pausedSubs.data    ?? [],
        finishedUnpaidLeads:      finishedUnpaid.data ?? [],
        activeSubsNoRecentJob:    inactiveActiveSubs.slice(0, 20),
      }
    }

    // ── Phase 4: Weekly comparison ─────────────────────────────────────────────

    case 'get_weekly_comparison': {
      const now     = Date.now()
      const thisEnd   = new Date(now).toISOString().slice(0, 10)
      const thisStart = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
      const lastEnd   = thisStart
      const lastStart = new Date(now - 14 * 86400000).toISOString().slice(0, 10)

      async function weekSlice(start: string, end: string) {
        const [leadsRes, closedRes, quotesRes] = await Promise.all([
          supabase.from('leads').select('source, stage').gte('created_at', `${start}T00:00:00`).lt('created_at', `${end}T23:59:59`),
          supabase.from('leads').select('estimated_value').in('stage', ['finished_paid', 'finished_unpaid']).gte('created_at', `${start}T00:00:00`).lt('created_at', `${end}T23:59:59`),
          supabase.from('quotes').select('status, total').gte('created_at', `${start}T00:00:00`).lt('created_at', `${end}T23:59:59`).is('trashed_at', null),
        ])
        const leads  = leadsRes.data  ?? []
        const closed = closedRes.data ?? []
        const quotes = quotesRes.data ?? []
        const bySource: Record<string, number> = {}
        for (const l of leads) { const s = l.source ?? 'Unattributed'; bySource[s] = (bySource[s] ?? 0) + 1 }
        const sent = quotes.filter(q => q.status === 'sent' || q.status === 'accepted')
        const acc  = quotes.filter(q => q.status === 'accepted')
        return {
          newLeads:       leads.length,
          leadsBySource:  bySource,
          closedJobs:     closed.length,
          closedRevenue:  closed.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0),
          quotesSent:     sent.length,
          quotesAccepted: acc.length,
          acceptanceRate: sent.length > 0 ? Math.round((acc.length / sent.length) * 100) : null,
        }
      }

      const [thisWeek, lastWeek] = await Promise.all([weekSlice(thisStart, thisEnd), weekSlice(lastStart, lastEnd)])
      const { data: subs } = await supabase.from('subscriptions').select('status, in_season_monthly_total')
      const active = (subs ?? []).filter(s => s.status === 'ACTIVE')
      const mrr    = active.reduce((s, r) => s + Number(r.in_season_monthly_total), 0)

      return {
        thisWeek:  { period: `${thisStart} → ${thisEnd}`,   ...thisWeek },
        lastWeek:  { period: `${lastStart} → ${lastEnd}`, ...lastWeek },
        mrr,
        note: 'Use this data to identify patterns. Ask Knox to explain what it means.',
      }
    }

    // ── Owner direct channel ───────────────────────────────────────────────────

    case 'notify_owner': {
      const msg = String(args.message ?? '').trim()
      if (!msg) return { error: 'message is required' }
      const { data: settings } = await supabase
        .from('company_settings')
        .select('quo_api_key, quo_from_number')
        .limit(1).single()
      const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY     ?? ''
      const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
      if (!apiKey || !fromNumber) return { error: 'OpenPhone not configured in settings' }
      await sendOpenPhoneSms(apiKey, fromNumber, OWNER_PHONE, msg)
      return { success: true, sent: true, to: 'owner' }
    }

    // ── Memory tools ───────────────────────────────────────────────────────────

    case 'remember_fact': {
      const key   = String(args.key   ?? '').trim()
      const value = String(args.value ?? '').trim()
      if (!key) return { error: 'key is required' }
      const { error } = await supabase
        .from('knox_memory')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
      return { success: true, remembered: { key, value } }
    }

    case 'recall_memory': {
      const { data } = await supabase
        .from('knox_memory')
        .select('key, value, updated_at')
        .order('updated_at', { ascending: false })
      return data ?? []
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { messages, context } = JSON.parse(event.body ?? '{}')

    if (!Array.isArray(messages)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'messages array required' }) }
    }

    // ── Load persistent memory ────────────────────────────────────────────────
    const { data: memoryRows } = await supabase
      .from('knox_memory')
      .select('key, value')
      .order('updated_at', { ascending: false })
    const memory = memoryRows ?? []

    // ── Build system prompt + convert messages ────────────────────────────────
    const systemPrompt = buildSystemPrompt(context, memory)
    const history: Anthropic.MessageParam[] = toAnthropicMessages(messages)

    let finalResponse = ''
    const toolsUsed: string[]    = []
    const actionsTaken: object[] = []
    const MAX_ROUNDS = 6

    // ── Agentic loop ──────────────────────────────────────────────────────────
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   history,
        tools:      anthropicTools,
        // @ts-expect-error — temperature accepted at runtime
        temperature: 0.3,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks = response.content.filter((c: any) => c.type === 'tool_use') as any[]

      // No tool calls → final answer
      if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBlock = response.content.find((c: any) => c.type === 'text') as any
        finalResponse = textBlock?.text ?? ''
        break
      }

      // Add assistant message (with tool_use blocks) to history
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history.push({ role: 'assistant', content: response.content as any })

      // Execute tools, collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tc of toolUseBlocks) {
        toolsUsed.push(tc.name)
        const result = await executeTool(tc.name, tc.input as Record<string, unknown>)
        if (WRITE_TOOLS.has(tc.name)) actionsTaken.push({ tool: tc.name, args: tc.input, result })
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(result) })
      }

      // Add tool results as user message
      history.push({ role: 'user', content: toolResults })
    }

    if (!finalResponse) {
      finalResponse = "I ran into trouble getting an answer. Try rephrasing the question."
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    if (actionsTaken.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userMessage = messages.filter((m: any) => m.role === 'user').pop()
      supabase.from('knox_log').insert({
        trigger_type:  'chat',
        user_message:  typeof userMessage?.content === 'string' ? userMessage.content : null,
        knox_response: finalResponse,
        tools_called:  toolsUsed,
        actions_taken: actionsTaken,
      }).then(() => {}).catch(() => {})
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ response: finalResponse, toolsUsed }),
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: `Something went wrong: ${message}` }),
    }
  }
}
