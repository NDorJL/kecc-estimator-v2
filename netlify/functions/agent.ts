/**
 * Knox — KECC AI Agent
 *
 * Runs an agentic tool-use loop against a self-hosted Ollama instance.
 * The Ollama instance is exposed to Netlify via a Cloudflare Tunnel.
 *
 * Required env vars (set in Netlify dashboard):
 *   OLLAMA_BASE_URL  — Cloudflare Tunnel URL, e.g. https://abc123.trycloudflare.com
 *   OLLAMA_MODEL     — model name, e.g. llama3.1:8b  (default: llama3.1:8b)
 *
 * Setup on your always-on machine:
 *   1. Install Ollama:       brew install ollama
 *   2. Pull model:           ollama pull llama3.1:8b
 *   3. Start Ollama:         ollama serve
 *   4. Install cloudflared:  brew install cloudflare/cloudflare/cloudflared
 *   5. Create a tunnel:      cloudflared tunnel --url http://localhost:11434
 *      (copy the *.trycloudflare.com URL → OLLAMA_BASE_URL in Netlify)
 *
 * For a persistent tunnel URL, use a named Cloudflare Tunnel instead of the
 * quick tunnel above (the quick tunnel URL changes on restart).
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL ?? 'llama3.1:8b'

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ── Tool definitions (OpenAI-compatible format, supported by Ollama) ─────────

const tools = [
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
]

// ── Tool execution (all queries run server-side with the service key) ─────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
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

    // ── System prompt ────────────────────────────────────────────────────────
    const now = new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })

    const systemPrompt = `You are Knox, the AI assistant built into the Knox Exterior Care Co. (KECC) CRM. You help the entire team — owner, office staff, and field crew — get things done quickly.

You have tools to look up real data from the CRM: contacts, leads, jobs, quotes, and subscriptions. Always call the right tool to retrieve actual data rather than guessing. If a question requires multiple tool calls, make them all before answering.

Keep responses short and direct. This is a chat widget used in the field and in the office — no long essays. Use plain language. Bullet points for lists.

Business: Knox Exterior Care Co. (KECC) — lawn care, landscaping, and exterior property maintenance in the Knoxville, TN area. Residential and commercial customers.

Current date/time: ${now}
Current CRM page: ${context?.page ?? 'unknown'}${context?.recordLabel ? `\nCurrently viewing: ${context.recordLabel}` : ''}

When someone asks about gate codes, access notes, dog warnings, or property-specific info — use get_contact_details or search_contacts and read the custom_fields and notes. That data lives there.`

    // ── Agentic loop ─────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: any[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalResponse: any = null
    const MAX_ROUNDS = 6  // prevent infinite loops

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    OLLAMA_MODEL,
          messages: history,
          tools,
          stream:   false,
          options: {
            temperature: 0.3,  // lower = more factual, less creative
          },
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Ollama returned ${res.status}: ${errText}`)
      }

      const data = await res.json()
      const choice = data.choices?.[0]
      const msg    = choice?.message

      if (!msg) throw new Error('Ollama returned no message')

      history.push(msg)

      // No tool calls → this is the final answer
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalResponse = msg.content
        break
      }

      // Execute all tool calls in this round, collect results
      for (const tc of msg.tool_calls) {
        const argsParsed = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function.arguments ?? {})

        const result = await executeTool(tc.function.name, argsParsed)

        history.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        })
      }
    }

    if (!finalResponse) {
      finalResponse = "I ran into trouble getting an answer. Try rephrasing the question."
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ response: finalResponse }),
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    // Surface a friendly error if Ollama isn't reachable
    const isCxError = message.includes('ECONNREFUSED') || message.includes('fetch failed') || message.includes('ENOTFOUND')
    const friendlyMessage = isCxError
      ? "Knox is offline — the Ollama instance isn't reachable right now. Check that Ollama is running and the Cloudflare Tunnel is active."
      : `Something went wrong: ${message}`

    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: friendlyMessage }),
    }
  }
}
