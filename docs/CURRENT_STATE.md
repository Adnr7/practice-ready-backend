# Current-state audit

**Reviewed:** 2026-10-17

**Backend baseline:** local `dc733e1` (10 commits ahead of `origin/main`; not pushed)

**Original baseline:** [`49b159e`](https://github.com/asmib170/practice-ready/tree/49b159e21ff6b89fa2ec348d752fbd89af3c6572)

This is a source-code review, original-frontend review and local baseline check. It does not certify the deployed backend, live institutional inventory, browser automation, or remote D1. Proposed work is defined in the [PRD](PRD.md) and [implementation plan](IMPLEMENTATION_PLAN.md).

## 1. What is already valuable

- Responsive React/TypeScript booking and equipment-discovery prototype with light/dark themes, detailed search aliases, room-context preservation, audio feedback and a conflict demonstration.
- Vinext/Vite application structure and Cloudflare Workers/D1 integration points.
- Drizzle schema and initial SQL migration for users, rooms, locations, equipment, time slots, bookings and booking-slot links.
- Route handlers for authentication, room/slot reads, booking creation/list/cancellation, reservation lifecycle, suitability, repairs and equipment reads/updates.
- Shared booking calculations, password/session utilities and 61 D1-backed/unit Node tests.

The backend branch adds these useful foundations to the prototype. A route's existence or an earlier design's “production-ready” label is not evidence that the entire user journey is connected or concurrency-safe.

## 2. Scope coverage

**Partial** means some UI, API or schema exists but the PRD acceptance criteria are not yet satisfied. No row below is being claimed as complete for operational use.

| Feature | Observed implementation | Remaining work |
|---|---|---|
| F01 Availability | Partial: room and availability APIs are now read by the booking UI, including live booked names | Remove remaining demo occupancy fallback; enforce closures and policy horizon; add browser coverage |
| F02 Reserve | Partial: UI resolves live room IDs and only confirms committed D1 results; atomic store is tested | Add idempotency and browser coverage; operational booking now requires sign-in |
| F03 Reschedule | Implemented locally: version-aware atomic reschedule preserves the original on conflict, records history, and is exposed through live My Reservations | Browser coverage and staff override UX remain |
| F04 Cancel | Implemented locally: ownership/cutoff, version-aware release, idempotent repeat, history, and live UI | Browser coverage and staff override UX remain |
| F05 Session equipment use | Implemented locally: persistent usage table, active-owner-only receipt, deduplication/eligibility, end-session route, and live UI | Browser coverage and policy-approved incoming relocation rules remain |
| F06 Setups and locations | Partial: directory and room setup screens now read live equipment APIs | Remove remaining fixture-only alternative flows; add staff catalog operations and search parity |
| F07 Condition | Partial: live equipment reads and staff PATCH exist | Normalize independent condition/location facts, add inspection/freshness workflow and staff UI |
| F08 Repair progress/ETA | Implemented locally: persistent repair jobs/updates, nullable ETA, overdue projection, staff routes, and passed-inspection-gated completion | Staff browser workspace and linked report/repair UX remain |
| F09 Vocal suitability | Partial: persistent acoustic/amplified profiles and explained `/api/rooms/suitability` results; missing/away mixer is not a full match | Student profile screen and browser walkthrough remain |
| F10 Band suitability | Partial: band profile, capacity/restriction/equipment checks exist in the suitability service | Instrumentation configuration and browser UI remain |
| F11 Instrument suitability | Partial: keyboard profile and bring-own input contract exist | Full instrument catalog/configuration and browser UI remain |
| F12 Equipment reports | Partial-to-connected: persistent report API plus live student form/list/detail and basic staff queue updates | Attachments, linked repair actions, and browser coverage remain |
| F13 Room reports | Partial-to-connected: live room report form and persisted status flow exist | Staff closure/reservation-resolution UI remains |
| F14 Room conditions | Partial-to-connected: persistent room state/restrictions/closures, room detail, availability marking, and booking block exist | Staff room operations UI and browser coverage remain |
| F15 Rules | Partial: slot/maximum-duration rules in code and UI | Versioned published policy and consistent enforcement |
| F16 Contact FTS | Partial-to-connected: live assistance request form and FTS queue use persistent reports | Verified support hours/contact content and browser coverage remain |
| F17 Relocation | Partial-to-connected: movement UI reads/creates/returns persistent records; students must link an active owned session; staff correction API exists | Staff correction UI, destination policy configuration, and browser coverage remain |

## 3. What changed since the previous audit

- `0005_reservation_lifecycle.sql` adds active booking claims, booking history, versions, cancellation metadata, and immutable session equipment-use rows.
- Reservation detail, reschedule, end-session, active/history list, cancellation, usage receipt, and conflict-preserving D1 workflows are implemented and covered by `tests/reservation-lifecycle.test.mjs`.
- `0006_room_readiness.sql` adds room locations/state/restrictions/closures, repair jobs/updates/inspections, practice profiles/requirements, and room-profile support.
- Readiness, repair, suitability, closure, and staff operation routes are implemented; `tests/room-readiness.test.mjs` covers persistence, inspection gating, and the missing-mixer scenario.
- The current backend frontend now has live `My Reservations`, `Reports & Support`, and `My Equipment Movements` screens in `components/live-workflows.tsx`. These replace the original prototype's localStorage-only student mutations for this app.
- Guest operational bookings are rejected with `401`; public registration remains student-only; HTTPS auth responses add `Secure` to cookies.

## 4. Highest-priority findings

| Finding | Evidence in repository | Implementation consequence |
|---|---|---|
| **Booking can display success after failure** | The current client checks for a committed booking reference before showing success | Keep this regression covered and add browser failure tests. |
| **Some read paths remain demo-based** | Live room/availability/equipment reads now exist, but alternative searches and some setup presentation still use fixture arrays | Replace the remaining operational fixture paths rather than adding isolated endpoints. |
| **Room identity can be wrong in legacy UI paths** | The booking flow resolves IDs from `/api/rooms`; seed maps stable codes to generated IDs | Use returned IDs and stable codes everywhere, including future staff imports. |
| **UI time labels are not API times** | `halfHourSlot()` creates strings such as `9:00–9:30 AM`; `confirm()` passes selected labels as `startTime` and through `timeToMinutes()` | Use structured slots with machine instants/IDs and separate display labels. |
| **Schedule/date mismatch** | UI covers 06:00–next-day-06:00, with different period boundaries; backend generates 06:00–00:00. UI uses `toISOString().split("T")[0]` | Define campus time and actual opening hours once. Fix date conversion and final-midnight-slot handling. |
| **Booking lifecycle still lacks request-key idempotency** | Reschedule/cancel/session-end use version guards and the same booking claims; the live reservation screen is connected, but a lost POST retry is not keyed by an idempotency record | Add request-key idempotency and browser retry coverage before operational rollout. |
| **Slot generation can duplicate** | Both availability and booking routes create slots when none are found; `time_slots` has only nonunique room/date/start indexes | Introduce slot identity uniqueness and idempotent generation. |
| **Session lifecycle is still limited** | Registration is student-only and auth fails closed; production HTTPS cookies are secure, but sessions are still signed cookies without a revocation table | Add revocable server sessions, login throttling, and current-account checks. |
| **Demo and operational booking are separated only at the write boundary** | Operational booking now requires a signed-in user; explicit `?demo=1` presentation remains fixture-only | Keep demo persistence isolated and add browser coverage for anonymous booking rejection. |
| **Cancellation lifecycle is locally complete but not idempotency-keyed** | Version-aware claim release, history, cutoff, and repeated cancellation are D1-tested and exposed in the live UI | Add request-key idempotency and staff override UI. |
| **Validation and rules are incomplete** | Booking engine checks date/time shapes but not real dates, past starts, horizon or bounded clock values | Add strict shared schemas and policy-aware server validation. |
| **Equipment fields conflate different facts** | One `status` mixes location (`away`), condition (`attention`/`service`) and missing state; PATCH changes inspection time for any update | Separate condition, location, maintenance and verification; record movements distinctly. |
| **Search/data can regress during integration** | UI has alias/prefix/type ranking; API uses SQL `LIKE`; seed catalog differs from UI catalog | Extract shared search semantics and reconcile fixtures with a verified operational catalog. |

Other important gaps: no full route-level authorization suite, no complete staff operations UI, no booking idempotency records, no published versioned policy service, no browser suite, no practice journal persistence, and a short random booking-reference space despite collision retry.

## 5. Configuration and onboarding gaps

- `package.json` pins **pnpm 11.25.0** and requires **Node >=22.13.0**. Use the lockfile and the pinned manager.
- `drizzle.config.ts` outputs SQL to `drizzle/`; root `wrangler.json` now sets `migrations_dir: "drizzle"`. The checked-in sequence through `0006_room_readiness.sql` can be applied explicitly to an empty local database, but a staging/production migration rehearsal remains open.
- `db:migrate` runs `drizzle-kit migrate`, but the config contains no database credentials/target. It is not a ready-made D1 deployment command.
- `vite.config.ts` passes an inline Cloudflare config with empty D1 bindings, while root Wrangler config defines `DB`. The portable build reviewed here generated a working `DB` binding in `dist/server/wrangler.json`, and local room reads succeeded. Check other execution profiles independently rather than assuming identical configuration merging.
- `start` uses `dist/server/wrangler.json` and local `.wrangler/state`; it is a local Worker preview, not a command that publishes a production service.
- `.openai/hosting.json`, `scripts/sites-env.*` and the vendored Sites plugin are inherited hosting infrastructure. Their local sign-in mock does not implement the application's `pr_session` login.
- Root `wrangler.json` contains a specific existing database ID. A new deployment needs its own environment mapping and migrations through `0006_room_readiness.sql`.

## 6. Baseline verification

| Check | Result / interpretation |
|---|---|
| `corepack pnpm test` on Node 22.23.3 | **61 passed, 0 failed**. Covers auth/API clients, slot calculations, D1 booking concurrency, reservation lifecycle/session usage, room readiness/repair/suitability, movement persistence, and report persistence. |
| `tests/concurrency-conflict.test.mjs` review | Still includes a sequential simulator, but `tests/booking-store.test.mjs` exercises D1-backed atomic booking behavior. Full route/browser concurrency remains open. |
| Frozen install / typecheck / build | TypeScript and build passed with pnpm 11.25.0; build reported a large client-chunk warning. A fresh frozen install was not repeated in this continuation. |
| `corepack pnpm lint` | Passed with **0 errors and 4 warnings**, all existing `no-img-element` warnings in `app/page.tsx`. |
| Local schema / built Worker / seed / room reads | Passed using the [README](../README.md) commands. Seed produced 5 rooms, 8 locations, 32 assets and 2,520 slots. Room output confirmed MPR 2 has ID 1 on a fresh database. |
| Browser journeys / route-level API calls / remote D1 | Not exercised by these checks; required before calling the full frontend backend-complete. |
| Production database / institution data | Not accessed or verified in this review. |

## 7. Original frontend parity status

The original repository was inspected at commit `07f5963` and explicitly documents browser-local prototype persistence. The current backend now connects the principal student reservation, support, and movement workflows to server APIs, but full parity is **not complete**:

- Home, booking availability, equipment directory, and schedule remain in the single-page prototype flow. Availability still has a demo occupancy fallback when only one operational-day read fails, and room selection has legacy hardcoded names.
- The live reservation screen does not yet provide the original's full move-review/journal experience, URL routes, or browser-back restoration.
- Room setup pages read live equipment but do not expose the practice-profile/suitability API to students; vocal, band, and individual-instrument discovery remains fixture/client-driven.
- Reports/support now persist through the API, but photo attachments, verified contact directory content, linked repair/closure actions, and browser error/empty coverage remain incomplete.
- Movement reads/create/return are live and expected-return wording is explicit, but staff correction UI, destination policy configuration, and full session-context review remain incomplete.
- FTS/admin inventory, repair, closure, policy, reservation override, and student directory screens from the original frontend are not fully ported. The live support component provides a basic staff report queue, not the complete FTS workspace.
- Practice journal/history remains unsupported by the backend. The original frontend journal is localStorage-only and is not counted as server parity.

Therefore the full original frontend/backend parity is **not complete**. These are checked local milestones, not an operational release.

## 8. Recommended order

1. Establish a repeatable local Worker/database setup and isolate demo behavior.
2. Repair account boundaries, time/identity contracts and transactional booking guarantees.
3. Connect the four MVP features end to end and enable staff data maintenance.
4. Deliver reservation management, suitability, repair/relocation and support workflows.
5. Validate all 17 features with student and FTS users and measured operational data.

The September documents under `docs/superpowers/` are historical design material. The October PRD, architecture and roadmap supersede their assumptions about automatic fallbacks, completion and scope.
