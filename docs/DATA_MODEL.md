# KECC CRM — Data Model

**Source of truth for the database.** 22 tables in Supabase project `kskplucbdojagvscvlce` (Postgres). Generated 2026-06-02 from the live schema; row counts are point-in-time.

## Access model (important)
- **RLS is enabled on every table but there are no policies** → the anon/`authenticated` Supabase keys can't read anything directly.
- **All access goes through Netlify Functions** (`netlify/functions/*`) using the **service-role key**, which bypasses RLS. The functions are the only door to the data.
- That door is now protected by the **auth gate** (`_auth.ts` → `requireAuth`), active once `AUTH_SECRET` + `APP_PASSWORD` are set. Public endpoints (track/capture/esign/etc.) are explicitly allow-listed. See `SOURCE_OF_TRUTH.md` and the auth-gate memory.
- **Type mappers:** every table maps to a TS interface via `rowToX()` in `src/types.ts` (snake_case DB ↔ camelCase app). Extend there for any new column.

---

## Domain 1 — People & Places (CRM core)

### `contacts` (25 rows) — the canonical person/customer record
The hub; almost everything FKs back to it. `id` PK. Notable cols: `name`, `email`, `phone`, `type` (residential/commercial), `business_name`, `source` (marketing attribution — keep in sync with the create/edit dropdowns), `tags[]`, `custom_fields` (jsonb), `lead_score`, `referred_by` (self-FK), `has_left_review`, `next_followup`.
Referenced by: properties, leads, quotes, jobs, subscriptions, service_agreements, activities, transactions, sms_queue, review_requests.

### `properties` (14) — service addresses, one→many per contact
FK `contact_id`. `address`, `label`, `type`, `mowable_acres`, `sqft`, `lat`/`lng` (⚠️ lat/lng never populated — no geocoder wired). Referenced by leads.property_id, jobs.property_id.

### `activities` (70) — contact timeline / audit log
FK `contact_id`. `type` (stage_change, payment_received, invoice_sent, note, job_completed…), `summary`, `metadata` (jsonb). Written by the cascade and various handlers.

---

## Domain 2 — Sales pipeline

### `leads` (27) — pipeline kanban cards
FK `contact_id`, `quote_id` (the "primary" quote), `property_id`, `campaign_id`. `stage` (new→contacted→follow_up→quoted→scheduled→recurring→finished_unpaid→finished_paid, plus `lost`). Marketing attribution: `source`, `utm_*`, `source_locked`. Also `estimated_value`, `contractor_cost`, `photo_stacks` (jsonb), `contacted_at`/`follow_up_sent_at`/`agreement_signed_at`.
⚠️ Leads carry **no denormalized customer name/phone** — they reference the contact. (Quotes/jobs/subscriptions DO denormalize, and are kept in sync by `contacts.ts`.)

### `quotes` (44) — estimates
FK `contact_id`, `lead_id`, `revised_from_id` (amendment chain → self). `quote_type` (default `residential_onetime`), `line_items` (jsonb), `subtotal`/`discount`/`total`, `amendments` (jsonb) + `original_total` (amendment math), `option_groups`, `status` (draft/sent/accepted/declined…), `accept_token` (e-sign), `signed_at`, `qb_invoice_id`.
⚠️ "Primary quote" ambiguity when a lead has multiple quotes (see SOURCE_OF_TRUTH).

### `jobs` (21) — scheduled work / calendar events
FK `contact_id`, `property_id`, `quote_id`, `subscription_id`, `contractor_id`. `status` (scheduled/completed/cancelled), `scheduled_date` + `scheduled_end_date` (multi-day), `scheduled_window`/`scheduled_time`, `completed_at`, `job_type` (one_time/quote_visit/sub_visit), `google_event_id`, denormalized `customer_*`.
⚠️ Drag-drop specific time writes `start_time` not `scheduled_time` (known bug); no status-transition validation.

### `subscriptions` (7) — recurring service plans (MRR)
FK `contact_id`, `quote_id`, `agreement_id`. `status` (**ACADEMIC SPELLING: `CANCELED` one-L** — ACTIVE/PAUSED/CANCELED/ARCHIVED), `services` (jsonb), `in_season_monthly_total` / `off_season_monthly_total` (seasonal MRR), `service_schedules` (jsonb, drives calendar recurrence), `pause_until` (⚠️ not auto-enforced), `cancelled_at`.

---

## Domain 3 — Finance

### `transactions` (222) — THE cash ledger + accounts-receivable
The single most important finance table. `type` CHECK (Income/Expense), `category` (Schedule C buckets), `account` (default `KECC Checking (TVA)`; `CRM Auto-Entry` = system-generated), `amount`, `date`, `source` (`upload` = bank import, `manual`, `lead:<id>`/`job:<id>`/`quote:<id>` = auto-entries), `is_unpaid` (AR flag), `review`, FK `lead_id`/`contact_id`.
**Cash-basis rule (owner decision):** only rows whose `category ∈ INCOME_CATS` count as P&L revenue. `CRM Auto-Entry`/`Active Jobs` rows are accounts-receivable, excluded from the cash P&L. See SOURCE_OF_TRUTH.

### `balance_sheet_snapshots` (2) — MANUAL monthly balance sheet
`month`/`year` + assets (`checking`,`savings`,`equipment`,`vehicles`,`real_estate`,`other_assets`) + liabilities (`chase_ink`,`auto_loan`,`biz_loan`,`other_liab`).
⚠️ **Owner pain point:** liabilities are **hand-entered snapshots**, NOT derived from `transactions`/`credit_accounts`. This is why debt totals don't auto-generate from bank activity. Candidate to wire (define debt = derived credit-account balances + loan transactions).

### `credit_accounts` (2) — credit cards / lines of credit
`name`, `account_type`, `credit_limit`, `account_key`. Balance is **derived** from `transactions` (charges − payments) in `Finance.tsx`. ⚠️ This derived balance and the manual `balance_sheet_snapshots.chase_ink` are two unreconciled debt representations.

### `kpi_reports` (2) — monthly KPI snapshots
`period` (unique), `report_data` (jsonb), `sms_sent`. Written by `monthly-report.ts`.

---

## Domain 4 — Marketing & Attribution

### `marketing_channels` (13) — channel definitions
`name`, `type` CHECK (digital/print/social/referral/sponsorship/phone/other), `is_active`.

### `campaigns` (17) — campaigns under a channel
FK `channel_id`. `campaign_type` CHECK (digital/qr/referral/phone/sponsorship), `utm_*`, `redirect_token` (unique — powers `/track` QR redirects), `destination_url`, `budget`, `status`.

### `campaign_events` (22) — immutable attribution events
FK `campaign_id`. `event_type` CHECK (view/click/scan/phone_click/email_click/form_submit/page_view). `metadata` (jsonb — holds IP for dedup). ⚠️ `view` and `email_click` are effectively dead (no production writer).

### `marketing_spend` (6) — spend per channel per month
FK `channel_id`. `amount`, `month`, `is_recurring`. ⚠️ Not reflected in `transactions`/Finance (separate silo — reconcile or document as planning-only).

### `marketing_budget` (0) — global monthly budget. Empty/unused.

---

## Domain 5 — Agreements, Contractors & Ops

### `service_agreements` (4) — customer service agreements
FK `contact_id`, `subscription_id`, `quote_id`, `lead_id`. `status` CHECK (draft/pending_signature/signed/void), `accept_token`, `signature_data`, `signer_printed_name`. ⚠️ Four generate paths in `agreements.ts`; no PDF generator (relies on print) while `ContactDetail` shows a dead "View PDF".

### `subcontractor_agreements` (2) — 1099 subcontractor agreements (SCA)
FK `contractor_id`. `status`, `accept_token`, `kecc_sig_data`/`sub_sig_data`. Separate table from customer SAs (no record overlap — naming is the only hazard).

### `contractors` (13) — 1099 subcontractors
`name`, `rate_per_job`, `is_1099`, `documents` (jsonb). Managed via the Contacts page's Contractors tab (the standalone page was removed 2026-06-01).

### `sms_queue` (12) — outbound SMS approval queue
`type` CHECK (review_request/quote_followup/service_reminder/kpi_report/custom), `status` CHECK (pending/approved/sent/dismissed). ⚠️ No user-facing approval UI; two review-request systems exist (this + `review_requests`).

### `review_requests` (3) — review-request tracking (3-request cap)
FK `contact_id`/`lead_id`. `type` CHECK (one_time/recurring), `status` CHECK (pending_queue/sent_initial/max_reached).

---

## Domain 6 — System / Config

- **`company_settings` (1)** — single-row config: company info, integration secrets (`qb_*`, `google_cal_*`, `resend_api_key`, `quo_*`), `owner_signature_data`, `scratchpad_content`. ⚠️ `theme_config`/`nav_config` columns are now **dead** (the theme/nav engine was removed 2026-06-01) — safe to drop.
- **`custom_services` (8)** — price-book service definitions/overrides (`data` jsonb per id).
- **`price_overrides` (31)** — per-service field price overrides (`service_id`,`field`,`value`).
- **`deleted_services` (0)** — soft-delete tombstones for catalog services.
- **`quote_attachments` (2)** — files attached to quotes/agreements (`attach_to` CHECK quote/agreement/both).

---

## Relationship map (the spine)
```
contacts ─┬─< properties
          ├─< leads ───> quotes ──< jobs
          │      │         │        └─> contractors
          │      └─> campaigns (attribution)
          ├─< quotes ──< subscriptions
          ├─< jobs
          ├─< subscriptions ──< service_agreements
          ├─< activities
          ├─< transactions (lead_id/contact_id)
          ├─< service_agreements
          ├─< sms_queue / review_requests
contractors ──< subcontractor_agreements
marketing_channels ──< campaigns ──< campaign_events
                   └──< marketing_spend
```

## Verification status
- ✅ Schema pulled from live DB (2026-06-02). FKs confirm a coherent contact-centric model.
- See `SOURCE_OF_TRUTH.md` for per-number verification.
