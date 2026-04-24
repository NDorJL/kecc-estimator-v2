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
  { quoteId, contactId, stage, extraInsert = {} }: SyncOptions
): Promise<void> {
  try {
    let lead: { id: string; stage: string } | null = null
    let foundByQuoteId = false

    // ── 1. Look up by quoteId first (quote already linked) ───────────────
    if (quoteId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('quote_id', quoteId)
        .limit(1)
        .single()
      if (data) { lead = data; foundByQuoteId = true }
    }

    // ── 2. Dedup: find existing lead for this contact ─────────────────────
    //    This fires when a brand-new quote is created for a contact who
    //    already has a lead (e.g. from a manual entry or earlier form).
    //    We attach the quote to that lead instead of creating a duplicate.
    if (!lead && contactId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      lead = data ?? null
      // foundByQuoteId stays false → we'll write quote_id onto this lead below
    }

    // ── 3. Auto-create if no lead exists at all ───────────────────────────
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

    // ── 4. Build the update payload ───────────────────────────────────────
    if (lead.stage === 'lost') return   // never auto-move out of lost

    const currentIdx = STAGE_ORDER.indexOf(lead.stage as LeadStage)
    const targetIdx  = STAGE_ORDER.indexOf(stage)

    const patch: Record<string, unknown> = {}

    // Attach quote to existing contact lead (dedup case)
    if (!foundByQuoteId && quoteId) {
      patch.quote_id = quoteId
      // Also pull in value + service interest from the new quote
      if (extraInsert.estimated_value  !== undefined) patch.estimated_value  = extraInsert.estimated_value
      if (extraInsert.service_interest !== undefined) patch.service_interest = extraInsert.service_interest
    }

    // Advance stage if target is ahead of current
    if (targetIdx > currentIdx) {
      patch.stage = stage
      // Stamp contacted_at the first time a lead enters the 'contacted' stage
      if (stage === 'contacted') {
        patch.contacted_at = new Date().toISOString()
      }
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from('leads').update(patch).eq('id', lead.id)
    }
  } catch (err) {
    // Non-fatal: log but never crash the parent request
    console.error('[leadSync] advanceLeadStage error:', err)
  }
}
