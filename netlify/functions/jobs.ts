import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToJob } from '../../src/types'
import { syncJobToGoogle, deleteGoogleEvent } from './_google'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const rawPath = event.path.replace(/\/.netlify\/functions\/jobs\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod

  try {
    // LIST
    if (method === 'GET' && !id) {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('scheduled_date', { ascending: true, nullsFirst: false })
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToJob)) }
    }

    // GET single
    if (method === 'GET' && id) {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Job not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToJob(data)) }
    }

    // CREATE
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const insert: Record<string, unknown> = {
        job_type:         body.jobType ?? 'one_time',
        service_name:     body.serviceName ?? '',
        status:           body.status ?? 'scheduled',
        scheduled_date:   body.scheduledDate ?? null,
        scheduled_time:   body.scheduledTime ?? null,
        scheduled_window: body.scheduledWindow ?? null,
        customer_name:    body.customerName ?? null,
        customer_address: body.customerAddress ?? null,
        customer_phone:   body.customerPhone ?? null,
        customer_email:   body.customerEmail ?? null,
        notes:            body.notes ?? null,
        internal_notes:   body.internalNotes ?? null,
        property_info:    body.propertyInfo ?? {},
      }
      // Optional FK columns — only set if provided to avoid FK violation on null values
      // (all are ON DELETE SET NULL so null is fine)
      insert.contact_id      = body.contactId ?? null
      insert.subscription_id = body.subscriptionId ?? null
      insert.quote_id        = body.quoteId ?? null
      insert.contractor_id   = body.contractorId ?? null

      const { data, error } = await supabase.from('jobs').insert(insert).select().single()
      if (error) throw new Error(error.message)
      const job = rowToJob(data)
      // Fire-and-forget Google Calendar sync — do not await, don't block response
      syncJobToGoogle({ ...job, googleEventId: null }).catch(() => {})
      return { statusCode: 201, headers: CORS, body: JSON.stringify(job) }
    }

    // PATCH
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const patch: Record<string, unknown> = {}
      if ('contractorId'    in body) patch.contractor_id    = body.contractorId ?? null
      if ('status'          in body) patch.status           = body.status
      if ('scheduledDate'   in body) patch.scheduled_date   = body.scheduledDate ?? null
      if ('scheduledTime'   in body) patch.scheduled_time   = body.scheduledTime ?? null
      if ('scheduledWindow' in body) patch.scheduled_window = body.scheduledWindow ?? null
      if ('startTime'       in body) patch.start_time       = body.startTime ?? null
      if ('endTime'         in body) patch.end_time         = body.endTime ?? null
      if ('notes'           in body) patch.notes            = body.notes ?? null
      if ('internalNotes'   in body) patch.internal_notes   = body.internalNotes ?? null
      if ('propertyInfo'    in body) patch.property_info    = body.propertyInfo
      if ('customerName'    in body) patch.customer_name    = body.customerName ?? null
      if ('customerAddress' in body) patch.customer_address = body.customerAddress ?? null
      if ('customerPhone'   in body) patch.customer_phone   = body.customerPhone ?? null
      if ('customerEmail'   in body) patch.customer_email   = body.customerEmail ?? null
      if ('serviceName'     in body) patch.service_name     = body.serviceName

      const { data, error } = await supabase.from('jobs').update(patch).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      const job = rowToJob(data)
      // Fire-and-forget Google Calendar sync
      syncJobToGoogle({ ...job, googleEventId: data.google_event_id ?? null }).catch(() => {})
      return { statusCode: 200, headers: CORS, body: JSON.stringify(job) }
    }

    // DELETE
    if (method === 'DELETE' && id) {
      // Fetch google_event_id before deleting so we can remove the calendar event
      const { data: toDelete } = await supabase.from('jobs').select('google_event_id').eq('id', id).single()
      const { error } = await supabase.from('jobs').delete().eq('id', id)
      if (error) throw new Error(error.message)
      // Fire-and-forget Google Calendar event deletion
      if (toDelete?.google_event_id) {
        deleteGoogleEvent(toDelete.google_event_id).catch(() => {})
      }
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('jobs function error:', msg)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: msg }) }
  }
}
