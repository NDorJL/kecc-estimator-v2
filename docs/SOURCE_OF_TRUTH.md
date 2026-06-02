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
- **Written by:** `_cascade.ts` → `upsertLeadReceivable()` (one row per lead, flips `is_unpaid` on unpaid→paid).
- **Verified:** Currently **$0 outstanding** (`is_unpaid=true` → 0 rows). Joan Ewers' $6,739.92 correctly resolved to a single bank deposit (cash income), no double-count. ✅
- ⚠️ **Finding:** 3 paid auto-entries linger ($875.86: Deb/Harrison/Marcia, `is_unpaid=false`, still `Active Jobs`). Harmless to P&L (excluded) but they should be cleared when the matching bank deposit is imported, or AR accumulates dead rows. → improvement: on finished_paid, delete the auto-entry (cash arrives via import) instead of just flipping the flag.

### Fixed vs Variable expense split — ⚠️ NOT trustworthy
- **Computed in:** `Finance.tsx` → `classifyFixedVariable()`.
- **Formula:** an expense is "Fixed" if its normalized description appears in ≥2 distinct months. `normalizeDesc()` truncates to 32 chars + strips digits.
- **Risk:** distinct vendors with similar prefixes merge; a genuinely-fixed cost appearing once is mislabeled. **Do not trust the donut.** → drive off an explicit per-vendor/category flag.

### Balance Sheet — debt / liabilities — ❌ Does not auto-generate (owner's complaint)
- **Source:** `balance_sheet_snapshots` — **manually hand-entered** (`chase_ink`, `auto_loan`, `biz_loan`, `other_liab`).
- **Verified:** latest snapshot total liabilities = **$2,811.71** (manual). NOT derived from `transactions` or `credit_accounts`.
- ❌ **This is the gap you flagged.** Debt totals don't update from bank activity because they're a static snapshot. → wire liabilities to derive from credit-account balances + loan-payment transactions, or at least surface the derived `credit_accounts` balance alongside.

### Credit-account balance — ⚠️ derived, unreconciled with balance sheet
- **Computed in:** `Finance.tsx` → `computeBalance()` = charges − payments from linked `transactions`, floored at 0.
- **Risk:** only correct if every charge+payment was imported; partial imports → arbitrary-looking balance. And it's a **second, separate** debt number from `balance_sheet_snapshots.chase_ink`. → pick one source of truth.

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

## MARKETING (see `kecc_marketing_attribution` memory)

### Spend per channel / Total Spend — ⚠️ inconsistent
- **Source:** `marketing_spend.amount`. **Issue:** Channel table + "Best Channel" use raw `amount`; blended KPIs + campaign cards use `effectiveSpend` (prorated by elapsed days). So channel spend ≠ Total Spend for the current month. → use one basis.

### Leads per campaign — ⬜ Not yet verified
- **Rule:** strict `leads.campaign_id` match for all types EXCEPT `referral` (also loose-matches by `source`).

### Clicks — ⬜ event-based (good design)
- **Formula:** Σ immutable `campaign_events` of type `phone_click+email_click+form_submit+click` (survives lead deletion). Note `email_click`/`view` have no production writer.

### Closed / Revenue per campaign — ⬜ Not yet verified
- **Rule:** calendar job visits in range attributed via quote→campaign (strict) or quote→channel (referral). Revenue from closed leads' quote totals.

### CPA / CPL / ROI — ⬜ derived from the above (inherits their issues).

### Organic Clicks — ⚠️ inflated
- **Source:** `campaign_events` type `page_view` with null campaign. **Issue:** the organic `page_view` writer has no dedup/bot filter (unlike scan/click) → reloads inflate it. → relabel "Organic Page Views" or add dedup.

---

## SALES PIPELINE

### Lead stage counts (kanban) — ⬜ direct `leads.stage` group-by.
### Jobs completed — ⬜ `countJobsDone()` (leads finished_* + subscription occurrences). Subscription-occurrence math is duplicated between Finance + Calendar (drift risk).
### Quote / amendment totals — ✅ frontend fixed (sums `buildRevisedLineItems`); ⚠️ backend `quotes.ts` still uses the old delta-arithmetic → revision rows can diverge. → unify into one shared module.

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
| Marketing — all metrics | ⬜/⚠️ | spend-basis + organic-dedup issues |
| Pipeline counts | ⬜ | |
