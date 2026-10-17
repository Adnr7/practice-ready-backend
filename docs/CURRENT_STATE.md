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
| F01 Availability | Partial: room and availability APIs are now read by the booking UI, including live booked names | Remove remaining demo occupancy fallback; enforce closures and policy horizon; add browser coverage |
| F02 Reserve | Partial: UI resolves live room IDs and only confirms committed D1 results; atomic store is tested | Require authenticated live bookings, add idempotency and browser coverage |
| F03 Reschedule | No reschedule route or management journey found | Atomic reschedule and owner UI |
| F04 Cancel | Partial: `DELETE /api/bookings/[id]` has ownership/cutoff and transactional release | Connect a reservations UI and add versioned/idempotent lifecycle behavior |
| F05 Session equipment use | No usage table/API/journey found | Active-session logging and receipt |
| F06 Setups and locations | Partial: directory and room setup screens now read live equipment APIs | Remove remaining fixture-only alternative flows; add staff catalog operations and search parity |
| F07 Condition | Partial: live equipment reads and staff PATCH exist | Normalize independent condition/location facts, add inspection/freshness workflow and staff UI |
| F08 Repair progress/ETA | “service” state exists; no repair record | Repair lifecycle, dates and staff workflow |
| F09 Vocal suitability | No explicit live matching workflow found | Configurable acoustic/amplified requirements and explained results |
| F10 Band suitability | No explicit live matching workflow found | Capacity, instrumentation and restrictions |
| F11 Instrument suitability | No explicit live matching workflow found | Instrument-specific requirements and results |
| F12 Equipment reports | Partial: persistent report tables and authenticated create/list/detail/staff-update APIs exist | Connect the student report UI and FTS queue; add attachments only if approved |
| F13 Room reports | Partial: persistent room-report API path exists | Connect room report UI and link staff resolution to room restrictions/closures |
| F14 Room conditions | Partial: descriptions and `isActive` | Structured condition, restriction and closure data/UI |
| F15 Rules | Partial: slot/maximum-duration rules in code and UI | Versioned published policy and consistent enforcement |
| F16 Contact FTS | Partial: assistance reports persist through the reports API | Connect Contact FTS and My Requests UI with verified contact content and staff queue |
| F17 Relocation | Partial: persistent movement/create, list, return and staff-correction APIs now exist | Connect the movement UI; enforce policy-designated assets/destinations and add browser coverage |

## 3. Highest-priority findings

| Finding | Evidence in repository | Implementation consequence |
|---|---|---|
| **Booking can display success after failure** | The current client checks for a committed booking reference before showing success | Keep this regression covered and add browser failure tests. |
| **Some read paths remain demo-based** | Live room/availability/equipment reads now exist, but alternative searches and some setup presentation still use fixture arrays | Replace the remaining operational fixture paths rather than adding isolated endpoints. |
| **Room identity can be wrong in legacy UI paths** | The booking flow resolves IDs from `/api/rooms`; seed maps stable codes to generated IDs | Use returned IDs and stable codes everywhere, including future staff imports. |
| **UI time labels are not API times** | `halfHourSlot()` creates strings such as `9:00–9:30 AM`; `confirm()` passes selected labels as `startTime` and through `timeToMinutes()` | Use structured slots with machine instants/IDs and separate display labels. |
| **Schedule/date mismatch** | UI covers 06:00–next-day-06:00, with different period boundaries; backend generates 06:00–00:00. UI uses `toISOString().split("T")[0]` | Define campus time and actual opening hours once. Fix date conversion and final-midnight-slot handling. |
| **Booking lifecycle is incomplete** | Creation uses the D1 batch-backed booking store, but idempotency, reschedule and student reservation management are absent | Add idempotency/version guards and complete the reservation lifecycle. |
| **Slot generation can duplicate** | Both availability and booking routes create slots when none are found; `time_slots` has only nonunique room/date/start indexes | Introduce slot identity uniqueness and idempotent generation. |
| **Session lifecycle is still limited** | Registration is student-only and auth fails closed, but sessions are signed cookies without a revocation table | Add revocable server sessions, secure production-cookie behavior and current-account checks. |
| **Guest booking remains enabled** | The prototype can still submit `guestName` when no session exists | Isolate demo/guest data and require authentication for operational bookings. |
| **Cancellation lifecycle is partial** | Cancellation now uses a batch-backed release and cutoff | Add idempotency, version guards, history semantics and the reservations UI. |
| **Validation and rules are incomplete** | Booking engine checks date/time shapes but not real dates, past starts, horizon or bounded clock values | Add strict shared schemas and policy-aware server validation. |
| **Equipment fields conflate different facts** | One `status` mixes location (`away`), condition (`attention`/`service`) and missing state; PATCH changes inspection time for any update | Separate condition, location, maintenance and verification; record movements distinctly. |
| **Search/data can regress during integration** | UI has alias/prefix/type ranking; API uses SQL `LIKE`; seed catalog differs from UI catalog | Extract shared search semantics and reconcile fixtures with a verified operational catalog. |

Other important gaps: no full route-level authorization suite, no staff operations UI, no booking idempotency, no room-policy/repair/audit model, no end-to-end report/movement UI integration, and a short random booking-reference space despite collision retry.

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
| `corepack pnpm test` on Node 22.22.0 | **54 passed, 0 failed** after the reports, movement and live-client slices. Covers auth/API clients, slot calculations, D1 booking concurrency, D1 movement persistence and report persistence. |
| `tests/concurrency-conflict.test.mjs` review | Still includes a sequential simulator, but `tests/booking-store.test.mjs` exercises D1-backed atomic booking behavior. Full route/browser concurrency remains open. |
| Frozen install / typecheck / build | Passed with pnpm 11.25.0; build reported a large client-chunk warning. |
| `corepack pnpm lint` | Passed with **0 errors and 4 warnings**, all existing `no-img-element` warnings in `app/page.tsx`. |
| Local schema / built Worker / seed / room reads | Passed using the [README](../README.md) commands. Seed produced 5 rooms, 8 locations, 32 assets and 2,520 slots. Room output confirmed MPR 2 has ID 1 on a fresh database. |
| Browser journeys / route-level API calls / remote D1 | Not exercised by these checks; required before calling the full frontend backend-complete. |
| Production database / institution data | Not accessed or verified in this review. |

## 6. Recommended order

1. Establish a repeatable local Worker/database setup and isolate demo behavior.
2. Repair account boundaries, time/identity contracts and transactional booking guarantees.
3. Connect the four MVP features end to end and enable staff data maintenance.
4. Deliver reservation management, suitability, repair/relocation and support workflows.
5. Validate all 17 features with student and FTS users and measured operational data.

The September documents under `docs/superpowers/` are historical design material. The October PRD, architecture and roadmap supersede their assumptions about automatic fallbacks, completion and scope.
