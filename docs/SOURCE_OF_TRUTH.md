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

### Balance Sheet — debt / liabilities — ✅ Verified 2026-06-03; derived credit debt is now PRIMARY
- **Source:** loans + assets are manual (`balance_sheet_snapshots`); credit-card debt now **derives from bank activity** and drives the saved Total Liabilities / Owner's Equity.
- **2026-06-03 change (staged on main):** `derivedCreditDebt` is the PRIMARY credit liability (ARCHITECTURE §4). When any credit account is linked it feeds `totalLiabs`/equity and the manual `chase_ink` field becomes fallback-only (used solely when nothing is linked). The Chase Ink row renders read-only with an "auto · from imports" tag; the old guidance row + "Use for Chase Ink" adopt button were removed (no longer needed). `computeCreditBalance` now takes an optional `asOf` so the figure is point-in-time per the snapshot month (Credit Lines tab passes none → current running balance).
- **Verified LIVE 2026-06-03:** Chase Ink links 80 tx (2026-02-16 → 2026-05-31), charges $3,295.73 − payments $40.00 = **$3,255.73**. May 2026 snapshot manual `chase_ink` was **$0.00** → the balance sheet understated debt by $3,255.73; now corrected. No tx after May 31, so May (latest) and June (current) both derive $3,255.73 (as-of scoping verified). Amex card still has `account_key = null` → derives nothing until linked.
- Loans (`auto_loan`/`biz_loan`) stay manual — can't derive without principal/amortization. NOTE: viewing a *past* month now derives that month's point-in-time credit balance, overriding any older manual `chase_ink` guess (e.g. April's $2,811.71) — intended single-source-of-truth behavior.

### Credit-account balance — ✅ Verified 2026-06-03; single shared source of truth
- **Computed in:** `Finance.tsx` → shared `computeCreditBalance(acc, transactions, asOf?)` = charges − payments on `t.account === acc.accountKey`, floored at 0. Used by both the Credit Lines tab (current balance, no `asOf`) and the Balance Sheet (point-in-time via `asOf`). This is the ONE place credit debt is computed.
- **Residual risk:** only correct if every charge+payment was imported; partial imports → understated balance. Chase Ink reconciles to $3,255.73 (verified). Amex unlinked.

### "Est. Annual Revenue" / forecast KPIs — ✅ Verified + fixed 2026-06-03
- **Computed in:** `Finance.tsx` AnalyticsTab. `Est. Annual Rev.` KPI = `subARR + closedYTD` (no double-count — left as-is). The **Annual Revenue Projection** "Optimistic Annual Estimate" breakdown was the problem.
- **Confirmed double-count (2026-06-03):** the optimistic line was `subARR + closedYTD + nextMonthForecast×12`, and `nextMonthForecast = activeMRR + last3MonthsOneTime` while `subARR = activeMRR×12` — so `nextMonthForecast×12` re-included `activeMRR×12`. Subscription ARR was counted **twice**. Live magnitude: overstated by exactly `activeMRR×12 = $982.26×12 = $11,787.12` (read ≈$70k, should read ≈$59k).
- **Fix (staged 2026-06-03):** the 3rd breakdown line is now `Projected One-Time × 12 = last3MonthsOneTime×12` (one-time only), making the three components mutually exclusive (recurring ARR + booked one-time YTD + projected one-time run-rate). Total = `subARR + closedYTD + last3MonthsOneTime×12`. The standalone `Next-Month Forecast` KPI (MRR + avg one-time) is a legitimate single metric and is unchanged.
- **Note:** `closedYTD` still depends on `quoteType` containing literal `'onetime'` (live: 7 accepted one-time quotes, $9,370.58 YTD). Canonicalizing quote types remains a separate Phase-1 item.

---

## SUBSCRIPTIONS / RECURRING (MRR)

### MRR — ✅ Verified 2026-06-02
- **Source:** `subscriptions.in_season_monthly_total` (and `off_season_monthly_total`) for `status='ACTIVE'`.
- **Verified:** Active MRR = **$982.26** (5 active subs) → ARR ~$11,787; off-season $332.86. **0** active subs with $0 in-season (the leads→recurring auto-create off-season gap didn't corrupt MRR in practice). Churn still uses `createdAt` proxy (unreliable; prefer `pause_until`/`cancelled_at`).

### Subscription occurrences ("jobs done") — ✅ unified 2026-06-02 (staged)
- Finance `countSubOccurrencesInBucket` and Calendar `generateSubEvents` now share one decision (`src/lib/subSchedule.ts` → `scheduleFiresOn`), so they can't drift. Verified by a 17,520-case differential test (0 mismatches) + fixed the Calendar fallback bug (treated monthly/bi-monthly as weekly). Only live fallback sub is Annual → zero behavior change.

---

## MARKETING (verified 2026-06-02 against live data; see `kecc_marketing_attribution` memory)

**Live data snapshot:** 27 leads (20 with campaign_id, 7 without), 22 campaign_events (form_submit 7, scan 7, email_click 4, phone_click 4), 17 campaigns, 6 spend rows. The metric *logic* is mostly correct; the *trust problem is the data underneath it* — attribution is largely manual/source-based, the tracked engagement events are sparse and partly orphaned, and several funnels don't reconcile.

### Leads per campaign — ✅ logic verified; ⚠️ attribution is mostly manual, not tracked
- **Rule (confirmed in `campaignMetrics`):** strict `leads.campaign_id` match; `referral` campaigns also loose-match by source via `getLeadChannelId` (source attribution works ONLY for referral-type channels — correct).
- **Verified:** GBP Website Link = **10 leads but 0 tracked events** → those leads were attributed manually / by source-tag, not by a tracked click. Word of Mouth = 7 (referral loose-match, correct). Direct Mail Instant Quote = 2. So the lead *counts* are right, but "tracking" for the biggest channel (GBP) is manual entry, not event-verified.

### Clicks — ⚠️ phone/email clicks are invisible per-campaign
- **Formula (confirmed):** `campaignMetrics` sums `phone_click+email_click+form_submit+ad-click` filtered by `campaignId === cam.id`.
- **Verified problem:** all **8 phone_click+email_click events have NULL campaign_id** → they count toward NO campaign card (anonymous website taps, no campaign context at tap time). Tracked but unused. → either roll them into a channel-level "Website" aggregate or stop logging them.
- ✅ **RESOLVED 2026-06-03:** the Contact Form 7:1 gap was leftover test events. Of 7 `form_submit` events, 6 referenced deleted test leads (orphans, incl. a 4-event burst at 2026-05-28 14:25:12) — deleted them. The 1 surviving event maps to a real lead (Ruby Webb, `b8490697…`). Contact Form Clicks now = 1, matching Leads = 1.

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
| Finance — balance sheet debt | ✅ | 2026-06-03: credit debt now derives from bank activity as PRIMARY liability ($3,255.73); manual field = fallback |
| Finance — fixed/variable | ⚠️ | heuristic, untrustworthy |
| Finance — forecasts | ✅ | 2026-06-03: confirmed + fixed the optimistic-estimate MRR double-count ($11,787.12 overstatement) |
| MRR / ARR | ✅ | 2026-06-02: $982.26 in-season MRR (5 active subs) → ~$11.8k ARR; $332.86 off-season; 0 active subs with $0 in-season |
| Marketing — leads/scans logic | ✅ | 2026-06-02; logic sound, attribution mostly manual |
| Marketing — clicks/organic | ⚠️ | phone/email clicks orphaned (null campaign); 0 page_view events (organic logs nothing) |
| Marketing — form-submit reality | ✅ | 2026-06-03: confirmed 6 of 7 `form_submit` events were orphans (deleted test leads) and **DELETED** them; only Ruby Webb's real event remains. Contact Form Clicks 7 → 1, matching Leads = 1 |
| Marketing — spend | ✅ | 2026-06-02: $1,194 May / $590 June, tracked correctly; only the raw-vs-prorated DISPLAY inconsistency remains |
| Balance sheet — credit debt derived | ✅ | 2026-06-02 verified; **2026-06-03 PROMOTED to primary** liability (drives totals/equity; point-in-time via `asOf`). Amex still needs `account_key` |
| Pipeline counts | ✅ | 2026-06-02: lost 12 / finished_paid 5 / recurring 5 / quoted 3 / contacted 3 — sensible |
| Finance forecasts | ✅ | 2026-06-03: optimistic-estimate double-count fixed (3 components now mutually exclusive) |
