/**
 * Terms & Conditions shown as fine print on EVERY signable quote (one-time and
 * recurring). Rendered by both the e-sign HTML page (`netlify/functions/esign.ts`
 * → buildQuotePage) and the quote PDF (`netlify/functions/pdf-quote.ts`).
 *
 * ONE source of truth (ARCHITECTURE §4): edit the clauses here and both surfaces
 * update — never re-type the language in a renderer. Derived/condensed from the
 * recurring service-agreement clauses in esign.ts (Access/Scheduling/Safety and
 * Scope Limitations & Exclusions). This quote-stage fine print does not replace the
 * full service agreement, which still follows for recurring plans and governs the
 * ongoing relationship once signed.
 *
 * NOTE (not legal advice): these clauses are intended to protect KECC against common
 * disputes. Consider a quick attorney review before relying on them in a dispute.
 */

export const QUOTE_TERMS_TITLE = 'Terms & Conditions'

export interface QuoteTermClause {
  /** Short bold lead-in (rendered as "Heading." in fine print). */
  heading: string
  /** Clause body. */
  body: string
}

// Universal clauses — included on every quote.
const UNIVERSAL: QuoteTermClause[] = [
  {
    heading: 'Scope of Estimate',
    body:
      'This estimate covers only the services and items expressly listed above. Work requiring specialty trades ' +
      '(roofing, structural, electrical, plumbing, HVAC, or major concrete/asphalt) and any item not listed are out of ' +
      'scope and quoted separately. Pricing is valid for 30 days and assumes typical property conditions; material ' +
      'changes in scope, size, or condition may require an adjusted quote.',
  },
  {
    heading: 'Existing Damage & Pre-Existing Conditions',
    body:
      'Knox Exterior Care Co. (KECC) is not liable or responsible for pre-existing damage, existing defects, aging or ' +
      'failing materials, or for damage arising from existing flaws or deferred maintenance in the structure or property. ' +
      'Minor disturbance or wear of delicate or aged surfaces may occur despite reasonable care.',
  },
  {
    heading: 'Undisclosed & Hidden Conditions',
    body:
      'KECC is not responsible for damage to underground utilities, irrigation, unmarked obstacles, or items hidden in ' +
      'turf or work areas that were not disclosed before work begins (hoses, cables, wiring, sprinkler heads, toys, ' +
      'decor, and similar).',
  },
  {
    heading: 'Access & Safety',
    body:
      'Customer will provide safe, reasonable access to the work areas (gates, codes, and restraint of animals). KECC ' +
      'may skip, modify, or reschedule work when conditions are unsafe or impractical, including severe weather, unsafe ' +
      'ladder or roof access, hazardous materials, or blocked or active work areas.',
  },
  {
    heading: 'Scheduling, Weather & Acts of God',
    body:
      'KECC reserves the right to alter, delay, or reschedule service days and times for holidays, weather, Acts of God, ' +
      'safety, staffing, or routing needs. KECC is not liable for loss of business, lost revenue, or other consequential ' +
      'or incidental damages arising from schedule changes, delays, or events outside its reasonable control, and ' +
      'Customer agrees to hold KECC harmless from the same.',
  },
  {
    heading: 'Results',
    body:
      'Cleaning and maintenance outcomes vary with the age, material, and condition of the surfaces treated; KECC does ' +
      'not warrant the removal of all stains, organic growth, oxidation, or discoloration. De-icing or salting reduces ' +
      'but does not eliminate slip hazards, and the property owner remains responsible for overall site safety.',
  },
  {
    heading: 'Payment',
    body:
      'Unless otherwise stated in writing, payment for one-time work is due upon completion. Past-due balances may be ' +
      'subject to reasonable late charges and the costs of collection.',
  },
]

// Additional clauses included only when the quote contains recurring service.
const RECURRING: QuoteTermClause[] = [
  {
    heading: 'Recurring Scheduling',
    body:
      'Recurring services are scheduled by route, season, and weather, and specific dates or times are not guaranteed. ' +
      'KECC may adjust which tasks are emphasized and when they are performed across the year while keeping the overall ' +
      'annual service level consistent. Visits skipped or delayed for weather or access may be rolled into a future ' +
      'visit, as recurring pricing reflects blended annual value rather than a per-visit charge.',
  },
  {
    heading: 'Recurring Billing & Cancellation',
    body:
      'Recurring plans bill on a pay-ahead basis, with each payment covering the upcoming month. Either party may cancel ' +
      'with written notice; upon cancellation, services already delivered are reconciled against payments collected at ' +
      'KECC’s standard non-subscriber rates and any difference is settled or refunded. A separate service agreement ' +
      'will follow for recurring plans and, once signed, governs the ongoing relationship.',
  },
]

/**
 * The terms to print on a quote. Pass `includeRecurring = true` when the quote
 * contains any recurring/subscription line item so the recurring clauses are added.
 */
export function getQuoteTerms(includeRecurring: boolean): QuoteTermClause[] {
  return includeRecurring ? [...UNIVERSAL, ...RECURRING] : UNIVERSAL
}
