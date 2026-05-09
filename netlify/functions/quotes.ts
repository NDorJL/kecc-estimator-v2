import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { rowToQuote } from '../../src/types'
import { randomUUID } from 'crypto'
import { advanceLeadStage } from './_leadSync'
import { sendOpenPhoneSms, getAttachmentLinks } from './_smsHelper'
import { sendEmail } from './_emailHelper'   // ← NEW (FIX 1)

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Revision helper ───────────────────────────────────────────────────────────
// Mirrors buildRevisedLineItems() in Leads.tsx. Bakes amendments into a clean
// line-items array: adjustments replace originals, removals are excluded,
// additions are appended. Used when auto-generating the revision quote.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRevisedLineItems(originalItems: any[], amendments: any[]): any[] {
  const amendByItemId = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    amendments.filter((a: any) => a.lineItemId).map((a: any) => [a.lineItemId, a])
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = originalItems
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((li: any) => amendByItemId.get(li.serviceId)?.type !== 'removal')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((li: any) => {
      const a = amendByItemId.get(li.serviceId)
      if (a?.type === 'adjustment') {
        const newAmt = a.newAmount ?? li.lineTotal
        return {
          ...li,
          serviceName: a.newName ?? li.serviceName,
          description: a.newDescription ?? li.description,
          unitPrice:   newAmt,
          lineTotal:   newAmt,
        }
      }
      return li
    })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  amendments.filter((a: any) => a.type === 'addition').forEach((a: any) => {
    result.push({
      serviceId:      `amend_${a.id}`,
      serviceName:    a.label,
      category:       'Supplemental',
      description:    a.addedDescription ?? undefined,
      quantity:       1,
      unitPrice:      a.addedAmount ?? 0,
      lineTotal:      a.addedAmount ?? 0,
      isSubscription: false,
    })
  })
  return result
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Parse path: /.netlify/functions/quotes[/id[/action]]
  const rawPath = event.path.replace(/\/.netlify\/functions\/quotes\/?/, '')
  const parts = rawPath.split('/').filter(Boolean)
  const id = parts[0]
  const action = parts[1]
  const method = event.httpMethod

  try {
    // LIST all non-trashed quotes (optionally filtered by leadId)
    if (method === 'GET' && !id) {
      const trashed = event.queryStringParameters?.trashed === 'true'
      const leadId  = event.queryStringParameters?.leadId
      // select('*') returns all columns — includes option_groups, selected_option_group_ids,
      // revised_from_id, amendments, original_total, etc. No explicit field list needed.
      let query = supabase.from('quotes').select('*').order('created_at', { ascending: false })
      if (trashed) query = query.not('trashed_at', 'is', null)
      else query = query.is('trashed_at', null)
      if (leadId) query = query.eq('lead_id', leadId)
      const { data, error } = await query
      if (error) throw error
      return { statusCode: 200, headers: CORS, body: JSON.stringify((data ?? []).map(rowToQuote)) }
    }

    // EMPTY TRASH
    if (method === 'DELETE' && id === 'trash' && action === 'empty') {
      await supabase.from('quotes').delete().not('trashed_at', 'is', null)
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Trash emptied' }) }
    }

    // GET single quote
    if (method === 'GET' && id && !action) {
      const { data, error } = await supabase.from('quotes').select('*').eq('id', id).single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // CREATE quote
    if (method === 'POST' && !id) {
      const body = JSON.parse(event.body ?? '{}')
      const insert = {
        customer_name: body.customerName ?? '',
        customer_address: body.customerAddress ?? null,
        customer_phone: body.customerPhone ?? null,
        customer_email: body.customerEmail ?? null,
        business_name: body.businessName ?? null,
        quote_type: body.quoteType ?? 'residential_onetime',
        line_items: body.lineItems ?? [],
        subtotal: Number(body.subtotal ?? 0),
        discount: body.discount !== undefined ? Number(body.discount) : null,
        total: Number(body.total ?? 0),
        notes: body.notes ?? null,
        status: body.status ?? 'draft',
        contact_id: body.contactId ?? null,
        expires_at: body.expiresAt ?? null,
        accept_token: randomUUID(),
        lead_id: body.leadId ?? null,
        revised_from_id: body.revisedFromId ?? null,
      }
      const { data, error } = await supabase.from('quotes').insert(insert).select().single()
      if (error) throw error
      // Auto-place / advance a lead in "Quoted" whenever a quote is created
      await advanceLeadStage(supabase, {
        leadId:    data.lead_id ?? null,
        quoteId:   data.id,
        contactId: data.contact_id ?? null,
        stage:     'quoted',
        extraInsert: {
          estimated_value:  data.total ?? null,
          service_interest: Array.isArray(data.line_items) && data.line_items.length > 0
            ? (data.line_items[0] as any).serviceName ?? null
            : null,
        },
      })
      return { statusCode: 201, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // UPDATE quote
    if (method === 'PATCH' && id && !action) {
      let body: Record<string, unknown>
      try { body = JSON.parse(event.body ?? '{}') } catch (_e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Invalid JSON body' }) } }
      const update: Record<string, unknown> = {}
      if (body.customerName !== undefined) update.customer_name = body.customerName
      if (body.customerAddress !== undefined) update.customer_address = body.customerAddress
      if (body.customerPhone !== undefined) update.customer_phone = body.customerPhone
      if (body.customerEmail !== undefined) update.customer_email = body.customerEmail
      if (body.businessName !== undefined) update.business_name = body.businessName
      if (body.quoteType !== undefined) update.quote_type = body.quoteType
      if (body.lineItems !== undefined) update.line_items = body.lineItems
      if (body.subtotal !== undefined) update.subtotal = Number(body.subtotal)
      if (body.discount !== undefined) update.discount = body.discount !== null ? Number(body.discount) : null
      if (body.total !== undefined) update.total = Number(body.total)
      if (body.notes !== undefined) update.notes = body.notes
      if (body.status !== undefined) update.status = body.status
      if (body.contactId !== undefined)      update.contact_id = body.contactId
      if (body.createdAt !== undefined)      update.created_at = body.createdAt   // allow backdating
      if (body.expiresAt !== undefined)      update.expires_at = body.expiresAt
      if (body.signedAt !== undefined)       update.signed_at = body.signedAt
      if (body.signatureData !== undefined)  update.signature_data = body.signatureData
      if (body.signedIp !== undefined)       update.signed_ip = body.signedIp
      if (body.qbInvoiceId !== undefined)    update.qb_invoice_id = body.qbInvoiceId
      if (body.sentAt !== undefined)         update.sent_at = body.sentAt
      if (body.amendments !== undefined)     update.amendments = body.amendments
      if (body.originalTotal !== undefined)  update.original_total = body.originalTotal !== null ? Number(body.originalTotal) : null
      if (body.revisedFromId !== undefined)         update.revised_from_id = body.revisedFromId
      if (body.optionGroups !== undefined)           update.option_groups = body.optionGroups
      if (body.selectedOptionGroupIds !== undefined) update.selected_option_group_ids = body.selectedOptionGroupIds
      if (Object.keys(update).length === 0) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No fields to update' }) }
      const { data, error } = await supabase.from('quotes').update(update).eq('id', id).select().single()
      if (error) {
        console.error('PATCH /quotes error:', error)
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: error.message, details: error.details ?? null }) }
      }
      if (!data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }

      // ── Propagate customer identity changes back to the linked contact ────
      // So editing a name on a quote keeps the contact record in sync.
      if (data.contact_id) {
        const contactSync: Record<string, unknown> = {}
        if (body.customerName !== undefined)  contactSync.name          = body.customerName
        if (body.customerEmail !== undefined) contactSync.email         = body.customerEmail
        if (body.customerPhone !== undefined) contactSync.phone         = body.customerPhone
        if (body.businessName  !== undefined) contactSync.business_name = body.businessName
        if (Object.keys(contactSync).length > 0) {
          try {
            await supabase.from('contacts')
              .update(contactSync)
              .eq('id', data.contact_id)
          } catch (_syncErr) {
            // non-fatal — never let contact sync crash the quote save response
          }
        }
      }

      // NOTE: lead does NOT advance to 'scheduled' here — that only happens
      // when a job is explicitly created from this quote via POST /jobs.

      // ── Auto-generate/update revision when amendments are saved to a signed quote ──
      // Fires whenever the PATCH body contains an amendments array AND the quote is signed.
      // Non-fatal — revision failure never blocks the primary save response.
      if (body.amendments !== undefined && data.signed_at) {                                              // ← NEW
        try {                                                                                               // ← NEW
          const amendments    = Array.isArray(body.amendments) ? body.amendments as any[] : []           // ← NEW
          const originalItems = Array.isArray(data.line_items) ? data.line_items as any[] : []           // ← NEW
          const revisedItems  = buildRevisedLineItems(originalItems, amendments)                          // ← NEW
                                                                                                           // ← NEW
          // Compute amended total from original_total (frozen at signing) + amendment deltas            // ← NEW
          const base     = Number(data.original_total ?? data.total)                                      // ← NEW
          // eslint-disable-next-line @typescript-eslint/no-explicit-any                                  // ← NEW
          const newTotal = base + amendments.reduce((d: number, a: any) => {                              // ← NEW
            if (a.type === 'addition')   return d + (a.addedAmount   ?? 0)                               // ← NEW
            if (a.type === 'adjustment') return d + (a.newAmount ?? 0) - (a.originalAmount ?? 0)         // ← NEW
            if (a.type === 'removal')    return d - (a.originalAmount ?? 0)                              // ← NEW
            return d                                                                                        // ← NEW
          }, 0)                                                                                             // ← NEW
                                                                                                           // ← NEW
          // Check if a revision already exists for this quote                                            // ← NEW
          const { data: existingRevision } = await supabase                                               // ← NEW
            .from('quotes')                                                                               // ← NEW
            .select('id')                                                                                  // ← NEW
            .eq('revised_from_id', id)                                                                    // ← NEW
            .maybeSingle()                                                                                 // ← NEW
                                                                                                           // ← NEW
          if (existingRevision) {                                                                          // ← NEW
            // Update the existing revision with the latest baked-in line items                          // ← NEW
            await supabase.from('quotes').update({                                                        // ← NEW
              line_items: revisedItems,                                                                   // ← NEW
              subtotal:   newTotal,                                                                       // ← NEW
              total:      newTotal,                                                                       // ← NEW
            }).eq('id', existingRevision.id)                                                              // ← NEW
          } else {                                                                                         // ← NEW
            // Create a new revision quote with all customer info copied                                  // ← NEW
            await supabase.from('quotes').insert({                                                        // ← NEW
              customer_name:    data.customer_name,                                                       // ← NEW
              customer_address: data.customer_address,                                                    // ← NEW
              customer_phone:   data.customer_phone,                                                      // ← NEW
              customer_email:   data.customer_email,                                                      // ← NEW
              business_name:    data.business_name,                                                       // ← NEW
              quote_type:       data.quote_type,                                                          // ← NEW
              line_items:       revisedItems,                                                             // ← NEW
              subtotal:         newTotal,                                                                  // ← NEW
              discount:         null,                                                                     // ← NEW
              total:            newTotal,                                                                  // ← NEW
              notes:            data.notes,                                                               // ← NEW
              status:           'revised',                                                                // ← NEW
              contact_id:       data.contact_id,                                                          // ← NEW
              lead_id:          data.lead_id,                                                             // ← NEW
              revised_from_id:  id,                                                                       // ← NEW
              accept_token:     randomUUID(),                                                             // ← NEW
            })                                                                                            // ← NEW
          }                                                                                               // ← NEW
          console.log(`[quotes] Revision ${existingRevision ? 'updated' : 'created'} for signed quote ${id}`) // ← NEW
        } catch (revErr) {                                                                                 // ← NEW
          // Non-fatal: revision failure never blocks the response                                        // ← NEW
          console.error('[quotes] Revision generation failed:', revErr instanceof Error ? revErr.message : revErr) // ← NEW
        }                                                                                                  // ← NEW
      }                                                                                                    // ← NEW

      // ── Auto-create Finance income entry when a quote is accepted ──────────────  // ← NEW
      // Fire-and-forget — never blocks the response.                                 // ← NEW
      // ⚠️  GAP: The primary acceptance path is esign.ts (customer signs online),   // ← NEW
      // which updates status directly in Supabase. This trigger covers the CRM-side  // ← NEW
      // manual accept path. esign.ts is out of scope for this session.               // ← NEW
      if (body.status === 'accepted') {                                               // ← NEW
        ;(async () => {                                                               // ← NEW
          try {                                                                       // ← NEW
            // Duplicate guard — do not create a second entry for the same quote     // ← NEW
            const { data: existing } = await supabase                               // ← NEW
              .from('transactions').select('id').eq('source', `quote:${id}`).maybeSingle()  // ← NEW
            if (existing) return                                                     // ← NEW
            const acceptedDate = (data.signed_at as string | null)?.slice(0, 10)   // ← NEW
              ?? new Date().toISOString().slice(0, 10)                               // ← NEW
            const description = `Quote Accepted — ${data.customer_name ?? 'Customer'}`  // ← NEW
            await supabase.from('transactions').insert({                             // ← NEW
              date:        acceptedDate,                                              // ← NEW
              description,                                                           // ← NEW
              amount:      Number(data.total ?? 0),                                  // ← NEW
              type:        'Income',                                                 // ← NEW
              category:    'Quote Revenue',                                          // ← NEW
              account:     'KECC Checking (TVA)',                                    // ← NEW
              notes:       '',                                                       // ← NEW
              review:      false,                                                    // ← NEW
              source:      `quote:${id}`,                                            // ← NEW
            })                                                                       // ← NEW
            console.log(`[quotes] Finance entry created for accepted quote ${id}`)  // ← NEW
          } catch (e) {                                                              // ← NEW
            console.error('[quotes] Finance auto-entry (quote accepted) failed:', e instanceof Error ? e.message : e)  // ← NEW
          }                                                                          // ← NEW
        })()                                                                         // ← NEW
      }                                                                              // ← NEW

      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // SEND quote via email ← NEW (FIX 1)
    if (method === 'POST' && id && action === 'send-email') {
      const body2 = JSON.parse(event.body ?? '{}') as { recipientEmail?: string }

      const { data: quote, error: qErr } = await supabase
        .from('quotes').select('*').eq('id', id).single()
      if (qErr || !quote) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }

      const recipientEmail = body2.recipientEmail ?? quote.customer_email
      if (!recipientEmail) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No email address on this quote' }) }

      const { data: settings } = await supabase
        .from('company_settings').select('company_name').limit(1).single()
      const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'

      const siteUrl = (process.env.URL ?? '').replace(/\/$/, '')
      const esignUrl = quote.accept_token
        ? `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(quote.accept_token)}`
        : `${siteUrl}/.netlify/functions/pdf-quote?quoteId=${id}`

      // Build a short service summary for the subject line
      const lineItems = Array.isArray(quote.line_items) ? quote.line_items as Array<{serviceName?: string}> : []
      const firstService = lineItems[0]?.serviceName ?? null
      const subject = `Your Quote from ${companyName}${firstService ? ` — ${firstService}` : ''}`

      const firstName = (quote.customer_name ?? 'there').split(' ')[0]
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 16px; color: #111827;">Hi ${firstName},</h2>
          <p style="color: #374151; line-height: 1.6;">
            Your quote from <strong>${companyName}</strong> is ready to review.
            Click the link below to view the full estimate and sign to accept.
          </p>
          <div style="margin: 28px 0; text-align: center;">
            <a href="${esignUrl}" style="background: #e06307; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">
              View &amp; Sign Your Quote
            </a>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">
            Or copy this link: <a href="${esignUrl}" style="color: #e06307;">${esignUrl}</a>
          </p>
          <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
            Questions? Reply to this email or call/text us directly.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 32px; border-top: 1px solid #f3f4f6; padding-top: 16px;">
            — ${companyName}
          </p>
        </div>`

      await sendEmail({ to: recipientEmail, subject, html })

      // Log activity on the contact (non-fatal)
      if (quote.contact_id) {
        try { await supabase.from('activities').insert({
          contact_id: quote.contact_id,
          type:       'email_sent',
          summary:    `Quote emailed to ${recipientEmail}`,
          metadata:   { quoteId: id },
        }) } catch (_e) { /* non-fatal */ }
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // SEND quote via SMS — stamps sent_at and fires OpenPhone message
    if (method === 'POST' && id && action === 'send') {
      const { data: quote, error: qErr } = await supabase
        .from('quotes').select('*').eq('id', id).single()
      if (qErr || !quote) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }

      if (!quote.customer_phone) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'No phone number on this quote' }) }
      }
      if (!quote.accept_token) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Quote has no accept token — regenerate the quote' }) }
      }

      // Fetch SMS credentials from settings
      const { data: settings } = await supabase
        .from('company_settings').select('quo_api_key, quo_from_number, company_name').limit(1).single()
      const apiKey     = settings?.quo_api_key     ?? process.env.QUO_API_KEY ?? ''
      const fromNumber = settings?.quo_from_number ?? process.env.QUO_FROM_NUMBER ?? ''
      const companyName = settings?.company_name ?? 'Knox Exterior Care Co.'

      if (!apiKey || !fromNumber) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: 'SMS not configured in Settings' }) }
      }

      const siteUrl = (process.env.URL ?? '').replace(/\/$/, '')
      const esignUrl = `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(quote.accept_token)}`
      const firstName = (quote.customer_name ?? 'there').split(' ')[0]

      const body2 = JSON.parse(event.body ?? '{}') as {
        includeAgreement?: boolean
        attachmentIds?: string[]   // IDs of quote_attachments to include as PDF links in SMS
      }
      const includeAgreement = !!body2.includeAgreement
      const attachmentIds: string[] = Array.isArray(body2.attachmentIds) ? body2.attachmentIds : []

      const lineItems = Array.isArray(quote.line_items) ? quote.line_items as Array<{ isSubscription?: boolean }> : []
      const qt = (quote.quote_type ?? '').toLowerCase()
      const isRecurring =
        qt.includes('autopilot') || qt.includes('tcep') || qt.includes('tpc') ||
        lineItems.some(li => li.isSubscription)

      // Generate service agreement inline when requested (avoids HTTP self-call issues)
      let agreementUrl: string | null = null
      if (includeAgreement && isRecurring) {
        try {
          const leadId = quote.lead_id ?? null
          let leadNotes: string | null = null
          if (leadId) {
            const { data: lead } = await supabase.from('leads').select('notes').eq('id', leadId).single()
            leadNotes = lead?.notes ?? null
          }
          await supabase.from('service_agreements')
            .update({ status: 'void', updated_at: new Date().toISOString() })
            .eq('quote_id', id).in('status', ['draft', 'pending_signature'])

          const agreeToken = randomUUID()
          const { data: agreementRow } = await supabase.from('service_agreements').insert({
            contact_id: quote.contact_id ?? null, quote_id: id, lead_id: leadId,
            customer_name: quote.customer_name ?? '', customer_address: quote.customer_address ?? null,
            customer_email: quote.customer_email ?? null, customer_phone: quote.customer_phone ?? null,
            quote_type: quote.quote_type ?? null, lead_notes: leadNotes,
            status: 'pending_signature', accept_token: agreeToken,
          }).select().single()

          if (agreementRow) {
            agreementUrl = `${siteUrl}/.netlify/functions/esign?token=${encodeURIComponent(agreeToken)}`
          }
        } catch (agreeErr) {
          console.error('[quotes/send] Failed to generate SA:', agreeErr)
        }
      }

      // Generate signed PDF links for selected attachments
      let pdfLinkSuffix = ''
      if (attachmentIds.length > 0) {
        try {
          const { data: atts } = await supabase
            .from('quote_attachments')
            .select('id, name, file_path')
            .in('id', attachmentIds)
            .eq('enabled', true)
          const links = await getAttachmentLinks((atts ?? []).map(a => a.file_path))
          if (links.length > 0) {
            const attNames = (atts ?? []).reduce((m: Record<string, string>, a) => { m[a.file_path] = a.name; return m }, {})
            pdfLinkSuffix = '\n\n' + links.map(l => `📄 ${attNames[l.name] ?? 'PDF'}: ${l.url}`).join('\n')
          }
        } catch (_e) { /* non-fatal — send without attachments */ }
      }

      const message = (agreementUrl
        ? `Hi ${firstName}, Knox Exterior Care Co. here! Your quote and service agreement are ready to review and sign:\n\nEstimate: ${esignUrl}\n\nService Agreement: ${agreementUrl}\n\nPlease sign both to get started. Reply STOP to opt out.`
        : `Hi ${firstName}, Knox Exterior Care Co. here! Your quote is ready — follow this link to view. ` +
          `If you'd like to move forward, simply sign the e-sign at the bottom of the quote, and we'll reach out about getting you on the schedule.\n\n` +
          `Please reach out to this number with any questions or concerns - thank you for the opportunity to serve!\n\n` +
          `Automated msg. Reply STOP to opt out.\n\n` +
          esignUrl
      ) + pdfLinkSuffix

      await sendOpenPhoneSms(apiKey, fromNumber, quote.customer_phone, message)

      // Stamp sent_at and flip status to 'sent'
      const now = new Date().toISOString()
      const { data: updated, error: upErr } = await supabase
        .from('quotes')
        .update({ sent_at: now, status: 'sent' })
        .eq('id', id).select().single()
      if (upErr || !updated) throw upErr

      // Log activity on the contact (non-fatal)
      if (updated.contact_id) {
        try { await supabase.from('activities').insert({
          contact_id: updated.contact_id,
          type: 'sms_out',
          summary: `Quote sent via SMS to ${quote.customer_phone}`,
          metadata: { quoteId: id, esignUrl, agreementUrl: agreementUrl ?? null },
        }) } catch (_e) { /* non-fatal */ }
      }

      // Return success — frontend invalidates the /quotes cache to pick up sent_at
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) }
    }

    // TRASH quote
    if (method === 'POST' && id && action === 'trash') {
      const { data, error } = await supabase.from('quotes').update({ trashed_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // RESTORE quote
    if (method === 'POST' && id && action === 'restore') {
      const { data, error } = await supabase.from('quotes').update({ trashed_at: null }).eq('id', id).select().single()
      if (error || !data) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rowToQuote(data)) }
    }

    // DELETE quote (permanent)
    if (method === 'DELETE' && id && !action) {
      const { error } = await supabase.from('quotes').delete().eq('id', id)
      if (error) return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Quote not found' }) }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Deleted' }) }
    }

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: 'Not found' }) }
  } catch (err) {
    console.error('quotes error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: msg }) }
  }
}
