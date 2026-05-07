import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToLead } from '../../src/types'

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

  const rawPath = event.path.replace(/\/.netlify\/functions\/leads\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const method = event.httpMethod
  const contactId = event.queryStringParameters?.contactId

  try {
    // LIST leads (optionally filtered by contact)
    if (method === 'GET' && !id) {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (contactId) query = query.eq('contact_id', contactId)

      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToLead)) }
    }

    // GET single lead
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // CREATE lead
    if (method === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      const { data, error } = await supabase
        .from('leads')
        .insert({
          contact_id: body.contactId ?? null,
          stage: body.stage ?? 'new',
          source: body.source ?? null,
          service_interest: body.serviceInterest ?? null,
          estimated_value: body.estimatedValue ?? null,
          contractor_cost: body.contractorCost ?? null,
          quote_id: body.quoteId ?? null,
          lost_reason: body.lostReason ?? null,
          notes: body.notes ?? null,
          contacted_at: body.stage === 'contacted' ? new Date().toISOString() : null,
        })
        .select()
        .single()
      if (error) throw error
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // UPDATE lead (stage, notes, etc.)
    if (method === 'PATCH' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const updates: Record<string, unknown> = {}
      if (body.stage !== undefined)            updates.stage = body.stage
      if (body.notes !== undefined)            updates.notes = body.notes
      if (body.lostReason !== undefined)       updates.lost_reason = body.lostReason
      if (body.estimatedValue !== undefined)   updates.estimated_value = body.estimatedValue
      if (body.contractorCost !== undefined)   updates.contractor_cost = body.contractorCost
      if (body.serviceInterest !== undefined)  updates.service_interest = body.serviceInterest
      if (body.quoteId !== undefined)          updates.quote_id = body.quoteId
      if (body.contactId !== undefined)        updates.contact_id = body.contactId
      // Stamp contacted_at whenever a lead is manually moved to 'contacted'
      if (body.stage === 'contacted')         updates.contacted_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // ── Auto-create/activate subscription when lead moves to 'recurring' ───
      // Ensures the lead's monthly value is always reflected in MRR metrics,
      // regardless of whether the stage was set manually or automatically.
      if (body.stage === 'recurring' && data.contact_id) {
        try {
          // Check if an active (or paused) subscription already exists for this contact
          const { data: existingSub } = await supabase
            .from('subscriptions')
            .select('id, status')
            .eq('contact_id', data.contact_id)
            .not('status', 'eq', 'CANCELLED')
            .limit(1)
            .maybeSingle()

          if (existingSub) {
            // Just activate it if it's not already active
            if (existingSub.status !== 'ACTIVE') {
              await supabase.from('subscriptions')
                .update({ status: 'ACTIVE' })
                .eq('id', existingSub.id)
            }
          } else if (data.quote_id) {
            // No subscription yet — create one from the linked quote
            const { data: quote } = await supabase
              .from('quotes').select('*').eq('id', data.quote_id).single()

            if (quote) {
              const lineItems: Array<Record<string, unknown>> = Array.isArray(quote.line_items) ? quote.line_items : []
              const subItems = lineItems.filter(li => li.isSubscription)

              // Build services array from subscription line items
              const services = subItems.map(li => ({
                id:           li.serviceId ?? String(Math.random()),
                serviceId:    li.serviceId ?? '',
                serviceName:  li.serviceName ?? '',
                frequency:    li.frequency ?? 'Monthly',
                pricePerMonth: Number(li.monthlyAmount ?? li.lineTotal ?? 0),
                pricePerVisit: Number(li.unitPrice ?? 0),
              }))

              // Monthly total: sum of subscription items, or full quote total
              const monthlyTotal = subItems.length > 0
                ? subItems.reduce((s, li) => s + Number(li.monthlyAmount ?? li.lineTotal ?? 0), 0)
                : Number(quote.total ?? 0)

              await supabase.from('subscriptions').insert({
                contact_id:              data.contact_id,
                quote_id:                data.quote_id,
                customer_name:           quote.customer_name ?? '',
                customer_address:        quote.customer_address ?? null,
                customer_phone:          quote.customer_phone ?? null,
                customer_email:          quote.customer_email ?? null,
                status:                  'ACTIVE',
                services,
                in_season_monthly_total: monthlyTotal,
                quote_type:              quote.quote_type ?? null,
              })
              console.log(`[leads] Auto-created subscription for lead ${id} (contact ${data.contact_id}) — $${monthlyTotal}/mo`)
            }
          }
        } catch (subErr) {
          // Non-fatal — lead stage already saved successfully
          console.error('[leads] Auto-subscription failed:', subErr instanceof Error ? subErr.message : subErr)
        }
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // DELETE lead
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
