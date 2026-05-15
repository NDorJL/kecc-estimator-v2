import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToLead } from '../../src/types'
import { randomUUID } from 'crypto'
import Busboy from 'busboy'
import { handleLeadStageChange } from './_cascade'   // ← NEW
import { notifyOwner } from './_knoxNotify'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseMultipart(event: {
  headers: Record<string, string | undefined>
  body: string | null
  isBase64Encoded: boolean
}): Promise<{ file: Buffer; mimeType: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] ?? ''
    const busboy = Busboy({ headers: { 'content-type': contentType } })
    const chunks: Buffer[] = []
    let mimeType = 'image/jpeg'
    let fileName = 'photo.jpg'
    busboy.on('file', (_field, stream, info) => {
      mimeType = info.mimeType
      fileName = info.filename
      stream.on('data', (d: Buffer) => chunks.push(d))
    })
    busboy.on('finish', () => resolve({ file: Buffer.concat(chunks), mimeType, fileName }))
    busboy.on('error', reject)
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : Buffer.from(event.body ?? '', 'utf8')
    busboy.write(body)
    busboy.end()
  })
}

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
  const action = event.queryStringParameters?.action
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
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToLead)) }
    }

    // GET single lead
    if (method === 'GET' && id) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw new Error(error.message)
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // POST — upload a photo for a lead (must come before generic POST create)
    if (method === 'POST' && action === 'upload-photo' && id) {
      const { file, mimeType, fileName } = await parseMultipart(event as Parameters<typeof parseMultipart>[0])
      if (!file.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No file received' }) }

      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${id}/${randomUUID()}.${ext}`

      const { error: uploadErr } = await supabase.storage.from('lead-photos').upload(path, file, {
        contentType: mimeType,
        upsert: false,
      })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('lead-photos').getPublicUrl(path)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ url: publicUrl }) }
    }

    // CREATE lead
    if (method === 'POST' && !action) {
      const body = JSON.parse(event.body ?? '{}')

      // ── Campaign attribution ──────────────────────────────────────────────
      // Priority: UTM params > kecc_campaign cookie. Both are passed explicitly
      // in the request body by the frontend (cookies aren't forwarded by apiRequest).
      let campaignId: string | null = null
      let resolvedSource: string | null = body.source ?? null

      // 1. UTM resolution — match utm_campaign value against campaigns.utm_campaign column
      if (body.utmCampaign) {
        const { data: cam } = await supabase
          .from('campaigns')
          .select('id')
          .eq('utm_campaign', body.utmCampaign)
          .eq('status', 'active')
          .maybeSingle()
        if (cam) {
          campaignId = cam.id
          // Prefer the utm_source value over the form-selected source
          if (body.utmSource) resolvedSource = body.utmSource
        }
      }

      // 2. Cookie fallback — look up by redirect_token, derive source from channel name
      if (!campaignId && body.campaignCookie) {
        const { data: cam } = await supabase
          .from('campaigns')
          .select('id, marketing_channels(name)')
          .eq('redirect_token', body.campaignCookie)
          .maybeSingle()
        if (cam) {
          campaignId = cam.id
          // Use the channel name as source (e.g. "Door Hangers", "Facebook Ads")
          const channelName = (cam.marketing_channels as { name?: string } | null)?.name
          if (channelName) resolvedSource = channelName
        }
      }
      // ── End attribution ───────────────────────────────────────────────────

      const { data, error } = await supabase
        .from('leads')
        .insert({
          contact_id: body.contactId ?? null,
          property_id: body.propertyId ?? null,
          stage: body.stage ?? 'new',
          source: resolvedSource,
          service_interest: body.serviceInterest ?? null,
          estimated_value: body.estimatedValue ?? null,
          contractor_cost: body.contractorCost ?? null,
          quote_id: body.quoteId ?? null,
          lost_reason: body.lostReason ?? null,
          notes: body.notes ?? null,
          contacted_at: body.stage === 'contacted' ? new Date().toISOString() : null,
          campaign_id: campaignId,
        })
        .select()
        .single()
      if (error) throw new Error(error.message)

      // ── Knox: notify owner of new lead (fire-and-forget) ──────────────────
      ;(async () => {
        const sourcePart  = resolvedSource ? ` via ${resolvedSource}` : ''
        const svcPart     = body.serviceInterest ? ` — ${body.serviceInterest}` : ''
        const valPart     = body.estimatedValue   ? ` ($${Number(body.estimatedValue).toFixed(0)})` : ''
        await notifyOwner(supabase, `Knox: New lead${sourcePart}${svcPart}${valPart}`)
      })().catch(() => {})

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
      if (body.propertyId !== undefined)       updates.property_id = body.propertyId
      if (body.source !== undefined)           updates.source = body.source
      if (body.campaignId !== undefined)       updates.campaign_id = body.campaignId
      if (body.photoStacks !== undefined)      updates.photo_stacks = body.photoStacks
      // Stamp contacted_at whenever a lead is manually moved to 'contacted'
      if (body.stage === 'contacted')         updates.contacted_at = new Date().toISOString()

      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
      if (error) throw new Error(error.message)

      // ── Stamp sent_at on the linked quote when moved to 'quoted' ────────────
      // This starts the 3-day unsigned-quote countdown on the dashboard regardless
      // of whether the quote was delivered via SMS or handed over in person.
      if (body.stage === 'quoted' && data.quote_id) {
        try {
          const { data: q } = await supabase
            .from('quotes')
            .select('id, sent_at')
            .eq('id', data.quote_id)
            .single()
          if (q && !q.sent_at) {
            await supabase
              .from('quotes')
              .update({ sent_at: new Date().toISOString() })
              .eq('id', q.id)
          }
        } catch (_e) {
          // Non-fatal — lead stage already saved successfully
          console.error('[leads] Failed to stamp sent_at on quote:', _e instanceof Error ? _e.message : _e)
        }
      }

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

      // ── Cascade: propagate stage change to Finance + activity log ──────────  // ← NEW
      // Non-fatal: a cascade failure never blocks the response.                  // ← NEW
      if (body.stage !== undefined) {                                              // ← NEW
        handleLeadStageChange(id, body.stage, supabase).catch(err =>              // ← NEW
          console.error('[leads] cascade failed:', err instanceof Error ? err.message : err)  // ← NEW
        )                                                                          // ← NEW
      }                                                                            // ← NEW

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToLead(data)) }
    }

    // DELETE — remove a single photo from storage (stacks are managed client-side via PATCH)
    if (method === 'DELETE' && action === 'delete-photo' && id) {
      const body = JSON.parse(event.body ?? '{}')
      const { url } = body as { url: string }
      if (!url) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'url required' }) }
      const marker = '/object/public/lead-photos/'
      const storagePath = url.includes(marker) ? url.split(marker)[1] : null
      if (storagePath) {
        await supabase.storage.from('lead-photos').remove([storagePath])
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) }
    }

    // DELETE lead
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw new Error(error.message)
      return { statusCode: 204, headers: CORS, body: '' }
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: message }) }
  }
}
