# KECC CRM — Architecture & Patterns

The conventions this codebase *should* follow — the scaffolding it never had. This is the spec for Phase-1 hardening (and the rule set for any new code). Where current code violates a rule, it's flagged **⚠️ GAP**.

---

## 1. Layering & request flow
```
React SPA ──apiGet/apiRequest──> Netlify Function ──service-role──> Supabase Postgres
         (Authorization: Bearer)   (requireAuth gate)               (RLS on, no policies)
```
- The SPA **never** talks to Supabase directly. All data flows through Netlify Functions.
- One client helper: `src/lib/queryClient.ts` (`apiGet`/`apiRequest`) + a global `fetch` interceptor (`src/lib/auth.ts`) that attaches the token to every `/.netlify/functions/*` call and shows the login overlay on 401.
- DB access is **service-role only** (functions). RLS-on + no-policies means the anon key is inert — the function layer is the only door.

## 2. THE cascade rule (most important — fixes "data doesn't sync everywhere")
**There must be exactly ONE way to change `leads.stage`, and it must always run the cascade.**
- `advanceLeadStage()` (`_leadSync.ts`) is the only sanctioned lead-stage mutator. It must call `handleLeadStageChange()` (`_cascade.ts`) whenever it actually changes the stage — so Finance/AR entries, activity logs, and review queuing fire on *every* path.
- **⚠️ GAP (current):** `handleLeadStageChange` is called by **only `leads.ts`**. But `advanceLeadStage` is also called by `quotes.ts`, `jobs.ts`, `esign.ts`, `subscriptions.ts`, and `send-reminders.ts` + `qb.ts` mutate `leads.stage` with raw updates — none trigger the cascade. Result: customer signs online / QB pays / auto-sweep → no finance/AR entry, no review. **This is the #1 structural fix.**
- Rule: no function may write `leads.stage` directly. Route everything through `advanceLeadStage`, and have it own the cascade call.

## 3. Idempotency & dedup
- **Every auto-generated `transactions` row uses a stable `source` key** so it can be reconciled, never duplicated. Convention: `lead:<id>` (cascade AR), `job:<id>`, `quote:<id>`. Insert-or-update on that key (see `upsertLeadReceivable`).
- **⚠️ GAP:** historically three insert paths used three different/absent keys → double-counting. Consolidate so one sale = one row, keyed per-lead.
- Subscriptions: one live sub per contact (guarded in `subscriptions.ts` + `leads.ts`). Prefer a partial unique index `(contact_id) WHERE status NOT IN (retired)`.

## 4. Single source of truth for every number
- **Finance = cash basis.** Revenue counts a transaction only if `category ∈ INCOME_CATS` (bank-import income). Auto-entries (`CRM Auto-Entry`/`Active Jobs`) are AR, excluded. Use the shared `isCashIncome()` predicate **everywhere** revenue is summed (P&L, Analytics, dashboard) — never re-derive inline. See `SOURCE_OF_TRUTH.md`.
- **Quote/amendment math:** ONE module, imported by both frontend and `quotes.ts`. ⚠️ GAP: currently duplicated (`Leads.tsx` correct, `quotes.ts` stale delta-arithmetic). Extract to a shared `_quoteMath` importable by functions.
- **MRR:** ONE function over `subscriptions` (ACTIVE, in/off-season). ⚠️ GAP: subscription-occurrence math duplicated between Finance and Calendar.
- **Debt/liabilities:** pick one source. ⚠️ GAP: `balance_sheet_snapshots` (manual) vs `credit_accounts` (derived) disagree; balance sheet should derive liabilities from bank activity.
- Rule: a number is computed in exactly one place; every consumer imports it.

## 5. Shared function boilerplate (`_http.ts`)
Today every function re-declares the Supabase client, CORS, error shape, and path parsing (39 copies; `{error}` vs `{message}` split). Extract one module:
```ts
// _http.ts (target)
export const supabase = createClient(URL, SERVICE_ROLE_KEY)   // one client
export const cors = (opts?) => ({...})                        // locked origins
export const json = (status, body) => ({ statusCode, headers: cors(), body: JSON.stringify(body) })
export const parsePath = (event, name) => string[]            // id/segments
export const withAuth = (handler) => ...                      // wraps requireAuth
```
All handlers compose these. Benefit: a CORS/auth/error change is a one-file edit, not 39.

## 6. Naming & enums (centralize)
- Status strings live in `src/types.ts` as single constants, imported by both app and functions. ⚠️ GAP: `CANCELED`/`CANCELLED` drift caused real bugs. No string enum should be hand-typed twice.
- Quote types: canonical set only (no Calculator-invented `*_recurring`).

## 7. Data sync rules (denormalization)
- Contacts are the source of truth for customer identity. Denormalized copies on quotes/jobs/subscriptions/service_agreements are **caches**, kept in sync by `contacts.ts` PATCH cascade. Leads carry no denormalized identity (reference `contact_id`).
- Rule: when a feature reads a customer name/phone, prefer the contact; use the cache only as fallback.

## 8. Frontend conventions
- **Decompose god-files.** Target: no page-component file > ~800 lines. Leads/Finance/Marketing/Calendar each become `pages/<x>/` with extracted sheets, cards, and a `useXMetrics` hook. Metric math lives in hooks/lib, not inline in JSX.
- **TanStack Query** for all server state: `useQuery({ queryKey: ['/endpoint'] })`, `useMutation` + `invalidateQueries`. queryKey = the endpoint path.
- **No raw `fetch`** for new code — use `apiGet`/`apiRequest` (the interceptor covers existing raw fetches but new code should use the helpers).
- One shared component per concept (one `ContractorCard`, one signature pad, one schedule-job hook) — no verbatim copies.

## 9. Security model
- `requireAuth(event, CORS)` at the top of every owner-only function; per-action for mixed functions (OAuth callbacks, webhooks, token-signing pages stay public — explicit allow-list).
- Fail-open until `AUTH_SECRET`+`APP_PASSWORD` set, then fail-closed. New functions are auth'd by default — adding a function without `requireAuth` is a review red flag.
- TODO (defense-in-depth): lock CORS to the app origin for protected endpoints; sanitize `.or()` filter interpolation; token-gate `pdf-quote`/`pdf-subscription`.

## 10. Verification discipline (standing rule)
- Whenever you touch a part of the CRM, **verify its behavior/numbers against live data** before moving on, and record the result in `SOURCE_OF_TRUTH.md`. Trust is rebuilt by verification, not by rewriting.
- After any large deletion/refactor: run **both** `npm run build` (bundles) **and** `tsc --noEmit` (catches undefined-name/type breaks the bundler misses).

---

## Phase plan (how we get there without a rewrite)
- **Phase 0 — docs (this):** DATA_MODEL, SOURCE_OF_TRUTH, FEATURE_INVENTORY, ARCHITECTURE. ✅
- **Phase 1 — harden the backend in place:** extract `_http.ts`; centralize the cascade (rule #2); unify quote-math + MRR + dedup keys; verify each finance/marketing number vs live data (fill the ledger). Backend is small (~150 lines/fn) and mostly good.
- **Phase 2 — rebuild the frontend god-files page-by-page** against the hardened API, applying §8. Ship each page when verified; never go dark.

Each step is independently shippable and leaves the live CRM working.
