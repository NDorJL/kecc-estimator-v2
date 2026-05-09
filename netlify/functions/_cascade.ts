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

      try {
        await supabase.from('transactions').insert({
          type:        'Income',
          amount,
          category:    'Active Jobs',
          source:      'job_completed',
          description,
          date:        new Date().toISOString().slice(0, 10),
          account:     'CRM Auto-Entry',
          notes:       '',
          review:      false,
          is_unpaid:   false,
          lead_id:     lead.id,
          contact_id:  lead.contact_id ?? null,
        })
      } catch (e) {
        console.error('[cascade] transactions insert (finished_paid) failed:', e instanceof Error ? e.message : e)
      }

      if (lead.contact_id) {
        await logActivity(supabase, lead.contact_id, 'payment_received',
          'Job marked finished/paid',
          { leadId, automated: true },
        )
      }
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

      try {
        await supabase.from('transactions').insert({
          type:        'Income',
          amount,
          category:    'Active Jobs',
          source:      'job_completed',
          description,
          date:        new Date().toISOString().slice(0, 10),
          account:     'CRM Auto-Entry',
          notes:       'Auto-generated — invoice pending payment',
          review:      true,      // surfaces in Finance "needs review" view
          is_unpaid:   true,      // flagged as not yet collected
          lead_id:     lead.id,
          contact_id:  lead.contact_id ?? null,
        })
      } catch (e) {
        console.error('[cascade] transactions insert (finished_unpaid) failed:', e instanceof Error ? e.message : e)
      }

      if (lead.contact_id) {
        await logActivity(supabase, lead.contact_id, 'invoice_sent',
          'Job marked finished/unpaid — invoice pending',
          { leadId, automated: true },
        )
      }
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
