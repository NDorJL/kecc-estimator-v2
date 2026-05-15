/**
 * sms-queue.ts — Pending SMS queue management
 *
 * GET  /sms-queue          — list all pending items (joined with contacts for name)
 * PATCH /sms-queue/:id     — approve or dismiss a queued message
 * POST  /sms-queue/:id/send — send an already-approved message via OpenPhone
 *
 * No SMS fires without explicit approval. This is the only path to sending.
 */

import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { sendOpenPhoneSms } from './_smsHelper'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Parse path: /sms-queue, /sms-queue/:id, /sms-queue/:id/send
  const rawPath = event.path.replace(/\/.netlify\/functions\/sms-queue\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id        = parts[0] ?? null
  const subaction = parts[1] ?? null   // 'send' for POST /:id/send
  const method    = event.httpMethod

  try {
    // ── GET /sms-queue — list pending items ──────────────────────────────────
    if (method === 'GET' && !id) {
      const { data, error } = await supabase
        .from('sms_queue')
        .select(`
          *,
          contacts ( name )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)

      // Flatten contact name into top-level field for convenient consumption
      const rows = (data ?? []).map((r: any) => ({
        ...r,
        recipient_name: r.contacts?.name ?? null,
        contacts: undefined,
      }))

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) }
    }

    // ── PATCH /sms-queue/:id — approve or dismiss ────────────────────────────
    if (method === 'PATCH' && id && !subaction) {
      const body = JSON.parse(event.body ?? '{}')
      const { status } = body as { status: string }

      if (status !== 'approved' && status !== 'dismissed') {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ message: "status must be 'approved' or 'dismissed'" }),
        }
      }

      const update: Record<string, unknown> = { status }
      if (status === 'approved') update.approved_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('sms_queue')
        .update(update)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }
    }

    // ── POST /sms-queue/:id/send — send an approved message ─────────────────
    if (method === 'POST' && id && subaction === 'send') {
      // Fetch the queue record
      const { data: record, error: fetchErr } = await supabase
        .from('sms_queue')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchErr || !record) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Record not found' }) }
      }
      if (record.status !== 'approved') {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ message: `Cannot send — status is '${record.status}', must be 'approved'` }),
        }
      }

      // Fetch SMS credentials from settings (same pattern as send-reminders.ts)
      const { data: settings } = await supabase
        .from('company_settings')
        .select('quo_api_key, quo_from_number')
        .limit(1)
        .single()

      const apiKey     = settings?.quo_api_key    ?? process.env.QUO_API_KEY    ?? ''
      const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''

      if (!apiKey || !fromNumber) {
        return { statusCode: 503, headers: CORS, body: JSON.stringify({ message: 'OpenPhone credentials not configured' }) }
      }

      // ✉️  This is the only place an SMS actually fires — after explicit approval
      await sendOpenPhoneSms(apiKey, fromNumber, record.to_phone, record.message)

      const now = new Date().toISOString()
      const { data: updated, error: updateErr } = await supabase
        .from('sms_queue')
        .update({ status: 'sent', sent_at: now })
        .eq('id', id)
        .select()
        .single()

      if (updateErr) throw updateErr
      return { statusCode: 200, headers: CORS, body: JSON.stringify(updated) }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sms-queue]', message)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message }) }
  }
}
