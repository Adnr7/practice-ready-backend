# Current implementation and handoff

**Reviewed:** 2026-10-18. **Development baseline:** `3f8ea73`; this handoff describes the verified workflow-integration change built on that baseline. No remote application deployment or database migration was performed.

This records actual local code and verification, not approval of institutional data or a production-readiness certification. The [PRD](PRD.md) and original frontend audit (previously inspected at `07f5963`) remain the requirements baseline. The original repository was not freshly fetched during this continuation.

## Implemented and connected

| Workflow | Current result | Main evidence |
|---|---|---|
| Accounts | Student-only registration, exact password handling, opaque random D1 sessions with hashed storage, expiry, logout revocation, current active-account/role checks | `tests/auth.test.mjs`, `tests/session-store.test.mjs` |
| Reservations | Authenticated create, active/upcoming/history, reschedule, cancellation, end-session, usage receipts and persistent history | `tests/booking-store.test.mjs`, `tests/reservation-lifecycle.test.mjs` |
| Creation retries | Booking/report mutation and exact response snapshot commit in one D1 batch; same-key races replay once, mismatches return 409, expired keys can be reused | `tests/idempotency.test.mjs` |
| Scheduling invariants | Transaction triggers prevent room/user overlaps and closure/booking races, including rescheduling; start midnight differs from end-of-day midnight | `tests/operational-integrity.test.mjs` |
| Journal and images | Reservation journal read/write, up to three owned attachments, private image byte retrieval, composite usage/movement/report history | `components/live-journal.tsx`, `tests/workflow-routes.test.mjs` |
| Reports/support | Live equipment/room/assistance forms and queue, photos, booking context, status history, policies and support contacts | `components/live-workflows.tsx`, `tests/reports.test.mjs` |
| Practice suitability | Live configured profiles/requirements, party size, bring-own input, room readiness/capacity/closure/restriction/equipment explanations; archived assets excluded | Home → Practice Fit & Rules; `tests/room-readiness.test.mjs` |
| Equipment moves | Persistent moves/returns/corrections. Student creation requires owned active room, equipment present, exact staff designation for the destination, and bounded future return. Revocation never blocks an owner's return | `tests/movement-permissions.test.mjs`, `tests/equipment-movements.test.mjs` |
| Staff workspace | Role-gated catalog and room create/edit/archive, readiness/closures, report triage/linking, repairs/inspections, reservation reschedule/cancellation with reasons, policy/configuration, student/audit lookup | `components/live-staff.tsx`, `tests/staff-operations.test.mjs` |
| Repairs | Atomic job/history/equipment/audit, nullable ETA, latest passed same-job inspection gate, optimistic concurrent updates, actual ready/away projection, atomic linked-report resolution | `tests/repairs-safety.test.mjs` |
| Rebuild/migrations | Node 22.23.3, pnpm 11.25.0/lockfile, project-local setup, offline `make test`, tracked and rerunnable D1 migrations, preflight, Dockerfile | `tests/migrations.test.mjs`, `README.md` |

Operational availability no longer substitutes fixture occupancy when either half of the operational-day API read fails. It shows a load error and retry instead. Explicit demo presentation remains distinct from persistent server workflows.

## Database changes

- `0007_frontend_workflows.sql`: profile/catalog fields, journal, image attachments, policy versions on bookings, support contacts, audit and idempotency records, reservation-linked movements. Nullable attachment/reservation links have foreign keys on clean migration.
- `0008_sessions.sql`: revocable opaque sessions; existing legacy signed cookies deliberately require sign-in again.
- `0009_operational_integrity.sql`: serialized write-time booking/closure guards and student cross-room overlap protection. Trigger constraints are intentional manual SQL, not represented completely by Drizzle snapshots.
- `0010_movement_permissions.sql`: default-deny equipment/destination designations and staff management. No real institutional move permission is assumed or seeded.
- `0003_amusing_nekra.sql` is corrected for pending populated upgrades: the old parent rebuild could cascade-delete report history because PRAGMA foreign-key disabling is ineffective in a D1 migration transaction. Regression tests now preserve all rows, values, IDs, sequences and relationships, with atomic rollback on incompatible data. Already-applied migrations do not rerun; historical lost data requires a pre-migration backup.

`make db-migrate` applies local tracked migrations through `0010`. Never run the old untracked SQL loop against a populated DB. Existing untracked/manual state or schema drift is blocked for operator review; no destructive reset or guessed ledger adoption is provided. Stop writers and rehearse on a full backup copy before an existing deployment upgrade.

`db:generate` is deliberately blocked: snapshot metadata stops at `0003`. Use the checked-in reviewed SQL until snapshots are repaired and a no-op generation is proven. Details and exact deployment commands are in `README.md`.

## Actual checks

| Command | Result |
|---|---|
| `make test` | **173 passed, 0 failed**, including 12 real Wrangler migration tests |
| `make typecheck` | Passed |
| `make lint` | 0 errors; four pre-existing `no-img-element` warnings in `app/page.tsx` |
| `make build` | Passed; large client-chunk warning remains |
| `make smoke-built` | Build passed, but the latest pre-publication smoke and its standalone retry failed at Home SSR with Miniflare `Network connection lost` (HTTP 500). Earlier integrated runs passed the complete smoke. This check is currently failing. |
| `node scripts/rehearse-setup.mjs` | Clean frozen project-local install and offline rerun passed; lockfile unchanged |
| `git diff --check` | Passed |
| Docker | Tool unavailable; Docker build/run not verified |
| Browser interaction / remote deployment | Not executed; no Playwright/browser or staging/production certification |

Built-preview SSR failures have recurred: earlier standalone runs and a build-plus-smoke passed, but both latest pre-publication attempts returned HTTP 500 on `/`, with Miniflare reporting `Network connection lost`; policy reads and seeding succeeded. The cause is not resolved. Treat this as a local preview/release blocker, not merely a staging follow-up. A separate seed setup timeout under concurrent checks was corrected by giving the thousands-of-rows seed a 60-second setup allowance; ordinary smoke requests retain 15-second deadlines. Smoke fixtures use disposable secrets, temporary isolated databases and no developer `.dev.vars` or live D1 data.

## Remaining work — do not claim full parity yet

1. **Preview stability and browser acceptance:** resolve the current built-Worker Home SSR failure, then exercise student/staff journeys, two-browser persistence, refresh/back navigation, read failures, expired/deactivated sessions and mobile accessibility. API/SSR smoke is not a browser-interaction test.
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
