# Current implementation and handoff

**Reviewed:** 2026-10-18. The current Asmi frontend was freshly inspected at `asmib170/practice-ready@635d534`; no remote application deployment or database migration was performed.

This records actual local code and verification, not approval of institutional data or a production-readiness certification. The [PRD](PRD.md) and the current Asmi main branch remain the requirements baseline. Asmi's current UI has seven bookable rooms and a 06:00 today/tomorrow booking release window; this backend supplies persistence without adding new student Home cards.

## Implemented and connected

| Workflow | Current result | Main evidence |
|---|---|---|
| Accounts | Student-only registration, exact password handling, opaque random D1 sessions with hashed storage, expiry, logout revocation, current active-account/role checks | `tests/auth.test.mjs`, `tests/session-store.test.mjs` |
| Asmi account UI | Asmi-style animated login, two-step signup, password visibility/reset-demo states, server-backed session login/logout, avatar menu and account profile dialog | `components/asmi-account.tsx`, `components/login-atmosphere.tsx` |
| Reservations | Authenticated create, active/upcoming/history, reschedule, cancellation, end-session, usage receipts and persistent history | `tests/booking-store.test.mjs`, `tests/reservation-lifecycle.test.mjs` |
| Asmi availability UI | Seven-room, 48-half-hour live timetable with date navigation, mobile room selection, booked/own/past states and full-screen mode; reads `/api/rooms` and `/api/availability` without fixture fallback | `components/room-availability-calendar.tsx`, `app/page.tsx` |
| Creation retries | Booking/report mutation and exact response snapshot commit in one D1 batch; same-key races replay once, mismatches return 409, expired keys can be reused | `tests/idempotency.test.mjs` |
| Scheduling invariants | Transaction triggers prevent room/user overlaps and closure/booking races, including rescheduling; start midnight differs from end-of-day midnight | `tests/operational-integrity.test.mjs` |
| Journal and images | Reservation journal read/write, up to three owned attachments, private image byte retrieval, composite usage/movement/report history | `components/live-journal.tsx`, `tests/workflow-routes.test.mjs` |
| Reports/support | Live equipment/room/assistance forms and queue, photos, booking context, status history, policies and support contacts | `components/live-workflows.tsx`, `tests/reports.test.mjs` |
| Practice suitability | Backend read remains available for the original support/configuration surface; it is not exposed as a new Home card | `tests/room-readiness.test.mjs` |
| Equipment moves | Persistent moves/returns/corrections. Student creation requires owned active room, equipment present, exact staff designation for the destination, and bounded future return. Revocation never blocks an owner's return | `tests/movement-permissions.test.mjs`, `tests/equipment-movements.test.mjs` |
| Staff operations | Role-gated backend operations remain available for FTS administration; no Staff Workspace card was retained in the student Home UI | `tests/staff-operations.test.mjs` |
| Repairs | Atomic job/history/equipment/audit, nullable ETA, latest passed same-job inspection gate, optimistic concurrent updates, actual ready/away projection, atomic linked-report resolution | `tests/repairs-safety.test.mjs` |
| Rebuild/migrations | Node 22.23.3, pnpm 11.25.0/lockfile, project-local setup, offline `make test`, tracked and rerunnable D1 migrations, preflight, Dockerfile | `tests/migrations.test.mjs`, `README.md` |

Operational availability no longer substitutes fixture occupancy when either half of the operational-day API read fails. It shows a load error and retry instead. Explicit demo presentation remains distinct from persistent server workflows.

## Database changes

- `0007_frontend_workflows.sql`: profile/catalog fields, journal, image attachments, policy versions on bookings, support contacts, audit and idempotency records, reservation-linked movements. Nullable attachment/reservation links have foreign keys on clean migration.
- `0008_sessions.sql`: revocable opaque sessions; existing legacy signed cookies deliberately require sign-in again.
- `0009_operational_integrity.sql`: serialized write-time booking/closure guards and student cross-room overlap protection. Trigger constraints are intentional manual SQL, not represented completely by Drizzle snapshots.
- `0010_movement_permissions.sql`: default-deny equipment/destination designations and staff management. No real institutional move permission is assumed or seeded.
- `0011_asmi_overnight_bookings.sql`: Asmi student-window policy marker, explicit overnight end dates, and overlap/closure triggers that understand the next calendar date.
- `0003_amusing_nekra.sql` is corrected for pending populated upgrades: the old parent rebuild could cascade-delete report history because PRAGMA foreign-key disabling is ineffective in a D1 migration transaction. Regression tests now preserve all rows, values, IDs, sequences and relationships, with atomic rollback on incompatible data. Already-applied migrations do not rerun; historical lost data requires a pre-migration backup.

`make db-migrate` applies local tracked migrations through `0011_asmi_overnight_bookings.sql`. The remote Worker currently reports schema errors (`rooms.location_id`, `rooms.readiness_state`, and missing `booking_policies`), proving that its D1 state is behind the code/migration sequence. No remote migration was run because it was not authorized.

`db:generate` is deliberately blocked: snapshot metadata stops at `0003`. Use the checked-in reviewed SQL until snapshots are repaired and a no-op generation is proven. Details and exact deployment commands are in `README.md`.

## Actual checks

| Command | Result |
|---|---|
| `make test` | **178 passed, 0 failed**, including 12 real Wrangler migration tests |
| `make typecheck` | Passed |
| `make lint` | 0 errors; four pre-existing `no-img-element` warnings in `app/page.tsx` |
| `make build` | Passed; large client-chunk warning remains |
| `make smoke-built` | Passed against the actual built Worker with isolated D1 state; the deterministic smoke uses a legacy-window policy override while `tests/asmi-contract.test.mjs` covers the live Asmi window. |
| `node scripts/rehearse-setup.mjs` | Clean frozen project-local install and offline rerun passed; lockfile unchanged |
| `git diff --check` | Passed |
| Docker | Tool unavailable; Docker build/run not verified |
| Browser interaction / remote deployment | Not executed; no Playwright/browser or staging/production certification |

The built Worker smoke now passes with a 60-second request bound. It uses disposable secrets, temporary isolated databases and no developer `.dev.vars` or live D1 data. This is local evidence only and is not remote deployment evidence.

## Remaining work — do not claim full parity yet

1. **Browser acceptance:** exercise student/staff journeys, two-browser persistence, refresh/back navigation, read failures, expired/deactivated sessions and mobile accessibility. API/SSR smoke is not a browser-interaction test.
2. **Legacy discovery/navigation:** the original single-page flow still has fixed MPR selections and alternative-equipment prototype paths. The new suitability screen uses real configuration but does not prefill booking, and band instrumentation is a configured profile rather than a fully user-selected instrument list. New staff-created rooms require full dynamic discovery/booking UI coverage.
3. **Configuration completeness:** contact directory currently has creation but no edit/archive UI; location/profile configuration mutation coverage and audit consistency need expansion. Do not imply every privileged mutation is audited simply because an audit table exists.
4. **Production account operations:** login throttling, account recovery, institutional provisioning/eligibility, retention/cleanup and deployment-specific same-origin/security review remain. Revocable sessions are implemented; these are separate controls.
5. **Institutional truth:** verify pilot inventory, room mappings, allowed destinations, support details/hours, freshness thresholds and policy with the owners. Seeded inventory and policy are illustrative defaults, not approved facts.
6. **Release operations:** rehearse migration/restore against the actual staging backup, verify cold starts and load, and run the container on a machine with Docker. No remote writes or deployment were authorized/run here.

## Resume here

1. Inspect `git status --short --branch` and the full diff, including untracked files, before staging further changes. Git publication is separate from application deployment and D1 migration.
2. Run `make test && make typecheck && make lint && make smoke-built` after further changes. `make smoke-built` rebuilds first and uses disposable local state.
3. Finish dynamic discovery/band inputs and browser coverage, then configuration maintenance and staging acceptance. Preserve real local data; do not bypass migration preflight blockers.
4. When a commit/push is explicitly requested, review intended files and exclude `.dev.vars`, credentials, logs, dependency trees, builds and local databases.
