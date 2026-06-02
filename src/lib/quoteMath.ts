/**
 * quoteMath.ts — the single source of truth for quote amendment/revision math.
 *
 * Imported by BOTH the frontend (Leads.tsx) and the backend (netlify/functions/quotes.ts)
 * so the total the customer sees can never diverge from the total saved to the revision
 * quote. Pure functions — no React, no DB, no environment dependencies.
 *
 * Convention matches initial quote totals (Calculator/Quotes): sum of one-time line
 * items' lineTotal, minus discount. We deliberately do NOT use delta arithmetic
 * (originalTotal + Σ amendment deltas) — that double-subtracts when a line item has both
 * an adjustment and a removal, and double-applies when original_total is stale. (This is
 * the bug that made Joan Ewers' quote read $250 low.) Rebuilding the line items and
 * summing them is immune to both.
 */
import type { LineItem, QuoteAmendment } from '../types'

/**
 * Bake all amendments into a clean revised line-item list:
 * adjustments replace the original, removals are excluded, additions are appended.
 * The Map keyed by lineItemId guarantees one effect per line item (most recent wins).
 */
export function buildRevisedLineItems(lineItems: LineItem[], amendments: QuoteAmendment[]): LineItem[] {
  const amendByItemId = new Map(
    amendments.filter(a => a.lineItemId).map(a => [a.lineItemId!, a]),
  )
  const result: LineItem[] = lineItems
    .filter(li => amendByItemId.get(li.serviceId)?.type !== 'removal')
    .map(li => {
      const a = amendByItemId.get(li.serviceId)
      if (a?.type === 'adjustment') {
        const newAmt = a.newAmount ?? li.lineTotal
        return {
          ...li,
          serviceName: a.newName ?? li.serviceName,
          description: a.newDescription ?? li.description,
          unitPrice: newAmt,
          lineTotal: newAmt,
        }
      }
      return li
    })
  amendments.filter(a => a.type === 'addition').forEach(a => {
    result.push({
      serviceId: `amend_${a.id}`,
      serviceName: a.label,
      category: 'Supplemental',
      description: a.addedDescription,
      quantity: 1,
      unitPrice: a.addedAmount ?? 0,
      lineTotal: a.addedAmount ?? 0,
      isSubscription: false,
    })
  })
  return result
}

/**
 * Current one-time total after all amendments are applied:
 * sum of revised non-subscription line items, minus discount.
 * Returns `fallbackTotal` when there are no amendments.
 */
export function computeAmendedTotal(
  lineItems: LineItem[],
  amendments: QuoteAmendment[],
  discount = 0,
  fallbackTotal = 0,
): number {
  if (!amendments || amendments.length === 0) return fallbackTotal
  const revised = buildRevisedLineItems(lineItems, amendments)
  const onetime = revised
    .filter(li => !li.isSubscription)
    .reduce((s, li) => s + (li.lineTotal ?? 0), 0)
  return onetime - (discount ?? 0)
}
