/**
 * agent-stream.ts — Knox AI streaming endpoint (Netlify Functions v2)
 *
 * Emits Server-Sent Events (SSE):
 *   event: status   data: {"text":"Looking up leads..."}   ← during tool calls
 *   event: token    data: {"text":"You have "}             ← streaming final response
 *   event: done     data: {"toolsUsed":["get_leads"]}      ← end of stream
 *   event: error    data: {"message":"..."}                ← on failure
 *
 * Imports anthropicTools, executeTool, WRITE_TOOLS, buildSystemPrompt, and
 * toAnthropicMessages from agent.ts.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { anthropicTools, executeTool, WRITE_TOOLS, buildSystemPrompt, toAnthropicMessages } from './agent'

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5'

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

        // ── Load persistent memory ─────────────────────────────────────────────
        const { data: memoryRows } = await supabaseStream
          .from('knox_memory').select('key, value').order('updated_at', { ascending: false })
        const memory = memoryRows ?? []

        // ── Build system prompt + convert messages ─────────────────────────────
        const systemPrompt = buildSystemPrompt(context, memory)
        const history: Anthropic.MessageParam[] = toAnthropicMessages(messages)

        const toolsUsed: string[]    = []
        const actionsTaken: object[] = []
        const MAX_ROUNDS = 6

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

        // ── Agentic tool loop (non-streaming rounds) ───────────────────────────
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

          // No tool calls → stream the final response
          if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
            // Stream final answer using Anthropic streaming
            const streamRes = await anthropic.messages.create({
              model:      CLAUDE_MODEL,
              max_tokens: 4096,
              system:     systemPrompt,
              messages:   history,
              // @ts-expect-error — temperature accepted at runtime
              temperature: 0.3,
              stream:     true,
            }) as unknown as AsyncIterable<Anthropic.MessageStreamEvent>

            let fullText = ''
            for await (const chunk of streamRes) {
              if (
                chunk.type === 'content_block_delta' &&
                chunk.delta.type === 'text_delta'
              ) {
                fullText += chunk.delta.text
                send('token', { text: chunk.delta.text })
              }
            }

            // Audit log for write actions (fire-and-forget)
            if (actionsTaken.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const userMsg = messages.filter((m: any) => m.role === 'user').pop()
              supabaseStream.from('knox_log').insert({
                trigger_type:  'chat',
                user_message:  typeof userMsg?.content === 'string' ? userMsg.content : null,
                knox_response: fullText,
                tools_called:  toolsUsed,
                actions_taken: actionsTaken,
              }).then(() => {}).catch(() => {})
            }

            send('done', { toolsUsed })
            break
          }

          // Add assistant message to history
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          history.push({ role: 'assistant', content: response.content as any })

          // Execute tool calls and send status events
          const friendlyName: Record<string, string> = {
            search_contacts:             'Searching contacts…',
            get_contact_details:         'Looking up contact details…',
            get_leads:                   'Checking the lead pipeline…',
            get_jobs_today:              'Pulling today\'s schedule…',
            get_jobs:                    'Looking up jobs…',
            get_quotes:                  'Checking quotes…',
            get_subscriptions:           'Loading subscriptions…',
            get_dashboard_stats:         'Pulling business stats…',
            get_upcoming_jobs:           'Checking upcoming jobs…',
            find_job:                    'Finding that job…',
            get_customer_history:        'Loading customer history…',
            get_daily_briefing:          'Compiling your daily briefing…',
            audit_pipeline:              'Auditing the pipeline…',
            find_upsell_opportunities:   'Finding upsell opportunities…',
            get_revenue_forecast:        'Calculating revenue forecast…',
            get_churn_risks:             'Checking for churn risks…',
            get_marketing_analytics:     'Analyzing marketing performance…',
            get_top_customers:           'Ranking top customers…',
            get_service_analytics:       'Breaking down services…',
            get_monthly_revenue_trend:   'Computing revenue trend…',
            get_quote_analytics:         'Analyzing quote performance…',
            get_price_book:              'Loading price book…',
            preview_review_requests:     'Checking review requests…',
            batch_queue_review_requests: 'Queuing review requests…',
            get_untouched_leads:         'Finding untouched leads…',
            generate_marketing_report:   'Generating marketing report…',
            get_weekly_comparison:       'Comparing this week vs last week…',
            draft_reengagement_message:  'Drafting re-engagement message…',
            create_contact:              'Creating contact…',
            create_lead:                 'Creating lead…',
            update_lead_stage:           'Moving lead stage…',
            add_note:                    'Adding note…',
            queue_sms:                   'Queuing message…',
            complete_job:                'Completing job…',
            schedule_job:                'Scheduling job…',
            notify_owner:                'Notifying owner…',
            remember_fact:               'Saving to memory…',
            recall_memory:               'Recalling memory…',
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const tc of toolUseBlocks) {
            send('status', { text: friendlyName[tc.name] ?? `Running ${tc.name}…` })
            toolsUsed.push(tc.name)

            const result = await executeTool(tc.name, tc.input as Record<string, unknown>)
            if (WRITE_TOOLS.has(tc.name)) actionsTaken.push({ tool: tc.name, args: tc.input, result })

            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(result) })
          }

          history.push({ role: 'user', content: toolResults })
        }

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        send('error', { message: `Something went wrong: ${message}` })
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
