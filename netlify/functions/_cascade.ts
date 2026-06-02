/**
 * _cascade.ts — Cross-module cascade helper
 *
 * Call handleLeadStageChange() after any lead stage update to propagate
 * meaningful transitions to Finance (transactions table), Contacts
 * (activities), and the activity log.
 *
 * ALL operations are non-fatal — a cascade failure never blocks the
 * primary save that triggered it.
 *
 * NOTE: The finance table in this codebase is named `transactions`.
 * Type values are 'Income' / 'Expense' (capital first) to match existing
 * data and the Finance tab's filter logic.
 */

import { SupabaseClient } from '@supabase/supabase-js'

/** Insert a single activity row — swallows errors so callers stay non-fatal. */
async function logActivity(
  supabase: SupabaseClient,
  contactId: string,
  type: string,
  summary: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('activities').insert({ contact_id: contactId, type, summary, metadata })
  } catch (e) {
    console.error('[cascade] activity insert failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Insert OR update the single CRM auto-entry ("accounts receivable") row for a lead.
 *
 * Cash-basis model (owner decision): these rows track work that's done but not yet
 * collected in the bank. They use the non-Schedule-C category 'Active Jobs' on the
 * 'CRM Auto-Entry' account, so the Finance P&L — which counts only recognized
 * INCOME_CATS — never books them as cash. The real income is recognized when the
 * customer's payment lands in the imported bank feed.
 *
 * We keep exactly ONE auto-entry per lead and reconcile it across the
 * finished_unpaid → finished_paid transition (flip is_unpaid) instead of inserting a
 * second row. The old code inserted a fresh row on every transition, which
 * double/triple-counted the same job (e.g. one $300 job booked 3× = $900).
 */
async function upsertLeadReceivable(
  supabase: SupabaseClient,
  lead: { id: string; contact_id: string | null },
  fields: { amount: number; description: string; isUnpaid: boolean },
): Promise<void> {
  const row = {
    type:        'Income',
    amount:      fields.amount,
    category:    'Active Jobs',          // intentionally NOT an INCOME_CAT → excluded from cash P&L
    source:      `lead:${lead.id}`,      // stable per-lead idempotency key
    description: fields.description,
    date:        new Date().toISOString().slice(0, 10),
    account:     'CRM Auto-Entry',
    notes:       fields.isUnpaid ? 'Auto-generated — invoice pending payment' : '',
    review:      fields.isUnpaid,        // surfaces unpaid jobs in the Finance "review"/AR view
    is_unpaid:   fields.isUnpaid,
    lead_id:     lead.id,
    contact_id:  lead.contact_id ?? null,
  }
  try {
    // Find this lead's existing auto-entry (matches both the new source key and any
    // legacy 'job_completed'-sourced row, via the CRM Auto-Entry account).
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('account', 'CRM Auto-Entry')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      await supabase.from('transactions').update(row).eq('id', existing.id)
    } else {
      await supabase.from('transactions').insert(row)
    }
  } catch (e) {
    console.error('[cascade] receivable upsert failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Queue a one-time review request for a lead's contact, with guards so that
 * centralizing the cascade onto more transitions can never double-text a customer:
 *   - contact exists and hasn't already left a review
 *   - no review already sent to this contact via the job-completion path
 *     (jobs.review_sent_at) — bridges the review_requests and sms_queue systems
 *   - under the 3-request cap (review_requests, type one_time)
 */
async function maybeQueueReview(
  supabase: SupabaseClient,
  lead: { id: string; contact_id: string | null },
): Promise<void> {
  if (!lead.contact_id) return
  try {
    // Already queued a review for THIS lead/job? (prevents a second request when the
    // same lead transitions finished_unpaid → finished_paid, e.g. sweep then QB payment).
    const { count: existingForLead } = await supabase
      .from('review_requests').select('id', { count: 'exact', head: true })
      .eq('lead_id', lead.id)
    if ((existingForLead ?? 0) > 0) return

    const { data: contactRow } = await supabase
      .from('contacts').select('has_left_review').eq('id', lead.contact_id).single()
    if (contactRow?.has_left_review) return

    const { count: alreadySent } = await supabase
      .from('jobs').select('id', { count: 'exact', head: true })
      .eq('contact_id', lead.contact_id).not('review_sent_at', 'is', null)
    if ((alreadySent ?? 0) > 0) return

    const { count } = await supabase
      .from('review_requests').select('id', { count: 'exact', head: true })
      .eq('contact_id', lead.contact_id).eq('type', 'one_time')
    if ((count ?? 0) >= 3) return

    await supabase.from('review_requests').insert({
      contact_id: lead.contact_id, lead_id: lead.id, type: 'one_time', status: 'pending_queue',
    })
  } catch (e) {
    console.error('[cascade] maybeQueueReview failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Runs after every lead stage change.
 * Handles: finished_paid, finished_unpaid, recurring, and a universal
 * stage_change activity entry for all transitions.
 */
export async function handleLeadStageChange(
  leadId:   string,
  newStage: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    // ── Fetch the lead ───────────────────────────────────────────────────────
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, contact_id, quote_id, estimated_value, service_interest')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      console.error(`[cascade] Could not fetch lead ${leadId}:`, leadErr?.message)
      return
    }

    // ── Universal: log stage_change on the contact's activity timeline ───────
    if (lead.contact_id) {
      await logActivity(supabase, lead.contact_id, 'stage_change',
        `Stage changed to ${newStage}`,
        { leadId, newStage, automated: true },
      )
    }

    // ── finished_paid ────────────────────────────────────────────────────────
    if (newStage === 'finished_paid') {
      // Revenue amount: prefer quote.total; fall back to lead.estimatedValue
      let amount: number = Number(lead.estimated_value ?? 0)
      let description = `Job completed — ${lead.service_interest ?? 'service'}`

      if (lead.quote_id) {
        try {
          const { data: quote } = await supabase
            .from('quotes')
            .select('total, customer_name')
            .eq('id', lead.quote_id)
            .single()
          if (quote) {
            amount = Number(quote.total ?? amount)
            description = `Job completed — ${quote.customer_name ?? lead.service_interest ?? 'customer'}`
          }
        } catch (_e) { /* non-fatal — fall back to estimated_value */ }
      }

      // Reconcile the lead's single auto-entry to PAID (does not insert a duplicate).
      // Under cash basis the real income is the bank deposit; this row is the AR record.
      await upsertLeadReceivable(supabase, { id: lead.id, contact_id: lead.contact_id }, { amount, description, isUnpaid: false })

      if (lead.contact_id) {
        await logActivity(supabase, lead.contact_id, 'payment_received',
          'Job marked finished/paid',
          { leadId, automated: true },
        )
      }

      await maybeQueueReview(supabase, { id: lead.id, contact_id: lead.contact_id })
    }

    // ── finished_unpaid ──────────────────────────────────────────────────────
    if (newStage === 'finished_unpaid') {
      let amount: number = Number(lead.estimated_value ?? 0)
      let description = `Job completed (invoice pending) — ${lead.service_interest ?? 'service'}`

      if (lead.quote_id) {
        try {
          const { data: quote } = await supabase
            .from('quotes')
            .select('total, customer_name')
            .eq('id', lead.quote_id)
            .single()
          if (quote) {
            amount = Number(quote.total ?? amount)
            description = `Job completed (invoice pending) — ${quote.customer_name ?? lead.service_interest ?? 'customer'}`
          }
        } catch (_e) { /* non-fatal */ }
      }

      // Reconcile the lead's single auto-entry to UNPAID (insert if first time, else update).
      await upsertLeadReceivable(supabase, { id: lead.id, contact_id: lead.contact_id }, { amount, description, isUnpaid: true })

      if (lead.contact_id) {
        await logActivity(supabase, lead.contact_id, 'invoice_sent',
          'Job marked finished/unpaid — invoice pending',
          { leadId, automated: true },
        )
      }

      await maybeQueueReview(supabase, { id: lead.id, contact_id: lead.contact_id })
    }

    // ── recurring ────────────────────────────────────────────────────────────
    // NOTE: leads.ts PATCH already auto-creates/activates the subscription
    // record when stage → 'recurring'. This block only adds the activity log
    // so the contact timeline reflects the conversion.
    if (newStage === 'recurring') {
      if (lead.contact_id) {
        await logActivity(supabase, lead.contact_id, 'note',
          'Lead converted to recurring subscription',
          { leadId, automated: true },
        )
      }
    }

  } catch (err) {
    // Top-level guard — cascade errors never bubble up to the caller
    console.error('[cascade] handleLeadStageChange unexpected error:',
      err instanceof Error ? err.message : err)
  }
}
