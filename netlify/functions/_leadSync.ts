/**
 * _leadSync.ts — shared lead-pipeline automation helper
 *
 * Call advanceLeadStage() from any Netlify function after a significant
 * event. It will:
 *   - Find the linked lead by quoteId (preferred) or contactId
 *   - Move it forward if the new stage is ahead of the current one
 *   - Never go backwards, never leave 'lost' automatically
 *   - Auto-create a lead (stage = 'quoted') when a quote is first created
 */

import { SupabaseClient } from '@supabase/supabase-js'

// Must match the LeadStage type in src/types.ts — order matters
const STAGE_ORDER = [
  'new',
  'contacted',
  'quoted',
  'scheduled',
  'finished',
  'recurring',
  'unpaid',
  'paid',
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
  /** Extra fields to set on auto-created leads */
  extraInsert?: Record<string, unknown>
}

/**
 * Advance a lead's stage, or auto-create one if none exists.
 * Safe to await — any DB errors are caught and logged (non-fatal).
 */
export async function advanceLeadStage(
  supabase: SupabaseClient,
  { quoteId, contactId, stage, extraInsert = {} }: SyncOptions
): Promise<void> {
  try {
    let lead: { id: string; stage: string } | null = null

    // ── 1. Look up by quoteId first ───────────────────────────────────────
    if (quoteId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('quote_id', quoteId)
        .limit(1)
        .single()
      lead = data ?? null
    }

    // ── 2. Fall back to most-recent lead for this contact ─────────────────
    if (!lead && contactId) {
      const { data } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      lead = data ?? null
    }

    // ── 3. Auto-create if still not found (first-touch from quote) ────────
    if (!lead && quoteId) {
      await supabase.from('leads').insert({
        quote_id:   quoteId,
        contact_id: contactId ?? null,
        stage,
        source:     'quote',
        ...extraInsert,
      })
      return
    }

    if (!lead) return // no quoteId and no contactId match — skip

    // ── 4. Only advance, never regress, never leave 'lost' ───────────────
    if (lead.stage === 'lost') return

    const currentIdx = STAGE_ORDER.indexOf(lead.stage as LeadStage)
    const targetIdx  = STAGE_ORDER.indexOf(stage)

    if (targetIdx > currentIdx) {
      await supabase.from('leads').update({ stage }).eq('id', lead.id)
    }
  } catch (err) {
    // Non-fatal: log but never crash the parent request
    console.error('[leadSync] advanceLeadStage error:', err)
  }
}
