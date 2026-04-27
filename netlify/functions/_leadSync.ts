/**
 * _leadSync.ts — shared lead-pipeline automation helper
 *
 * Call advanceLeadStage() from any Netlify function after a significant
 * event. It will:
 *   - Find the linked lead by quoteId (preferred) or contactId fallback
 *   - If found by contactId: attach the quoteId to that existing lead
 *     (deduplication — one lead per contact, quote attaches to it)
 *   - Move it forward if the new stage is ahead of the current one
 *   - Never go backwards, never leave 'lost' automatically
 *   - Auto-create a lead (stage = 'quoted') only if none exists at all
 */

import { SupabaseClient } from '@supabase/supabase-js'

// Must match the LeadStage type in src/types.ts — order matters
// 'recurring' comes before 'finished_unpaid' so recurring leads advance correctly;
// one-time leads skip 'recurring' and go straight to 'finished_unpaid'.
const STAGE_ORDER = [
  'new',
  'contacted',
  'follow_up',
  'quoted',
  'scheduled',
  'recurring',
  'finished_unpaid',
  'finished_paid',
  // legacy / hidden — keep at end so auto-advances never reach them
  'lost',
] as const

type LeadStage = typeof STAGE_ORDER[number]

interface SyncOptions {
  /** Direct lead ID — used when a quote is created from a specific lead */
  leadId?: string | null
  /** Preferred lookup: find lead where quote_id = this */
  quoteId?: string | null
  /** Fallback lookup: find most-recent lead for this contact */
  contactId?: string | null
  /** Target stage to advance to */
  stage: LeadStage
  /** Extra fields to set on auto-created leads (snake_case, straight to Supabase) */
  extraInsert?: Record<string, unknown>
}

/**
 * Advance a lead's stage — or auto-create one if none exists.
 * When a quote is created for a contact that already has a lead,
 * the quote attaches to that existing lead instead of spawning a new one.
 * Safe to await — any DB errors are caught and logged (non-fatal).
 */
export async function advanceLeadStage(
  supabase: SupabaseClient,
  { leadId, quoteId, contactId, stage, extraInsert = {} }: SyncOptions
): Promise<void> {
  try {
    let lead: { id: string; stage: string; quote_id: string | null } | null = null
    let foundByLeadId = false
    let foundByQuoteId = false

    // ── 1. Direct lead lookup (quote created from a specific lead) ────────
    if (leadId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage, quote_id')
        .eq('id', leadId)
        .limit(1)
        .single()
      if (data) { lead = data; foundByLeadId = true }
    }

    // ── 2. Look up by quoteId (quote already linked as primary) ──────────
    if (!lead && quoteId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage, quote_id')
        .eq('quote_id', quoteId)
        .limit(1)
        .single()
      if (data) { lead = data; foundByQuoteId = true }
    }

    // ── 3. Dedup: find existing lead for this contact ─────────────────────
    //    Fires when a brand-new quote is created for a contact who already
    //    has a lead. We attach only if no lead_id was specified.
    if (!lead && !leadId && contactId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage, quote_id')
        .eq('contact_id', contactId)
        .neq('stage', 'lost')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      lead = data ?? null
    }

    // ── 4. Auto-create if no lead exists at all ───────────────────────────
    if (!lead) {
      if (quoteId) {
        await supabase.from('leads').insert({
          quote_id:   quoteId,
          contact_id: contactId ?? null,
          stage,
          source:     'quote',
          ...extraInsert,
        })
      }
      return
    }

    // ── 5. Build the update payload ───────────────────────────────────────
    if (lead.stage === 'lost') return   // never auto-move out of lost

    const currentIdx = STAGE_ORDER.indexOf(lead.stage as LeadStage)
    const targetIdx  = STAGE_ORDER.indexOf(stage)

    const patch: Record<string, unknown> = {}

    // Set the primary quote only if:
    //  (a) found via direct leadId lookup and lead has no primary quote yet, OR
    //  (b) found via contact dedup (not yet linked to any quote)
    if (quoteId && !lead.quote_id && (foundByLeadId || (!foundByQuoteId && !foundByLeadId))) {
      patch.quote_id = quoteId
      if (extraInsert.estimated_value  !== undefined) patch.estimated_value  = extraInsert.estimated_value
      if (extraInsert.service_interest !== undefined) patch.service_interest = extraInsert.service_interest
    }

    // Advance stage if target is ahead of current
    if (targetIdx > currentIdx) {
      patch.stage = stage
      if (stage === 'contacted') {
        patch.contacted_at = new Date().toISOString()
      }
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from('leads').update(patch).eq('id', lead.id)
    }
  } catch (err) {
    console.error('[leadSync] advanceLeadStage error:', err)
  }
}
