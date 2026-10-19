# Practice Ready

**Find a suitable music practice room, check its equipment, and reserve it with confidence.**

Practice Ready is a student and facilities application for Music Practice Rooms (MPRs) at the True School of Music (TSM). This repository extends the original HCI prototype with a TypeScript backend on Cloudflare Workers and D1.

**Current status:** the backend supports the current Asmi room, date-window, authentication, availability, booking, reservation, equipment, and reports/support contracts locally with persistent D1 storage. The full local suite passes **178 tests**. The deployed Worker/database has not been changed here; its current remote schema is known to be behind this migration sequence. See [current state](docs/CURRENT_STATE.md).

## Start with the project documents

| Document | What it answers |
|---|---|
| [PRD](docs/PRD.md) | Who the product serves, all 17 requirements, acceptance criteria, business rules and pilot goals |
| [Implementation plan](docs/IMPLEMENTATION_PLAN.md) | What to build first, dependencies, estimates, work packages and release gates |
| [Architecture](docs/ARCHITECTURE.md) | Stack decision, proposed schema, API contracts, authentication and atomic booking design |
| [Current-state audit](docs/CURRENT_STATE.md) | What the repository actually implements and the concrete gaps to close |

The October 2026 documents are the proposed implementation baseline. Documents under `docs/superpowers/` record the earlier backend design and are retained as historical context.

## Project and research links

- **Backend repository:** https://github.com/Adnr7/practice-ready-backend
- **Original project:** https://github.com/asmib170/practice-ready
- **Research case study:** https://asmib170.github.io/practice-ready/
- **Original interactive prototype:** https://practice-ready.asmi-battoo.workers.dev

The research and prototype were created by Asmi B. The case study explains the missing-mixer scenario, interviews, card sorting, tree testing and feature prioritization. Prototype room/equipment data is illustrative; an operational rollout needs an FTS-verified inventory. The linked prototype is not evidence that this backend branch is deployed there.

## Product scope

| Area | Full V1 capabilities |
|---|---|
| **Find a Room** | Vocal practice (9), band rehearsals (10), individual instrument practice (11), room conditions and restrictions (14) |
| **Equipment** | Room setups and equipment locations (6), working condition (7), repair progress and expected return (8), temporary relocation logging (17) |
| **Reservations / My Reservations** | Availability (1), reserve (2), reschedule (3), cancel (4), session equipment-use logging (5), booking/usage rules (15) |
| **Reports & Support** | Missing/damaged equipment reports (12), room-maintenance reports (13), FTS assistance (16) |

The first pilot contains the research's four Must-Haves: **1, 2, 6 and 7**, supported by authentication, reliable persistence and staff updates. Full V1 completes the remaining features. The published research later added **18: edit equipment records** and **19: completed session history**; these are identified as V1.1 candidates in the plan.

## Stack and repository map

- **TypeScript, React 19, Tailwind CSS** and existing UI components.
- **Vinext / Vite**, using Next.js-style App Router pages and API handlers.
- **Cloudflare Workers + D1 (SQLite)**, with Drizzle ORM and SQL migrations.
- **WebCrypto credentials and opaque, revocable D1 sessions**; active accounts and current roles are checked on protected requests.
- **Node's test runner**, real Worker/D1 integration, concurrent write tests, and tracked migration rehearsals; browser automation remains open.

```text
app/page.tsx             Main prototype UI; live inventory/session reads plus prototype journeys
app/api/                 Existing REST route handlers
components/              UI components
db/                      Database binding and schema
drizzle/                 Initial SQL migration and Drizzle metadata
lib/                     Booking engine, auth, API client, seed data, images
tests/                   Existing auth, API, booking-rule/store and conflict-simulation tests
scripts/                 Development/build/environment tooling
docs/                    PRD, architecture, audit and implementation roadmap
assets/, public/         Case-study and application media
wrangler.json            Root Worker/D1 configuration
vite.config.ts           Vinext and Cloudflare build configuration
```

**Recommended direction:** extend the existing stack in small, tested vertical slices. The [architecture](docs/ARCHITECTURE.md) explains the decision and the specific contingency for a framework blocker.

## Local setup

### Prerequisites

- Linux, **Node.js 22.23.3** (`.nvmrc`), Corepack, GNU Make, and Git. With an existing nvm installation, run `nvm install && nvm use` in this checkout.
- **pnpm 11.25.0**, pinned in the existing `package.json`; keep `pnpm-lock.yaml` and use frozen installs. Setup uses Corepack without enabling global shims or installing global packages. Package-manager downloads, dependency store, and caches stay under `.sites-runtime/` in this checkout.
- The first setup needs registry access. Local migration/run/test commands need installed dependencies and loopback networking for workerd, but no Cloudflare credentials or Internet access. The Dockerfile includes the Linux system packages needed by this workflow.

Clone the repository, enter its root, and run:

```bash
make setup
cp .env.example .dev.vars
```

Replace the placeholders in the ignored `.dev.vars` with separate local values. `ADMIN_PASSWORD` must contain at least 12 characters; `STUDENT_PASSWORD` is optional. Never commit the populated file. `.env.example` is a template: Wrangler reads **`.dev.vars`**, not that template.

`make setup-offline` repeats the frozen install without network access **after** this checkout's Corepack cache and pnpm store have been populated. It fails if a required package/tool is absent. Ordinary `make test` does not run an install or invoke Corepack at all.

To rehearse a completely clean dependency installation without replacing the working checkout's `node_modules`, run `node scripts/rehearse-setup.mjs`. It installs into a disposable directory under `.sites-runtime/`, verifies an offline rerun and unchanged lockfile, then removes the disposable installation. This explicit setup rehearsal needs registry access on its first pass and is separate from `make test`.

### Apply local migrations and run

Use the tracked runner for both a fresh database and a clean tracked upgrade:

```bash
make db-preflight
make db-migrate
make db-migrate
make build
make start
```


The second apply reports **No migrations to apply**. The runner validates the journal/SQL sequence, runs preflight, then invokes the project's pinned `wrangler d1 migrations apply DB --local`. SQL `0000` through `0011_asmi_overnight_bookings.sql` is applied in numeric order; each complete migration and its `d1_migrations` ledger insertion run in one D1 transaction. Migration `0011` adds overnight end dates, the Asmi student-window marker, and forward-safe overlap/closure triggers. A failed migration rolls back; earlier successful migrations remain tracked. Never remove an applied ledger entry to force a replay.

Default persistence is `.wrangler/state`, shared by migrate and the built preview. Override **both** commands together for an isolated environment:

```bash
make db-migrate STATE=.wrangler/rehearsal
make start STATE=.wrangler/rehearsal PORT=8788
```

The `db:migrate` and `db:preflight` package scripts are aliases; extra runner arguments are `--persist-to DIRECTORY` and `--json` (preflight only). The runner supports local databases only. It takes a per-state `.migration.lock`; after an interrupted process, remove a stale lock only after confirming no other runner is active. Stop application writers during an upgrade. Preflight reads application data/schema without modifying them; opening a fresh local emulator creates its persistence files.

Open **http://127.0.0.1:8787**. In a second terminal, optionally initialize the **local demo** and verify a read:

```bash
SEED_TOKEN=replace-with-the-value-from-.dev.vars
curl --fail-with-body -X POST http://127.0.0.1:8787/api/seed \
  -H "Authorization: Bearer ${SEED_TOKEN}"
curl --fail-with-body http://127.0.0.1:8787/api/rooms
```

The seed requires an administrator session or the configured seed token, and `ADMIN_PASSWORD` when bootstrapping the administrator. It creates illustrative inventory for local evaluation. Public registration creates student accounts; staff accounts require administrator provisioning. Use room/location IDs returned by the API.

### Legacy database preflight and migration-generation boundary

```bash
make db-preflight STATE=.wrangler/state
node scripts/migrate.mjs preflight --persist-to .wrangler/state --json
```

A nonzero exit blocks apply and reports concrete rows/object names for:

- Existing application tables without a ledger, unknown/out-of-order/missing ledger entries, or a schema that differs from the exact tracked migration prefix (including partial table/column/index/trigger changes).
- Duplicate room/date/start slots, duplicate booking-slot links, overlapping confirmed bookings, or multiple confirmed bookings claiming the same canonical slot.
- Rooms without matching location codes before `0006`, or null/nonexistent location IDs after `0006`; and existing foreign-key violations.
- Legacy report categories/statuses or history statuses incompatible with the CHECK constraints added by `0003`. Valid populated history is supported; nullable history statuses remain valid. Preflight reports incompatible values without rewriting them.

**Corrected `0003` populated upgrades:** the original migration rebuilt the child table before dropping its parent; in a D1 migration transaction, `PRAGMA foreign_keys=OFF` was ineffective and the parent drop cascaded deletion of report history. The corrected SQL keeps foreign keys enabled, stages history in a table without foreign keys, removes the old child before rebuilding the parent, then restores all history into the constrained child table. Every report/history column, ID, timestamp, nullable value, relationship, and AUTOINCREMENT high-water mark is preserved. Wrangler applies the complete rebuild plus its ledger row atomically; invalid legacy report/history statuses or report categories cause rollback of schema, data, staging tables, sequences, and the ledger insertion.

**Historical recovery:** databases whose ledger already contains `0003_amusing_nekra.sql` will not rerun it. This correction cannot recover history deleted by the old version. Restoring historically lost data requires a pre-migration backup and an owner-reviewed recovery on a disposable copy before applying it to a live database; do not delete ledger rows or force migration replay to attempt recovery.

The old explicit `d1 execute --file` loop created **untracked** databases. Do not replay it, reset a populated database, insert guessed ledger rows, delete duplicates, or automatically choose booking/location owners. Back up first, inspect schema/data with the owner, and develop an explicit reviewed reconciliation/baseline plan on a disposable copy. The runner deliberately offers no automatic adoption, reset, or destructive reconciliation. A schema-only export is insufficient for the data checks. Read-only preflight cannot recover history already lost by an earlier migration.

**`db:generate` is explicitly disabled** and exits unsuccessfully. Snapshots exist only through `0003`, although the journal and SQL continue through `0011`; invoking Drizzle generation directly can recreate existing objects and omit hand-written constraints/triggers. Apply the existing SQL with `make db-migrate`. Re-enable generation only after repairing/reviewing the complete snapshot chain against a freshly migrated D1 database and proving unchanged schema produces no generated migration. Never use generation as bootstrap.

### Development and checks

```bash
make test
make test-migrations
make typecheck
make lint
make build
make smoke-built
make dev
```

**The single offline test command is `make test`**, after setup. It runs Node's test runner and the installed Wrangler/Miniflare/workerd tools, disables Cloudflare metadata fetch and telemetry, and does not download anything. Migration tests create/remove isolated OS-temp databases; they never apply SQL to the developer's `.wrangler/state`. They exercise real Wrangler fresh apply/rerun, transactional rollback with the ledger, preserved data, and blocked legacy states. Existing business-test migration lists are retained; the new shared helpers are in `scripts/migration-tools.mjs` for a coordinated future extraction.

Portable `make dev` selects port 5173. Use the **built** `make start` preview for D1 workflows; Vite's development binding overrides differ from the root Wrangler configuration. Confirm the generated `dist/server/wrangler.json` binds `DB` to the intended database before preview/deployment.

| Script | Meaning |
|---|---|
| `install:ci` | Node 22.23.3 check and project-local pnpm 11.25.0 frozen installation |
| `dev` | Development server through the repository's framework wrapper |
| `build` | Build Worker/server and browser assets |
| `start` | Run the built Worker locally using `dist/server/wrangler.json` and `.wrangler/state` |
| `test` / `test:migrations` | Offline full suite / isolated migration suite |
| `lint` | ESLint |
| `db:generate` | Blocked until Drizzle snapshots are repaired |
| `db:preflight` | Inspect tracked/legacy local state and report blockers |
| `db:migrate` | Preflight, tracked local apply, and post-apply verification |

### Docker local preview

```bash
docker build -t practice-ready:local .
docker volume create practice-ready-d1
docker run --rm -p 127.0.0.1:8787:8787 \
  --mount type=volume,src=practice-ready-d1,dst=/app/.wrangler/state \
  --mount "type=bind,src=$(pwd)/.dev.vars,dst=/app/.dev.vars,readonly" \
  practice-ready:local
```

The pinned Node image installs all dependencies using the existing frozen lockfile, runs `make test`, then builds. Container startup preflights/applies local migrations and serves the built Worker on port 8787; the volume retains D1 state across restarts. `.dockerignore` excludes local secrets, dependency trees, developer databases and caches. The image needs network access to build; its installed test suite and local migration/preview workflow do not need cloud access. This is the containerized local preview, while Cloudflare Workers is the deployment target.

### Setup verification — 2026-10-18

`node scripts/rehearse-setup.mjs` passed a clean frozen install of 628 packages with pnpm 11.25.0, followed by an offline rerun; the lockfile was unchanged. The integrated suite passes **178 tests**, including **12 migration tests**, with typecheck/lint passing. The `0003` populated upgrade preserves every report/history column and ID with foreign keys ON. `node scripts/smoke-built.mjs` exercises the actual built Worker with disposable secrets and isolated D1 state and passes SSR, seed, auth/session restoration, booking replay, journal/image/report persistence, and staff boundaries. Docker is unavailable here, so Docker build/run remains unverified.

### Configuration

| Setting / file | Current meaning |
|---|---|
| `DB` | Cloudflare D1 binding expected by `db/index.ts` |
| `AUTH_SECRET` | Secret for remaining legacy credential/session-signing helpers; current revocable sessions are stored in D1 |
| `JWT_SECRET` | Legacy fallback for signing helpers; prefer `AUTH_SECRET` |
| `SEED_TOKEN` | Optional bearer token for controlled local/operator seeding |
| `ADMIN_PASSWORD` | Required, 12+ characters, when the seed bootstraps the admin |
| `STUDENT_PASSWORD` | Optional password for the local demo student account |
| `.env.example` / `.dev.vars` | Checked-in placeholders / ignored local Worker secrets |
| `wrangler.json` | Worker identity and a specific D1 database ID; remote environments need their own bindings |
| `.openai/hosting.json` | Inherited hosting metadata naming `DB` |

The application uses its own `pr_session` cookie and D1 session records. The inherited Sites sign-in mock does not provision an operational application account.

## Existing API routes

This table describes the implemented backend contract. The original frontend still needs to consume some of the newer workflows directly.

| Method | Route | Current behavior |
|---|---|---|
| POST | `/api/auth/register` | Creates a student account/session; submitted technician/admin roles are ignored |
| POST | `/api/auth/login` | Credential login and session cookie |
| POST | `/api/auth/logout` | Revokes the current D1 session and clears its cookie |
| GET/PATCH | `/api/auth/me` | Current active profile; authenticated users can update name and phone |
| GET | `/api/rooms` | Public active-room list |
| GET | `/api/availability?roomId=&date=YYYY-MM-DD` | Public slots grouped by period; may generate missing slots |
| POST | `/api/bookings` | Authenticated, validated booking creation with optional `Idempotency-Key` replay protection |
| GET | `/api/bookings?filter=upcoming\|past` | Own bookings, all for staff; unauthenticated requests return an empty list |
| GET | `/api/bookings/:id` | Owner/staff booking detail with lifecycle/session state |
| PATCH | `/api/bookings/:id/reschedule` | Owner/staff reschedule with conflict checks and history |
| DELETE | `/api/bookings/:id` | Owner/staff cancellation with a start-time cutoff and transactional slot release |
| POST | `/api/bookings/:id/end-session` | Owner/staff session close with history |
| GET/PUT | `/api/bookings/:id/journal` | Student practice journal persistence with owned attachments |
| GET | `/api/bookings/:id/history` | Owner/staff booking, usage, movement, and report history |
| GET | `/api/bookings/status?ref=` | Returns the current booking phase for the active-reservation card |
| GET | `/api/equipment?query=&type=&locationId=&status=` | Public inventory search/filter |
| GET | `/api/equipment/room/:roomId` | Default room equipment grouped by readiness |
| POST | `/api/equipment` | Technician/admin equipment catalog creation |
| PATCH | `/api/equipment/:id` | Validated, audited catalog/archive changes; physical moves must use the movement ledger |
| POST | `/api/equipment/:id/movements` | Authenticated user records a move and atomically updates the current location |
| GET | `/api/movements?mine=true` | Authenticated user's persistent movement history; staff may request all movements with `mine=false` |
| POST | `/api/movements/:id/return` | Owner or staff records a return to the original location and creates a return event |
| PATCH | `/api/movements/:id` | Technician/admin corrects the current location and creates a correction event |
| GET | `/api/schedule?date=` | Public room schedule for the operational day, including booked display names |
| POST | `/api/seed` | Controlled seed using an admin session or configured bearer token |
| POST | `/api/reports` | Authenticated student/staff report or FTS assistance request; returns a report reference |
| GET | `/api/reports` | Authenticated current-user report list |
| GET | `/api/reports/:id` | Authenticated owner or staff report detail with update history |
| PATCH | `/api/reports/:id` | Technician/admin status and message update |
| POST | `/api/attachments` | Authenticated small image attachment storage |
| GET | `/api/attachments/:id` | Owner/staff attachment retrieval |
| GET | `/api/policies/current` or `/api/policy/current` | Current booking and equipment-handling policy |
| GET | `/api/support/contact` | Published support contact directory |
| GET | `/api/locations` | Public location directory |
| GET | `/api/practice-profiles` | Active practice profiles and requirements |
| POST | `/api/practice-profiles` | Administrator practice profile creation |
| GET | `/api/staff/students` | Technician/admin student lookup |
| GET | `/api/staff/audit` | Technician/admin audit-event listing |
| GET/POST | `/api/staff/locations` | Technician/admin location listing and creation |
| PUT | `/api/staff/rooms/:id/profiles` | Administrator room/practice-profile suitability state |
| PUT | `/api/staff/practice-profiles/:id/requirements` | Administrator replacement of profile requirements |
| GET/POST/PATCH | `/api/staff/operations` | Staff workspace data and audited room catalog create/edit/archive |
| POST | `/api/staff/reports/:id/action` | Atomic report-to-repair or report-to-closure with conflict/version checks |
| GET/PUT | `/api/staff/movement-permissions` | Staff designation/revocation of exact equipment/destination pairs |
| GET | `/api/equipment/:id/movements?bookingId=` | Permitted destinations for the active owner, all destinations for staff |

The student Home UI retains only the current Asmi actions: booking, room availability, reservations, equipment, and reports/support. The backend also retains role-gated FTS/admin routes for operational support; they are not new student navigation. Student movement permission defaults to denied until staff designate an equipment/destination pair. Repair completion requires the latest passed inspection tied to that repair; it resolves the linked report atomically and never treats an ETA as an actual return.

## Verification snapshot — 2026-10-18

| Check | Result |
|---|---|
| Frozen dependency installation | Passed with pnpm 11.25.0 |
| `make test` | **178 passed**, 0 failed; no cloud/network dependency after setup |
| `make typecheck` | Passed |
| `make build` | Passed; large client-chunk warning remains |
| `make lint` | Passed with 4 existing `no-img-element` warnings |
| `make smoke-built` | Passed; built Worker SSR, isolated seed, auth/session restoration, booking replay, and persistence |
| Concurrent writes | Covered: booking claims, same-key creation, room closure versus booking, cross-room student overlap, movement revocation and repair updates |
| Browser acceptance / Docker / remote deployment | Not verified |

Tests cover real route ownership/roles, revocable sessions, journal/image persistence, exact replay/expiry/rollback, report-to-repair/closure actions, inspection safety, and clean/populated migration paths. The built-Worker Home SSR check is currently failing while policy API reads and local seeding succeed. Resolve that preview failure before browser/staging acceptance; passing API/unit tests do not prove the application is release-ready.

## Deployment direction

Host the application/API on Cloudflare Workers and its database on D1. GitHub Pages is appropriate for the research case study, not the operational backend.

The commands below are **operator steps**, requiring Cloudflare access; no remote migrations or deployment were run during local setup verification.

1. Complete local checks and a build: `make setup && make test && make typecheck && make lint && make build`. Keep staging and production databases/Worker names distinct.
2. Authenticate the **installed** CLI (`node node_modules/wrangler/bin/wrangler.js login`), or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your deployment environment. Create a staging database:

   ```bash
   node node_modules/wrangler/bin/wrangler.js d1 create practice-ready-staging
   cp dist/server/wrangler.json dist/server/wrangler.deploy.json
   ```

   In the copied JSON, set `name` to `practice-ready-staging`. Set/add its `d1_databases` entry with `binding: "DB"`, `database_name: "practice-ready-staging"`, `database_id` equal to the ID returned by `d1 create`, and `migrations_dir: "../../drizzle"`. Remove a stale `preview_database_id`. Preserve generated `main`, assets, compatibility settings, and other required bindings. Use `dist/server/wrangler.deploy.json` for **all** remaining commands; do not deploy the root's inherited database ID by accident. Recreate this deployment copy after every build, since `dist/` is generated.
3. For an existing database, stop writers and take a full data/schema/ledger backup. Export with:

   ```bash
   node node_modules/wrangler/bin/wrangler.js d1 export DB --remote \
     --config dist/server/wrangler.deploy.json --output .wrangler/predeploy-backup.sql
   node node_modules/wrangler/bin/wrangler.js d1 execute DB --local \
     --config wrangler.json --persist-to .wrangler/predeploy-audit \
     --file .wrangler/predeploy-backup.sql
   make db-preflight STATE=.wrangler/predeploy-audit
   make db-migrate STATE=.wrangler/predeploy-audit
   make db-migrate STATE=.wrangler/predeploy-audit
   ```

   Start with a **new disposable** audit state directory for each backup, not a previously migrated audit DB. Store the backup securely outside the image and verify the export includes `d1_migrations`; an absent ledger, drift, conflicts, unmapped rooms, or incompatible legacy report/history values requires an explicit owner-reviewed recovery/baseline plan. Do not bypass blockers by guessing migration entries. Validate important record counts/history on the upgraded copy; preflight is not a substitute for business-invariant review. If the old `0003` has already deleted history, recovery requires a pre-migration backup as described above. For a genuinely new empty remote database, rehearse with `make test-migrations` instead of restoring an export.
4. Apply tracked remote migrations, then list the ledger-backed state:

   ```bash
   node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config dist/server/wrangler.deploy.json
   node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config dist/server/wrangler.deploy.json
   ```

   Direct Wrangler remote apply does not run this repository's local preflight; the restored-backup rehearsal in step 3 is required for populated databases. Keep writers stopped between the snapshot/rehearsal and remote apply so the audited data does not change.
5. Set secrets interactively (never place actual secrets in this README or a tracked file), then publish the built Worker:

   ```bash
   node node_modules/wrangler/bin/wrangler.js secret put AUTH_SECRET --config dist/server/wrangler.deploy.json
   node node_modules/wrangler/bin/wrangler.js secret put SEED_TOKEN --config dist/server/wrangler.deploy.json
   node node_modules/wrangler/bin/wrangler.js secret put ADMIN_PASSWORD --config dist/server/wrangler.deploy.json
   node node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.deploy.json
   ```

   Provision real inventory/staff through controlled operator workflows. Test sign-in, room reads, a booking/readback, logout revocation, and applicable staff workflows on staging before repeating with a separate production configuration/database. `make start` is a local preview and never publishes a Worker. There are no automatic down migrations: follow the reviewed backup/restore or forward-fix plan in the [architecture](docs/ARCHITECTURE.md).

## Next development milestone

Complete the remaining original discovery/navigation parity (dynamic rooms and user-selected band instrumentation), browser journeys and cold-start investigation; add production login throttling/account recovery, configuration edit coverage, and staging backup/migration/deployment rehearsal. Existing untracked databases must be reconciled on a backed-up copy rather than reset or guessed into the ledger.
