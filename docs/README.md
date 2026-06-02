# KECC CRM — Planning Docs

Phase 0 guiding docs (the scaffolding the project never started with). Written 2026-06-02, grounded in the live schema + verified against live data.

| Doc | What it is |
|---|---|
| [`DATA_MODEL.md`](./DATA_MODEL.md) | All 22 DB tables by domain — columns, relationships, access model, gotchas. Source of truth for the database. |
| [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) | Every number in the app → its formula + a verification status (✅/⚠️/❌/⬜). The trust ledger. **Living doc — update as numbers are verified.** |
| [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) | Every feature, marked KEEP / FIX / CUT / BUILD. The "overbuilt/underbuilt" list made explicit. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Target conventions (cascade rule, single-source-of-truth, shared `_http`, sync rules). The spec for hardening. |

## The decision behind these
We chose **not** to do a full ground-up rewrite (the stack is good, the data/schema are kept, the bugs are logic/wiring issues a rewrite would re-implement, and it's a live tool). Instead: **rebuild the design, not the code** —
- **Phase 0** — these docs ✅
- **Phase 1** — harden the backend in place (centralize the cascade, extract `_http`, unify formulas, verify every number)
- **Phase 2** — rebuild the frontend god-files page-by-page against the hardened API

## Standing rule
Whenever any part of the CRM is touched, **verify it works as intended against live data** and record it in `SOURCE_OF_TRUTH.md`. Over time, the whole system gets verified piece by piece.
