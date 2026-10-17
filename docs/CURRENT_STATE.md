# Current-state audit

**Reviewed:** 2026-10-04

**Backend baseline:** [`d0f1682`](https://github.com/Adnr7/practice-ready-backend/tree/d0f1682acf56f4af0f2879f12ab951028bd09340)

**Original baseline:** [`49b159e`](https://github.com/asmib170/practice-ready/tree/49b159e21ff6b89fa2ec348d752fbd89af3c6572)

This is a source-code review, public-page review and local baseline check. It does not certify the deployed backend or a live institutional inventory. Proposed work is defined in the [PRD](PRD.md) and [implementation plan](IMPLEMENTATION_PLAN.md).

## 1. What is already valuable

- Responsive React/TypeScript booking and equipment-discovery prototype with light/dark themes, detailed search aliases, room-context preservation, audio feedback and a conflict demonstration.
- Vinext/Vite application structure and Cloudflare Workers/D1 integration points.
- Drizzle schema and initial SQL migration for users, rooms, locations, equipment, time slots, bookings and booking-slot links.
- Route handlers for authentication, room/slot reads, booking creation/list/cancellation and equipment reads/updates.
- Shared booking calculations, password/session utilities and 13 existing Node tests.

The backend branch adds these useful foundations to the prototype. A route's existence or an earlier design's “production-ready” label is not evidence that the entire user journey is connected or concurrency-safe.

## 2. Scope coverage

**Partial** means some UI, API or schema exists but the PRD acceptance criteria are not yet satisfied. No row below is being claimed as complete for operational use.

| Feature | Observed implementation | Remaining work |
|---|---|---|
| F01 Availability | Partial: API exists; UI uses generated labels and fixed booked-slot sets | Connect live reads; fix calendar/time contract; enforce closures and horizon |
| F02 Reserve | Partial: UI calls `submitBooking`; route inserts bookings and slot links | Correct payload/room IDs, remove false success, enforce auth and atomic claims |
| F03 Reschedule | No reschedule route or management journey found | Atomic reschedule and owner UI |
| F04 Cancel | Partial: `DELETE /api/bookings/[id]` | Ownership, cutoff, transactional release and UI |
| F05 Session equipment use | No usage table/API/journey found | Active-session logging and receipt |
| F06 Setups and locations | Partial: rich fixture UI; equipment APIs and fields | One live catalog; default-vs-present semantics; stable IDs and search parity |
| F07 Condition | Partial: condition/status fields and staff PATCH | Normalize condition, inspect/update workflow, live UI and freshness |
| F08 Repair progress/ETA | “service” state exists; no repair record | Repair lifecycle, dates and staff workflow |
| F09 Vocal suitability | No explicit live matching workflow found | Configurable acoustic/amplified requirements and explained results |
| F10 Band suitability | No explicit live matching workflow found | Capacity, instrumentation and restrictions |
| F11 Instrument suitability | No explicit live matching workflow found | Instrument-specific requirements and results |
| F12 Equipment reports | No report table/API/journey found | Submission, own status view and FTS triage |
| F13 Room reports | No report table/API/journey found | Room concerns and links to maintenance/closure |
| F14 Room conditions | Partial: descriptions and `isActive` | Structured condition, restriction and closure data/UI |
| F15 Rules | Partial: slot/maximum-duration rules in code and UI | Versioned published policy and consistent enforcement |
| F16 Contact FTS | No persisted support-request flow found | Verified contacts, assistance form and staff queue |
| F17 Relocation | Partial: staff PATCH can replace location | Movement history, expected return, authorized move/return workflow and atomicity |

## 3. Highest-priority findings

| Finding | Evidence in repository | Implementation consequence |
|---|---|---|
| **Booking can display success after failure** | `app/page.tsx`, `confirm()`: a timer shows success after 1.8 seconds; responses other than a nonempty conflict list also show success | Remove fallback success before live use. Only committed results can confirm. |
| **Read paths remain demo-based** | `app/page.tsx` imports only `submitBooking` from `lib/api-client.ts`; equipment arrays and booked-slot sets remain local | Replace the data source, including readiness and directory views, rather than adding more isolated endpoints. |
| **Room identity can be wrong** | UI derives numeric ID from a room label. Seed insertion omits the `id` values in `SEED_ROOMS`, allowing auto-increment IDs | A fresh DB can give MPR 2 ID 1 while the UI sends 2. Use IDs returned by the API and stable codes for imports. |
| **UI time labels are not API times** | `halfHourSlot()` creates strings such as `9:00–9:30 AM`; `confirm()` passes selected labels as `startTime` and through `timeToMinutes()` | Use structured slots with machine instants/IDs and separate display labels. |
| **Schedule/date mismatch** | UI covers 06:00–next-day-06:00, with different period boundaries; backend generates 06:00–00:00. UI uses `toISOString().split("T")[0]` | Define campus time and actual opening hours once. Fix date conversion and final-midnight-slot handling. |
| **Booking writes are not atomic** | `app/api/bookings/route.ts`: availability read, booking insert, link insert and status update are separate awaited writes | Two callers can both pass the read. Add database-enforced unique claims and one atomic write operation. |
| **Slot generation can duplicate** | Both availability and booking routes create slots when none are found; `time_slots` has only nonunique room/date/start indexes | Introduce slot identity uniqueness and idempotent generation. |
| **Registration can self-assign staff/admin** | `app/api/auth/register/route.ts` accepts `body.role` | Public registration must always create students; role management is administrative. |
| **Session defaults are unsuitable for live accounts** | `lib/auth.ts`: hardcoded secret fallback, cookies without `Secure`, signed role claims without a revocation lookup | Require configured secrets, secure production cookies and revocable sessions/current-account checks. |
| **Unauthenticated seed and guest cancellation** | Seed has no auth check and creates known demo accounts; cancellation permits any booking without a `userId` | Move seed to controlled tooling; isolate demo data and require ownership for live mutations. |
| **Cancellation has multiple writes and no time cutoff** | Cancellation updates slot status, then booking status; booking-slot links remain | Separate active claims from historical links and transact the lifecycle change. |
| **Validation and rules are incomplete** | Booking engine checks date/time shapes but not real dates, past starts, horizon or bounded clock values | Add strict shared schemas and policy-aware server validation. |
| **Equipment fields conflate different facts** | One `status` mixes location (`away`), condition (`attention`/`service`) and missing state; PATCH changes inspection time for any update | Separate condition, location, maintenance and verification; record movements distinctly. |
| **Search/data can regress during integration** | UI has alias/prefix/type ranking; API uses SQL `LIKE`; seed catalog differs from UI catalog | Extract shared search semantics and reconcile fixtures with a verified operational catalog. |

Other important gaps: no real database concurrency test, no route-level authorization suite, no staff operations UI, no booking idempotency, no room-policy/repair/report/movement audit model, and a short random booking-reference space without collision retry.

## 4. Configuration and onboarding gaps

- `package.json` pins **pnpm 11.25.0** and requires **Node >=22.13.0**. Use the lockfile and the pinned manager.
- `drizzle.config.ts` outputs SQL to `drizzle/`; root `wrangler.json` does not set `migrations_dir`. Wrangler's default migration directory is not this project's Drizzle output. The initial SQL can be applied explicitly for an empty local database; P0 must establish a tracked migration workflow.
- `db:migrate` runs `drizzle-kit migrate`, but the config contains no database credentials/target. It is not a ready-made D1 deployment command.
- `vite.config.ts` passes an inline Cloudflare config with empty D1 bindings, while root Wrangler config defines `DB`. The portable build reviewed here generated a working `DB` binding in `dist/server/wrangler.json`, and local room reads succeeded. Check other execution profiles independently rather than assuming identical configuration merging.
- `start` uses `dist/server/wrangler.json` and local `.wrangler/state`; it is a local Worker preview, not a command that publishes a production service.
- `.openai/hosting.json`, `scripts/sites-env.*` and the vendored Sites plugin are inherited hosting infrastructure. Their local sign-in mock does not implement the application's `pr_session` login.
- Root `wrangler.json` contains a specific existing database ID. A new deployment needs its own environment mapping and migrations.

## 5. Baseline verification

| Check | Result / interpretation |
|---|---|
| `npm test` on Node 22.22.0 | **13 passed, 0 failed**. Covers crypto/session utilities, slot calculations and a sequential conflict simulation. |
| `tests/concurrency-conflict.test.mjs` review | Mutates arrays sequentially; no Worker requests or database writes. Passing it does not establish atomicity. |
| Frozen install / typecheck / build | Passed with pnpm 11.25.0; build reported a large client-chunk warning. |
| `corepack pnpm lint` | **20 errors and 22 warnings** in the existing baseline, including explicit `any` and effect-state issues. |
| Local schema / built Worker / seed / room reads | Passed using the [README](../README.md) commands. Seed produced 5 rooms, 8 locations, 32 assets and 2,520 slots. Room output confirmed MPR 2 has ID 1 on a fresh database. |
| Browser journeys / concurrent API writes | Not exercised by the baseline checks; required in P1/P2. |
| Production database / institution data | Not accessed or verified in this review. |

## 6. Recommended order

1. Establish a repeatable local Worker/database setup and isolate demo behavior.
2. Repair account boundaries, time/identity contracts and transactional booking guarantees.
3. Connect the four MVP features end to end and enable staff data maintenance.
4. Deliver reservation management, suitability, repair/relocation and support workflows.
5. Validate all 17 features with student and FTS users and measured operational data.

The September documents under `docs/superpowers/` are historical design material. The October PRD, architecture and roadmap supersede their assumptions about automatic fallbacks, completion and scope.
