# KECC CRM — Source-of-Truth Ledger

**Every number in the app → where it comes from, how it's computed, and whether it's been verified against live data.**

This is a *living* document. Per the standing verify-as-you-go rule, whenever a number is checked against the live DB, update its status here. Goal: drive every row to ✅.

Legend: ✅ Verified against live data (date) · ⚠️ Works but has a known issue/risk · ❌ Confirmed wrong/broken · ⬜ Not yet verified

Accounting basis: **CASH** (owner decision). P&L revenue = money actually received (bank-deposit imports). CRM auto-entries (`account='CRM Auto-Entry'`, `category='Active Jobs'`) are accounts-receivable, **excluded** from the cash P&L. See `kecc_finance_cash_basis` memory.

---

## FINANCE

### Total Revenue (Finance → P&L tab) — ✅ Verified 2026-06-02
- **Computed in:** `Finance.tsx` → `calcPLRow()` (sums `INCOME_CATS` only) + `isCashIncome()`.
- **Formula:** Σ `transactions.amount` where `type='Income'` AND `category ∈ INCOME_CATS` (Residential Services, Commercial Services, Subscription Revenue ×3, Other Income), in the period.
- **Source:** `transactions` table, `source='upload'` (bank imports) primarily.
- **Verified:** 2026 cash income = **$15,221.70**. Excludes $875.86 of `CRM Auto-Entry` AR rows. `all type='Income'` rows = $16,097.56; difference is exactly the AR. Logic correct. ✅

### Analytics-tab Revenue (`grossRevenue`, charts, KPIs) — ✅ Verified 2026-06-02
- **Computed in:** `Finance.tsx` → `grossRevenue` memo, `computeMetric('revenue')`, `revByCat`, `priorRevenue` — all now use `isCashIncome()` (fixed 2026-06-01).
- **Status:** Now **agrees with the P&L tab** (both cash-only). Before the fix, Analytics included AR and disagreed. ✅

### Total Expenses — ✅ Verified 2026-06-02
- **Formula:** Σ `transactions.amount` where `type='Expense'` AND `category ∈ EXPENSE_CATS`, in period.
- **Verified:** 2026 expenses = **$14,241.06**. → Net income ≈ **$980.64** (15,221.70 − 14,241.06).

### Accounts Receivable / "unpaid jobs" — ⚠️ Verified 2026-06-02, minor cleanup gap
- **Source:** `transactions` where `account='CRM Auto-Entry'`; `is_unpaid=true` = outstanding.
- **Written by:** `_cascade.ts` → `upsertLeadReceivable()` (one row per lead, flips `is_unpaid` on unpaid→paid). As of 2026-06-02 the cascade fires on **all** stage paths (incl. QB webhook + reminder sweep), so QB-paid and auto-finished jobs now create/reconcile their AR entry (previously they didn't).
- **Verified:** Currently **$0 outstanding** (`is_unpaid=true` → 0 rows). Joan Ewers' $6,739.92 correctly resolved to a single bank deposit (cash income), no double-count. ✅
- ⚠️ **Finding:** 3 paid auto-entries linger ($875.86: Deb/Harrison/Marcia, `is_unpaid=false`, still `Active Jobs`). Harmless to P&L (excluded) but they should be cleared when the matching bank deposit is imported, or AR accumulates dead rows. → improvement: on finished_paid, delete the auto-entry (cash arrives via import) instead of just flipping the flag.

### Fixed vs Variable expense split — ⚠️ NOT trustworthy
- **Computed in:** `Finance.tsx` → `classifyFixedVariable()`.
- **Formula:** an expense is "Fixed" if its normalized description appears in ≥2 distinct months. `normalizeDesc()` truncates to 32 chars + strips digits.
- **Risk:** distinct vendors with similar prefixes merge; a genuinely-fixed cost appearing once is mislabeled. **Do not trust the donut.** → drive off an explicit per-vendor/category flag.

### Balance Sheet — debt / liabilities — ⚠️ now auto-derives credit debt (PENDING live verify)
- **Source:** `balance_sheet_snapshots` (manual assets + loan liabilities) — `chase_ink`, `auto_loan`, `biz_loan`, `other_liab`.
- **2026-06-02 change (staged on local main):** the Balance Sheet now shows a **live auto-derived credit-card debt** row (`computeCreditBalance` over imported `transactions`) with a one-click "Use for Chase Ink" adopt. NON-DESTRUCTIVE — the manual snapshot still drives saved totals until verified.
- **⏳ PENDING (MCP was down):** verify the credit accounts are linked (`account_key` matches `transactions.account`) and the derived number equals reality. If correct, **promote it to the primary credit liability** (replace manual `chase_ink`). If `account_key` is unset, the derived row won't show (returns null) — confirm linkage.
- Loans (`auto_loan`/`biz_loan`) stay manual — a loan balance can't be derived from transactions without principal/amortization. Latest manual snapshot total liab was $2,811.71.

### Credit-account balance — ⚠️ derived (now shared); reconcile with balance sheet
- **Computed in:** `Finance.tsx` → shared `computeCreditBalance(acc, transactions)` = charges − payments on `t.account === acc.accountKey`, floored at 0 (Credit Lines tab + Balance Sheet both use it now).
- **Risk:** only correct if every charge+payment was imported; partial imports → arbitrary balance. ⏳ Verify the linkage + that this single derived number is now the one source of truth for credit debt.

### "Est. Annual Revenue" / forecast KPIs — ⬜ Not verified, suspected double-count
- **Computed in:** `Finance.tsx` AnalyticsTab (~`subARR + closedYTD`, and an "optimistic" line adding `nextMonthForecast×12`).
- **Risk:** subscription revenue likely counted ~twice in the optimistic line; `closedYTD` depends on `quoteType` containing literal `'onetime'`. → verify against actual closed quotes before trusting.

---

## SUBSCRIPTIONS / RECURRING (MRR)

### MRR — ⬜ Not yet verified
- **Source:** `subscriptions.in_season_monthly_total` (and `off_season_monthly_total`) for `status='ACTIVE'`.
- **Note:** the leads→recurring auto-create path sets in-season only (off-season defaults 0) → off-season MRR can read low until re-saved. Churn uses `createdAt` as a paused-since proxy (unreliable; `pause_until`/`cancelled_at` are better). → verify sum of ACTIVE subs vs displayed MRR.

### ARR — ⬜ = MRR × 12 (depends on MRR above).

---

## MARKETING (verified 2026-06-02 against live data; see `kecc_marketing_attribution` memory)

**Live data snapshot:** 27 leads (20 with campaign_id, 7 without), 22 campaign_events (form_submit 7, scan 7, email_click 4, phone_click 4), 17 campaigns, 6 spend rows. The metric *logic* is mostly correct; the *trust problem is the data underneath it* — attribution is largely manual/source-based, the tracked engagement events are sparse and partly orphaned, and several funnels don't reconcile.

### Leads per campaign — ✅ logic verified; ⚠️ attribution is mostly manual, not tracked
- **Rule (confirmed in `campaignMetrics`):** strict `leads.campaign_id` match; `referral` campaigns also loose-match by source via `getLeadChannelId` (source attribution works ONLY for referral-type channels — correct).
- **Verified:** GBP Website Link = **10 leads but 0 tracked events** → those leads were attributed manually / by source-tag, not by a tracked click. Word of Mouth = 7 (referral loose-match, correct). Direct Mail Instant Quote = 2. So the lead *counts* are right, but "tracking" for the biggest channel (GBP) is manual entry, not event-verified.

### Clicks — ⚠️ phone/email clicks are invisible per-campaign
- **Formula (confirmed):** `campaignMetrics` sums `phone_click+email_click+form_submit+ad-click` filtered by `campaignId === cam.id`.
- **Verified problem:** all **8 phone_click+email_click events have NULL campaign_id** → they count toward NO campaign card (anonymous website taps, no campaign context at tap time). Tracked but unused. → either roll them into a channel-level "Website" aggregate or stop logging them.
- ⬜ **Contact Form card shows Clicks=7 (form_submit) but Leads=1** — a 7:1 gap. PENDING: confirm whether the 7 form_submit events are real submissions (6 didn't convert/attribute) or leftover test events whose leads were deleted (events are immutable, so deleted-test leads leave orphan events). *(Supabase MCP was down at check time — re-run.)*

### Views / Scans — ✅ verified; ⚠️ funnels don't reconcile
- **Verified:** scan events Ice Bears = 6, Direct Mail "How KECC Works" = 1 — shown correctly as Views (qr/sponsorship only).
- **Discrepancies:** Ice Bears = 6 scans, **0 leads** (no conversion). Direct Mail Instant Quote = **2 leads, 0 scans** (QR campaign whose leads arrived without a tracked scan). The scan→lead funnel is broken/manual for QR.

### Organic Clicks — ❌ captures nothing
- **Source:** `campaign_events` type `page_view`. **Verified: there are ZERO `page_view` events** in the DB → the "Organic Clicks" KPI is always 0. The organic page_view writer (instant-estimator) isn't producing events (not firing, or no organic traffic). The previously-noted dedup/inflation risk is moot because nothing is logged. (Also 0 `view`/`click` events — those types are dead.)

### Spend per channel / Total Spend — ⚠️ inconsistent (unverified totals)
- **Source:** `marketing_spend` (6 rows). **Issue (code-confirmed):** Channel table + "Best Channel" use raw `amount`; campaign cards + blended KPIs use `effectiveSpend` (prorated). → use one basis. PENDING: verify the 6 spend rows + proration vs displayed totals. *(MCP down.)*

### Closed / Revenue / CPA / CPL / ROI — ⬜ logic verified, totals pending
- **Rule (confirmed):** Closed = calendar job visits in range attributed via quote→campaign (strict) / quote→channel (referral only). Revenue = `revenueFor(closedLeads)`. CPA/CPL/ROI derived. PENDING: verify closed-job counts + revenue vs jobs/quotes data. *(MCP down.)*

**Bottom line on trust:** the marketing *math* is sound, but the *inputs* are thin and partly manual — GBP (your biggest source) is hand-attributed with no tracked events, QR scan→lead funnels don't connect, phone/email taps are logged but orphaned, and organic tracking logs nothing. So the marketing page is directionally OK for leads-per-channel but should NOT be trusted as a precise tracked funnel. Highest-value fixes: roll orphan phone/email clicks into a channel aggregate, fix/confirm the QR scan→lead linkage, and either fix or remove organic tracking + the dead event types.

---

## SALES PIPELINE

### Lead stage counts (kanban) — ⬜ direct `leads.stage` group-by.
### Jobs completed — ⬜ `countJobsDone()` (leads finished_* + subscription occurrences). Subscription-occurrence math is duplicated between Finance + Calendar (drift risk).
### Quote / amendment totals — ✅ unified (2026-06-02, staged)
- Both the displayed total (Leads.tsx) and the saved revision total (`quotes.ts`) now use the single shared `src/lib/quoteMath.ts` (`buildRevisedLineItems` + `computeAmendedTotal`). The backend's old delta-arithmetic (which made saved revisions diverge — Joan Ewers $250-low) is gone. They can't diverge again.
- ⏳ DATA CHECK (MCP down): existing revision rows (`quotes.revised_from_id` not null) created before this fix may carry stale totals — query and reconcile when MCP recovers.

---

## VERIFICATION COVERAGE (update as we go)
| Area | Verified | Notes |
|---|---|---|
| Finance — cash P&L revenue/expenses/net | ✅ | 2026-06-02, numbers reconcile |
| Finance — AR | ✅ | $0 outstanding; lingering-paid-rows finding |
| Finance — balance sheet debt | ❌ | manual, doesn't auto-derive |
| Finance — fixed/variable | ⚠️ | heuristic, untrustworthy |
| Finance — forecasts | ⬜ | suspected double-count |
| MRR / ARR | ⬜ | |
| Marketing — leads/scans logic | ✅ | 2026-06-02; logic sound, attribution mostly manual |
| Marketing — clicks/organic | ⚠️ | phone/email clicks orphaned (null campaign); 0 page_view events (organic logs nothing) |
| Marketing — spend/closed/revenue totals | ⬜ | PENDING — Supabase MCP was down; re-run form_submit-reality + spend + closed checks |
| Pipeline counts | ⬜ | |
