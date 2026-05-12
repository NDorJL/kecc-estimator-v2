/**
 * agent-stream.ts — Knox AI streaming endpoint (Netlify Functions v2)
 *
 * Emits Server-Sent Events (SSE):
 *   event: status   data: {"text":"Looking up leads..."}   ← during tool calls
 *   event: token    data: {"text":"You have "}             ← streaming final response
 *   event: done     data: {"toolsUsed":["get_leads"]}      ← end of stream
 *   event: error    data: {"message":"..."}                ← on failure
 *
 * Imports tools, executeTool, supabase, and WRITE_TOOLS from agent.ts.
 * Files starting with _ are excluded from Netlify function registration;
 * agent.ts is registered separately as the non-streaming fallback.
 */
import { createClient } from '@supabase/supabase-js'
import { tools, executeTool, WRITE_TOOLS } from './agent'

const OLLAMA_BASE_URL     = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const OLLAMA_MODEL        = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b'
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? null

const supabaseStream = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Netlify Functions v2 — export default async function
export default async function handler(req: Request): Promise<Response> {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS })
  }

  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async start(controller) {
      function send(event: string, data: object) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const { messages, context } = await req.json()

        if (!Array.isArray(messages)) {
          send('error', { message: 'messages array required' })
          controller.close()
          return
        }

        // ── Detect multimodal ──────────────────────────────────────────────────
        const hasImages = messages.some((m: { content: unknown }) =>
          Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'image_url')
        )
        const activeModel = hasImages && OLLAMA_VISION_MODEL ? OLLAMA_VISION_MODEL : OLLAMA_MODEL

        // ── Load persistent memory ─────────────────────────────────────────────
        const { data: memoryRows } = await supabaseStream
          .from('knox_memory').select('key, value').order('updated_at', { ascending: false })
        const memory = memoryRows ?? []

        // ── System prompt ──────────────────────────────────────────────────────
        const now = new Date().toLocaleString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        })

        // Import system prompt from agent.ts is complex due to its size;
        // We inline the minimal version here — identity + rules + memory injection.
        // The full knowledge base is embedded in agent.ts's systemPrompt template.
        // For parity, we duplicate just the core structure.
        const systemPrompt = [
          `You are Knox — the AI assistant built specifically for Knox Exterior Care Co. (KECC). Direct, confident, field-savvy. Not a generic assistant.`,
          `You have tools to look up real data. Always call the right tool. Keep responses short and direct — chat widget used in the field and office.`,
          `WRITE TOOL RULES: Always confirm before executing write actions. queue_sms never sends directly — goes to approval panel.`,
          `Current date/time: ${now}`,
          `Current CRM page: ${context?.page ?? 'unknown'}${context?.recordLabel ? `\nCurrently viewing: ${context.recordLabel}` : ''}`,
          memory.length > 0
            ? `\nKNOX MEMORY:\n${memory.map((m: { key: string; value: string }) => `- ${m.key}: ${m.value}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n')

        // ── Agentic tool loop ──────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const history: any[] = [
          { role: 'system', content: systemPrompt },
          ...messages,
        ]

        const toolsUsed: string[]    = []
        const actionsTaken: object[] = []
        const MAX_ROUNDS = 6

        for (let round = 0; round < MAX_ROUNDS; round++) {
          // Non-streaming tool-call round
          const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model:    activeModel,
              messages: history,
              tools,
              stream:   false,
              options:  { temperature: 0.3 },
            }),
          })

          if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)

          const data   = await res.json()
          const msg    = data.choices?.[0]?.message
          if (!msg) throw new Error('Ollama returned no message')

          history.push(msg)

          // No tool calls → stream the final response
          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            // Stream the final response
            const streamRes = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model:    activeModel,
                messages: history,
                stream:   true,
                options:  { temperature: 0.3 },
              }),
            })

            if (!streamRes.ok || !streamRes.body) {
              // Fallback: use the already-computed response
              send('token', { text: msg.content ?? '' })
            } else {
              const reader  = streamRes.body.getReader()
              const decoder = new TextDecoder()
              let streamBuf = ''
              let fullText  = ''

              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                streamBuf += decoder.decode(value, { stream: true })
                const lines = streamBuf.split('\n')
                streamBuf = lines.pop() ?? ''

                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue
                  const raw = line.slice(6).trim()
                  if (raw === '[DONE]') continue
                  try {
                    const chunk = JSON.parse(raw)
                    const token = chunk.choices?.[0]?.delta?.content
                    if (token) {
                      fullText += token
                      send('token', { text: token })
                    }
                  } catch { /* ignore malformed chunks */ }
                }
              }

              // Audit log for write actions
              if (actionsTaken.length > 0) {
                const userMsg = messages.filter((m: { role: string }) => m.role === 'user').pop()
                supabaseStream.from('knox_log').insert({
                  trigger_type:  'chat',
                  user_message:  typeof userMsg?.content === 'string' ? userMsg.content : null,
                  knox_response: fullText,
                  tools_called:  toolsUsed,
                  actions_taken: actionsTaken,
                }).then(() => {}).catch(() => {})
              }
            }

            send('done', { toolsUsed })
            break
          }

          // Execute tool calls and send status events
          for (const tc of msg.tool_calls) {
            const toolName  = tc.function.name
            const argsParsed = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc.function.arguments ?? {})

            // Send status to frontend
            const friendlyName: Record<string, string> = {
              search_contacts:           'Searching contacts…',
              get_contact_details:       'Looking up contact details…',
              get_leads:                 'Checking the lead pipeline…',
              get_jobs_today:            'Pulling today\'s schedule…',
              get_jobs:                  'Looking up jobs…',
              get_quotes:                'Checking quotes…',
              get_subscriptions:         'Loading subscriptions…',
              get_dashboard_stats:       'Pulling business stats…',
              get_upcoming_jobs:         'Checking upcoming jobs…',
              find_job:                  'Finding that job…',
              get_customer_history:      'Loading customer history…',
              get_daily_briefing:        'Compiling your daily briefing…',
              audit_pipeline:            'Auditing the pipeline…',
              find_upsell_opportunities: 'Finding upsell opportunities…',
              get_revenue_forecast:      'Calculating revenue forecast…',
              get_churn_risks:           'Checking for churn risks…',
              get_marketing_analytics:   'Analyzing marketing performance…',
              get_top_customers:         'Ranking top customers…',
              get_service_analytics:     'Breaking down services…',
              get_monthly_revenue_trend: 'Computing revenue trend…',
              get_quote_analytics:       'Analyzing quote performance…',
              get_price_book:            'Loading price book…',
              preview_review_requests:   'Checking review requests…',
              batch_queue_review_requests: 'Queuing review requests…',
              get_untouched_leads:       'Finding untouched leads…',
              generate_marketing_report: 'Generating marketing report…',
              create_contact:            'Creating contact…',
              create_lead:               'Creating lead…',
              update_lead_stage:         'Moving lead stage…',
              add_note:                  'Adding note…',
              queue_sms:                 'Queuing message…',
              complete_job:              'Completing job…',
              schedule_job:              'Scheduling job…',
              remember_fact:             'Saving to memory…',
              recall_memory:             'Recalling memory…',
            }
            send('status', { text: friendlyName[toolName] ?? `Running ${toolName}…` })

            toolsUsed.push(toolName)
            const result = await executeTool(toolName, argsParsed)

            if (WRITE_TOOLS.has(toolName)) {
              actionsTaken.push({ tool: toolName, args: argsParsed, result })
            }

            history.push({
              role:         'tool',
              tool_call_id: tc.id,
              content:      JSON.stringify(result),
            })
          }
        }

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const isCx    = message.includes('ECONNREFUSED') || message.includes('fetch failed') || message.includes('ENOTFOUND')
        send('error', {
          message: isCx
            ? "Knox is offline — check that Ollama is running and the tunnel is active."
            : `Something went wrong: ${message}`,
        })
      }

      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
