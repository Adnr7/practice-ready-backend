# Practice Ready — Implementation Plan

**Date:** 2026-10-04 · **Status:** Proposed, implementation tasks not yet completed

**Goal:** Deliver the [17-feature PRD](PRD.md) from the [audited backend baseline](CURRENT_STATE.md), using the [proposed architecture](ARCHITECTURE.md).

## 1. Delivery strategy

Complete a working vertical slice at each phase: database → service/API → student/staff UI → meaningful tests → demonstrable acceptance. Keep the existing TypeScript/React/Cloudflare stack unless the P0 runtime check reveals a concrete blocker.

The first milestone is a trustworthy four-feature pilot. Full V1 includes every feature from the supplied image; it is not finished when the pilot launches.

### Assumptions and estimate

- One experienced full-stack developer working full-time, with weekly product/FTS access for decisions and verification.
- Single campus, existing UI reused, no external SSO integration, no attachments or outbound notification infrastructure in V1.
- Estimates include implementation, targeted tests and review. Actual delivery depends on inventory verification and institutional decisions.
- **36–51 engineering days** (roughly 8–11 working weeks); plan **9–13 weeks** with approximately 20% contingency. Re-estimate after P0 and P2. Institutional waiting time is additional.

| Phase | Effort | Prerequisite | Observable result |
|---|---:|---|---|
| **P0 — Baseline and decisions** | 2–3 days | Repository access | Repeatable local/staging setup and confirmed policy/data contracts |
| **P1 — Trust foundation** | 6–8 days | P0 | Account boundaries, correct time/IDs and database-enforced booking integrity |
| **P2 — Connected MVP** | 6–9 days | P1 | F01/F02/F06/F07 end to end with maintained live data |
| **P3 — Reservation lifecycle** | 6–8 days | P2 | F03/F04/F05/F15 and My Reservations |
| **P4 — Readiness and discovery** | 8–11 days | P2; P3 active-session context | F08/F09/F10/F11/F14/F17 and staff equipment operations |
| **P5 — Reports and support** | 4–6 days | P4 domain states | F12/F13/F16 with FTS triage |
| **P6 — Full V1 pilot and release** | 4–6 days | P3–P5 | All 17 features tested with students/FTS and deploy/restore rehearsed |

### Dependency map

```text
P0 → P1 → P2 (four-feature pilot)
               ├→ P3 (reservation lifecycle) ─┐
               └→ P4 (readiness/discovery) → P5 ─→ P6 (full V1)
                    ↑ active-session link from P3
```

With multiple contributors, P3 and the catalog/repair parts of P4 can progress independently once P1 contracts are stable. The estimate above assumes one developer.

## 2. P0 — Make the baseline repeatable

**Primary files:** `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `wrangler.json`, `drizzle.config.ts`, `scripts/`, `README.md`, CI configuration to be added.

- [ ] **P0-01 · Confirm scope/policy:** record the PRD open decisions, especially operating-day hours, late-night slots, campus timezone, horizon, account eligibility, cancellation cutoff and actual bookable rooms. Mark unresolved items with an owner and due date.
- [ ] **P0-02 · Stabilize commands:** frozen install, typecheck, build, local D1 migration, preview and seed must work from a clean clone. Set explicit migration-directory/ledger behavior; document generated versus root Wrangler bindings. Keep package and lockfile changes intentional.
- [ ] **P0-03 · Establish CI:** run existing tests, typecheck, lint and build. Fix the baseline's 20 lint errors and triage its 22 warnings. Add integration/browser-test jobs as those harnesses land.
- [ ] **P0-04 · Separate environments:** distinct local/staging/production data and secrets, labelled demo mode, no demo account creation in operational databases. Move seed toward operator tooling.
- [ ] **P0-05 · Inventory reconciliation:** compare `lib/seed-data.ts`, UI fixture inventory and FTS records; assign stable asset IDs/location codes. The local baseline seed contains 5 rooms, 8 locations and 32 assets, not the full UI catalog.

**Exit gate:** another developer can reproduce the documented preview and DB reads; staging has the correct `DB` binding; policy/ID/time decisions are recorded. Runtime contingency is evaluated only if this gate is blocked.

## 3. P1 — Establish trust in accounts and booking writes

**Primary files:** `lib/auth.ts`, `lib/booking-engine.ts`, `db/schema.ts`, new migrations/contracts/services, auth/availability/booking routes, `tests/integration/`.

- [ ] **P1-01 · Account authority:** registration is student-only; add active-account checks, administrative role provisioning and owner/role guards. Close unauthenticated operational seed and guest cancellation paths. Define recovery.
- [ ] **P1-02 · Sessions and account screens:** remove known-secret fallback; use revocable sessions and secure production cookie/origin behavior. Add sign-in, eligible-student registration, sign-out and reset screens with clear error/expiry states, login throttling and current-role checks. Existing credential hashes remain usable.
- [ ] **P1-03 · Canonical slots:** introduce explicit room/location relations, unique slot identity and UTC start/end instants with campus-date conversion. Validate real dates, bounded times, future starts, horizon, closures and midnight. Generate slots idempotently.
- [ ] **P1-04 · Migrate occupancy:** audit existing duplicates/guest data; add active room/student claims, history links and version guards. Do not silently choose a winner among pre-existing conflicts.
- [ ] **P1-05 · Atomic creation:** implement D1 batch plus constraints/guards, collision-resistant references, audit events and idempotency. Classify conflicts and failed policy checks without leaking SQL errors.
- [ ] **P1-06 · Real integration harness:** use a disposable local Worker/D1 instance, not array mocks. Exercise concurrent requests, partial failures and authorization. Seed test-specific users/rooms without depending on the public seed endpoint.

**Exit gate:** 20 simultaneous overlapping booking requests produce one valid slot owner, no partial records and useful conflict responses. A student cannot gain staff privileges or mutate someone else's booking. A timeout/retry cannot create a duplicate.

## 4. P2 — Deliver the connected four-feature MVP

**Features:** F01, F02, F06, F07

**Primary files:** `app/page.tsx`, `lib/api-client.ts`, room/equipment routes, new booking/equipment components and staff pages.

- [ ] **P2-01 · Extract the data boundary:** move fixtures to explicit demo modules; introduce typed fetch responses, structured errors and loading/empty/error/stale states. Keep the conflict demo isolated.
- [ ] **P2-02 · Wire discovery reads:** use returned room IDs, live slots, live default/current equipment locations and verified condition. Replace hardcoded booked sets and room-specific arrays in operational screens.
- [ ] **P2-03 · Repair confirmation:** remove the success timer; send machine slot IDs, preserve idempotency through retries, show the actual booking reference and render `400/401/409/422/500` distinctly. A timeout means checking/retrying, never success.
- [ ] **P2-04 · Preserve useful UX:** extract alias/type-first search behavior, keep same-room selection preservation, accessible feedback and mobile actions. Move major destinations to URLs and split the large page into feature components.
- [ ] **P2-05 · Minimum staff workspace:** view catalog, correct verified condition/location, record inspection time/actor and audit changes. Initial correction tooling is not yet the full F17 temporary-movement lifecycle.
- [ ] **P2-06 · Pilot fixture-to-truth cutover:** import the verified pilot inventory. Clearly indicate unknown and stale observations. Show current readiness without guaranteeing future equipment availability.
- [ ] **P2-07 · Browser verification:** two student browser contexts and an FTS context demonstrate persistence, conflict recovery, live equipment updates and honest network failure.

**MVP exit gate:** student selects a real room/slot, reviews real equipment, commits a booking and retrieves it after reload; another client sees the slot occupied. An FTS change appears after refresh. All four pilot acceptance rows pass. Staff has a documented way to correct/cancel mistaken pilot bookings until student management arrives in P3.

## 5. P3 — Complete reservation management

**Features:** F03, F04, F05, F15

**Primary additions:** My Reservations pages, booking detail/reschedule endpoints, usage/policy tables, lifecycle services.

- [ ] **P3-01 · Owned reservations:** create Upcoming and Active views, timezone-aware state calculation, booking detail, persisted confirmation and pagination. Staff operational reservations use a separate permission-scoped view.
- [ ] **P3-02 · Cancellation:** implement cutoff/ownership checks, version-aware atomic claim release, idempotent repeated cancellation and contextual UI confirmation.
- [ ] **P3-03 · Rescheduling:** atomically exchange only changed claims, retain original booking on failure, and record change history. Handle same-room overlapping old/new ranges and cancel-versus-reschedule races.
- [ ] **P3-04 · Session equipment use:** build active-session asset selection, first-submission persistence and receipt; restrict selectable assets to the usable present setup. Save snapshots needed for future history. Student editing remains F18.
- [ ] **P3-05 · Rules:** publish versioned booking/handling policies; link them in discovery/review and enforce the same configuration server-side. Administrative changes record reasons.

**Exit gate:** cancelled slots can be booked again; failed rescheduling never loses the old reservation; active-session logs are attributable and deduplicated; displayed and enforced rules match.

## 6. P4 — Make room readiness operational

**Features:** F08, F09, F10, F11, F14, F17; extends F06/F07

**Primary additions:** room-condition/restriction data, repair/inspection/movement records, practice profiles and discovery services.

- [ ] **P4-01 · Room state:** capacity, condition, restrictions, operating windows and exceptional closures. Link each room to a location; resolve affected reservations when closing a room. Add staff management and student detail panels.
- [ ] **P4-02 · Repairs:** technician stages/updates, nullable ETA, overdue indication, completion inspection and public-safe item timeline.
- [ ] **P4-03 · Movements:** log actual movements, expected return and actual return; atomically update current location/version/audit and prevent two open movements. Scope student writes to policy-designated assets and their active session; permit the originating student to log a return after the session. Provide FTS corrections with an audit reason.
- [ ] **P4-04 · Suitability profiles:** agree acoustic/amplified vocal, band and instrument-specific requirements with faculty/FTS. Support quantity and accessory dependencies plus bring-your-own instruments.
- [ ] **P4-05 · Explained discovery:** filter hard constraints, compare present/functional/fresh equipment and return full/partial/unverified results with reasons. Carry criteria into booking review and recheck.
- [ ] **P4-06 · Staff freshness workflow:** opening checks, stale-inspection list, overdue movements and repairs without estimates. Configure periodic freshness/overdue computation without auto-returning physical assets.

**Exit gate:** the missing-mixer research scenario can be completed using live records: find its actual location, distinguish it from a repaired/unknown mixer, and identify an appropriate alternative room without claiming borrowing rights. Moved/damaged required assets cannot create a false full match.

## 7. P5 — Close the reporting/support loop

**Features:** F12, F13, F16

**Primary additions:** reports/update tables, Reports & Support screens, FTS queue and verified contact content.

- [ ] **P5-01 · Student reports:** equipment missing/damaged and room-maintenance forms with optional contextual links, validation and persisted references; support unknown equipment IDs.
- [ ] **P5-02 · Request status:** own reports/assistance list, details and visible responses; staff-private notes remain private. Avoid duplicate submissions with idempotency.
- [ ] **P5-03 · Staff queue:** filter, assign, acknowledge, investigate, resolve and reopen. Link inspections/repairs/closures as explicit verified actions, with audit.
- [ ] **P5-04 · Contact FTS:** verified contact channels/hours plus an in-app assistance request. Make it clear when a phone/email action merely opens the user's device app.

**Exit gate:** report creation, FTS response and student status view work across separate sessions; resolving a report records what changed. A student report alone does not rewrite equipment condition or cancel a reservation.

## 8. P6 — Validate and release Full V1

- [ ] **P6-01 · Acceptance walkthrough:** demonstrate every F01–F17 criterion with persistent staging data. Record feature ID, scenario, build SHA, result and evidence.
- [ ] **P6-02 · Product pilot:** run 10–15 student sessions covering vocal, band and individual practice plus FTS operations. Measure the PRD success targets and collect failures, not just task completion.
- [ ] **P6-03 · Quality:** run mobile/desktop and keyboard/reduced-motion/audio-off journeys, targeted accessibility checks, staging load measurements and actual Cloudflare resource-limit checks.
- [ ] **P6-04 · Operational rehearsal:** staged migration, inventory verification, monitoring, backup restoration to an isolated DB and previous-compatible-build rollback. Assign daily data and support owners.
- [ ] **P6-05 · Cutover:** reconcile any real reservations, import verified inventory, enable the operational app and monitor first-week booking conflicts/failed writes/stale assets. Record a release decision against the PRD completion criteria.

**Exit gate:** all 17 feature rows pass, no unresolved booking-integrity/account-boundary blocker remains, and FTS can keep the data current without direct database edits.

## 9. Traceability matrix

| Feature | Delivery | Principal evidence |
|---|---|---|
| F01 Availability | P2 | Live slot refresh, timezone/day boundaries, closure/past states |
| F02 Reserve | P1 + P2 | Concurrent D1 writes, idempotency, persisted browser confirmation |
| F03 Reschedule | P3 | Conflict preserves original; stale-version race is rejected |
| F04 Cancel | P3 | Ownership/cutoff; release then successful rebooking |
| F05 Equipment-use log | P3 | Active-owner-only, eligible assets, deduplicated receipt |
| F06 Setups/locations | P2, extended P4 | Default-versus-present view; live cross-client movement |
| F07 Condition | P2, extended P4 | Independent condition/location, verified update and freshness |
| F08 Repair progress | P4 | Unknown/overdue ETA, inspection-gated completion |
| F09 Vocal suitability | P4 | Acoustic/amplified profiles, missing-mixer exclusion |
| F10 Band suitability | P4 | Capacity/restrictions and complete required setup |
| F11 Instrument suitability | P4 | Chosen/own instrument and required accessories |
| F12 Equipment report | P5 | Submission, FTS triage, linked resolution and student visibility |
| F13 Room report | P5 | Contextual report and explicit closure/reservation handling |
| F14 Conditions/restrictions | P4 | Closed-room booking blocked at DB/service and UI |
| F15 Rules | P3 | Published version matches server enforcement |
| F16 FTS assistance | P5 | Verified contacts and persisted request in FTS queue |
| F17 Temporary relocation | P4 | Actor/policy permissions, one open move, atomic location update and actual return |
| F18/F19 research additions | V1.1 backlog | Estimate after V1; do not count internal audit/history storage as completed student features |

## 10. Meaningful test matrix

| Layer | Cases required |
|---|---|
| Unit | Real/invalid calendar dates; timezone midnight conversion; 1/6/7-slot durations; gap rejection; policy boundaries; stale/partial/moved equipment; setup quantities; search aliases/type ranking |
| D1 integration | Unique/idempotent slot generation; 20-way same/overlapping-slot races; adjacent bookings succeed; injected write failure rolls back; same student/different rooms; retry after lost response; repeated cancellation; overlapping reschedule; cancel/reschedule race; closure/booking race |
| API authorization | Anonymous operational writes fail; submitted admin role is ignored/rejected; revoked/deactivated session fails; cross-user reads/writes fail; technician/admin distinctions; private staff notes stay private |
| Equipment/support integration | Concurrent move/return rejects stale state; movement permissions and post-session return; repair completion requires inspection; report does not override verified facts; duplicate usage/report submission deduplicates |
| Browser | Booking from room discovery; reload confirmation; two-client conflict recovery; real failures never show success; reschedule failure preserves old booking; FTS update reaches student; report/assistance round trip |
| Operations | Clean install/local migration/preview; tracked staging migration; restore exercise; performance and deployment-size checks |

Existing baseline commands:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm exec tsc --noEmit
corepack pnpm lint
corepack pnpm build
```

P0/P1 must add documented scripts for the Worker/D1 and browser suites. They do not exist yet; `tests/concurrency-conflict.test.mjs` is a sequential simulation and is insufficient as the concurrency release gate.

## 11. First implementation pull requests

1. **Reproducible baseline:** migration configuration, environment contract, CI and lint baseline; verify build/local preview.
2. **Account boundaries:** student-only registration, managed bootstrap/seed, session/ownership guards and route tests.
3. **Canonical booking model:** room/location IDs, campus time, unique slots/claims and reviewed migration.
4. **Atomic booking service:** D1 batch/guards, idempotency, meaningful concurrent/failure tests.
5. **Connected booking slice:** typed live reads, corrected payload, real confirmation/error states and two-browser smoke.
6. **Connected equipment slice:** verified catalog, search parity, independent condition/location and staff updates.

Each PR should state the affected feature/task IDs, migration impact, demonstrated behavior and tests run. These are suggested future PR boundaries, not PRs already created.

## 12. Risks and responses

| Delivery risk | Concrete response |
|---|---|
| Staff cannot maintain reliable inventory | Pilot a small verified subset, name an FTS owner and measure daily spot-check accuracy before expanding. |
| Prototype data conflicts with institutional reality | Reconcile using stable codes/asset labels; keep research/demo facts distinct from verified operational records. |
| D1 batch behavior is implemented incorrectly | Make real Workers/D1 races and forced rollback tests a P1 gate; SQL guards must fail rather than silently change zero rows. |
| The large page makes integration fragile | Extract by vertical slice with behavior-preserving browser checks; keep demo assets separate from live state. |
| Hours/late-night policy stays unresolved | Resolve in P0; store absolute instants so opening-hour decisions do not force another data-model rewrite. |
| Scope grows to include F18/F19, SSO or notifications | Estimate and schedule explicitly; maintain traceability to the 17-feature Full V1 commitment. |
| Framework/deployment constraints consume time | Use the two-day P0 contingency rule and record any stack change with its migration cost. |

## 13. V1.1 backlog

- F18: student editing/correction UX for session usage and relocation records, preserving an audit trail and the approved movement authority.
- F19: student completed-reservation history and session-record review/search.
- Institutional SSO, automated password-recovery delivery and optional notifications once identity/contact arrangements are known.
- Report photos, QR asset labels, calendar export and operational utilization summaries based on pilot demand.
