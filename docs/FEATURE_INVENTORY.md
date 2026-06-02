# KECC CRM — Feature Inventory

Every feature, by page, marked **KEEP** (works / wanted) · **FIX** (wanted but broken/unreliable) · **CUT** (obsolete/unneeded) · **BUILD** (missing, should exist). Status reflects the 2026-06 audit + verification. Generated 2026-06-02. Current surface: **14 pages, 41 functions**.

> This is the "overbuilt/underbuilt" list made explicit. Use it to decide what the rebuilt/​hardened CRM keeps.

---

## Dashboard (`/`)
- KEEP — KPI cards (revenue, leads, jobs), open-quotes list, notifications/reminders.
- FIX — any revenue/profit KPI here must use the cash-basis `isCashIncome` rule (verify it matches Finance).
- CUT — *(done)* dead "quick nav" block (removed 2026-06-01).

## Contacts (`/contacts`) + Contact Detail (`/contacts/:id`)
- KEEP — contact CRUD; type/source/tags; properties sub-list; activity timeline; quotes/subs/agreements tabs; **Contractors tab** (now the sole contractor surface).
- FIX — Source dropdown differs between create (18 opts) and edit (5 opts) → editing can blank marketing attribution. Quotes/Subs tabs fetch the *entire* global list then filter client-side (add `?contactId=`).
- FIX — contact-edit cascade doesn't persist `address` to the contact (address lives on properties) → agreement address sync is a no-op.
- CUT — "Jobs (Phase 3)" and "Invoices (Phase 4)" placeholder tabs.
- BUILD — property edit/delete UI (backend endpoints exist, no UI); address autocomplete/geocode (lat/lng never captured).

## Leads (`/leads`) — kanban pipeline
- KEEP — drag-drop kanban; lead detail sheet; quote attach; send quote/agreement; photo stacks; stage automation.
- FIX — new-lead address not pre-filled into Calculator; multiple-quotes-per-lead "primary quote" ambiguity; identity shown from quote not contact (can go stale).
- FIX — ~3,900-line god-file → decompose (`components/leads/*`).
- DECIDE — per-lead photo stacks (heavy DnD) — confirm still used; consider simplifying.

## Calendar (`/calendar`)
- KEEP — month/day/year views; drag-to-schedule; `UniversalEventSheet`; subscription recurrence; Google sync.
- FIX — **drag-drop "specific time" is silently lost** (writes `start_time`, render/Google read `scheduled_time`); recurrence engine hand-rolled + duplicated (extract/​test); ~1,700-line file (down from 2,620) still large.
- CUT — *(done)* 3 legacy Add-Event sheets (removed 2026-06-01).

## Jobs (`/jobs`)
- KEEP — job list/detail; complete-job flow; reschedule SMS; subscription schedule sheet.
- FIX — **no status-transition validation** (completed→scheduled allowed; `completed_at` never clears); re-saving a completed job re-texts owner; multi-day jobs can be marked finished on day 1 (sweep ignores `scheduled_end_date`).

## Calculator (`/calculator`) — quote builder
- KEEP — pricing engine (`pricing.ts`), line items, option groups, direct quote create.
- FIX — invents `*_recurring` quote types the rest of the app doesn't handle (blank edit dropdowns, mangled badges) → align to canonical 6 types; type-unsafe Contact prefill cast.

## Quotes (`/quotes`)
- KEEP — quote list; send (email/SMS); e-sign link; amendment/revision chain; trash.
- FIX — **amendment math duplicated** (frontend fixed, backend `quotes.ts` still delta-arithmetic → revision totals diverge) → one shared module; two quote-creation paths with divergent type logic; dead `expires_at` UI (never set).

## Subscriptions (`/subscriptions`)
- KEEP — sub list/detail; pause/cancel; change history; seasonal in/off-season totals.
- FIX — `pause_until` not auto-enforced (no cron reactivates); off-season total omitted on leads→recurring auto-create; churn uses `createdAt` proxy.
- KEEP (fixed) — dedup guard + CANCELED spelling (2026-06-01).

## Finance (`/finance`)
- KEEP — transactions ledger; CSV/PDF bank import + auto-categorize; **cash-basis P&L** (verified ✅); Analytics tab; credit lines; CSV/PDF export; monthly report trigger.
- FIX — **balance-sheet liabilities are manual** (don't derive from bank activity — owner's complaint) → wire to credit-accounts + loan transactions; fixed/variable heuristic untrustworthy; forecast KPIs suspected double-count; paid auto-entries linger as dead AR rows; ~3,360-line god-file → split parsers/calculations/tabs.
- DECIDE — PIN gate (cosmetic now that the real auth gate exists) — keep or drop.

## Marketing (`/marketing`)
- KEEP (core) — spend per channel; leads per channel; jobs closed; revenue; ROI; campaign cards; QR/UTM/gclid attribution.
- FIX — spend basis inconsistent (raw vs prorated); "Organic Clicks" inflated (no dedup on page_view); event-type validation; ~3,370-line god-file.
- CUT/RETIRE — over-built layers for a solo operator: 3 non-reconciling funnels → collapse to Leads→Quotes→Closed; one-shot "Sync Historical" tool living permanently in UI; *(done)* in-app Test panel removed.
- CUT — dead `view` / `email_click` event types (no production writer).

## Price Book (`/pricebook`)
- KEEP — service catalog; per-field price overrides; custom services; CSV export.

## Settings (`/settings`)
- KEEP — company info; logo; integrations (QuickBooks, Google Calendar, SMS, Resend); owner signature; SMS test.
- CUT — *(done)* theme-preset picker + nav editor (engine removed); `theme_config`/`nav_config` DB columns now droppable.
- BUILD — configurable thresholds (reminder days, review caps) currently hardcoded in `send-reminders.ts`.

## Scratch Pad (`/scratchpad`)
- KEEP — cross-device notepad (autosaves to settings). Small, optional.

---

## Cross-cutting systems
- KEEP — **Auth gate** (password + token; activate via env). **Cascade** (Finance/AR/activity/review side-effects). **E-sign** (canvas signature; quotes + agreements). **SMS queue** (approval workflow). **Service Agreements** (customer) + **Subcontractor Agreements** (1099). **Contractors**.
- FIX — cascade fires from only 1 of 5 stage-mutation paths → centralize (see ARCHITECTURE). Two review-request systems (`sms_queue` direct vs `review_requests`) → unify. SCA legal text duplicated (HTML + PDF) + signature-pad script ×4 → single source. 4 agreement-generate paths → one. SMS queue has no approval UI → build.
- DECIDE — **demo-mode** (data-blur) — owner KEPT it (2026-06-01).
- CUT — *(done)* **Knox AI** subsystem entirely (2026-06-01).

## Integrations
- KEEP — **QuickBooks** (OAuth, invoice create, payment webhook); **Google Calendar** (OAuth, job sync); **OpenPhone/Quo** SMS; **Resend** email; **instant-estimator** public contact form (separate repo).
- FIX — QB webhook bypasses the cascade (QB-paid jobs don't create finance/AR entries); QB invoice hardcodes `ItemRef '1'`; Google all-day end-date off-by-one + hardcoded EST offset; marketing-spend not reconciled with Finance.

---

## Summary counts (approx)
- **KEEP:** ~55 features (the core CRM is sound).
- **FIX:** ~25 (mostly logic/sync/consistency bugs — the trust problems).
- **CUT done:** Knox, theme/nav engine, test panel, legacy calendar sheets, duplicate contractor page, quick-nav (~5,800 lines).
- **CUT/RETIRE pending:** Marketing funnels + sync-historical tool, dead event types, dead placeholder tabs.
- **BUILD:** balance-sheet debt derivation, SMS approval UI, configurable thresholds, property edit UI, address geocode.
