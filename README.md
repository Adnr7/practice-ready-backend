# Practice Ready

**Find a suitable music practice room, check its equipment, and reserve it with confidence.**

Practice Ready is a student and facilities application for Music Practice Rooms (MPRs) at the True School of Music (TSM). This repository extends the original HCI prototype with a TypeScript backend on Cloudflare Workers and D1.

**Current status:** interactive prototype plus a partially integrated backend. Live availability, reservation, equipment, schedule and booking-status paths now exist, but account boundaries, full booking lifecycle support and several V1 workflows still need implementation. The target is all **17 features** in the supplied V1 scope diagram.

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
- Current **WebCrypto credential/session helpers**; the target architecture adds revocable sessions and stronger account boundaries.
- **Node's test runner** for existing unit tests; real Worker/D1 integration and browser suites are planned.

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

- **Node.js >=22.13.0**; baseline checks used Node 22.22.0.
- **pnpm 11.25.0**, pinned in `package.json`. Commands below use Corepack; if Corepack is unavailable, install the pinned pnpm version and replace `corepack pnpm` with `pnpm`.
- Git. Cloudflare credentials are needed for remote resources, not the local D1 preview below.

Clone this repository, open a terminal in its root, then run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Configure local/runtime secrets before using authentication or seeding:

```bash
cat > .dev.vars <<'EOF'
AUTH_SECRET=replace-with-a-long-random-session-secret
SEED_TOKEN=replace-with-a-separate-seed-token
ADMIN_PASSWORD=replace-with-a-strong-admin-password
# Optional demo student account:
# STUDENT_PASSWORD=replace-with-a-strong-student-password
EOF
```

For Cloudflare deployment, store these values with `wrangler secret put`
instead of committing them. Public registration always creates student
accounts; technician and admin accounts are provisioned by an administrator or
the seed process.

### Initialize an empty local database

The current SQL lives under `drizzle/`, but root Wrangler configuration does not yet set `migrations_dir`. For a **new, empty local database**, apply the checked-in migrations explicitly, in order:

```bash
for migration in drizzle/0000_lush_misty_knight.sql drizzle/0001_new_the_hood.sql drizzle/0002_rich_korath.sql; do
  corepack pnpm exec wrangler d1 execute practice_ready_db --local --persist-to .wrangler/state --file "$migration"
done
```

These bootstrap commands are not idempotent: skip them if these tables already exist. They also do not populate Wrangler's migration ledger. Do not use `db:generate` as a substitute for applying an existing migration.

Start the built application against the local Worker/D1 state:

```bash
corepack pnpm start --port 8787
```

Open **http://127.0.0.1:8787**. In a second terminal, initialize the **local demo** dataset and verify a read:

```bash
SEED_TOKEN=replace-with-the-value-from-.dev.vars
curl --fail-with-body -X POST http://127.0.0.1:8787/api/seed \
  -H "Authorization: Bearer ${SEED_TOKEN}"
curl --fail-with-body http://127.0.0.1:8787/api/rooms
```

The seed requires either an administrator session or the configured seed token,
and `ADMIN_PASSWORD` is required when bootstrapping the administrator. It
creates illustrative inventory for local evaluation, not production
provisioning. The checked baseline produced 5 rooms, 8 locations, 32 assets
and 2,520 slots for 14 days. Use IDs returned by the API: room names do not
equal database IDs.

### Development and checks

```bash
corepack pnpm dev
corepack pnpm test
corepack pnpm exec tsc --noEmit
corepack pnpm lint
corepack pnpm build
```

Portable `dev` selects port 5173. The build/preview workflow above was verified for local API/database work; check the effective `DB` binding when using a different execution profile.

| Script | Meaning |
|---|---|
| `dev` | Development server through the repository's framework wrapper |
| `build` | Build Worker/server and browser assets |
| `start` | Run the built Worker locally using `dist/server/wrangler.json` and `.wrangler/state` |
| `test` | Node unit tests plus D1-backed booking and movement integration tests |
| `lint` | ESLint; baseline findings are listed below |
| `db:generate` | Generate SQL after changing `db/schema.ts`; review generated changes |
| `db:migrate` | Currently invokes Drizzle migration without a configured database target; use the documented local bootstrap until P0 completes migration setup |

### Configuration

| Setting / file | Current meaning |
|---|---|
| `DB` | Cloudflare D1 binding expected by `db/index.ts` |
| `AUTH_SECRET` | Required session-signing secret; takes precedence over `JWT_SECRET` |
| `JWT_SECRET` | Legacy alternative used by current auth code |
| `SEED_TOKEN` | Optional bearer token for controlled local/operator seeding |
| `ADMIN_PASSWORD` | Required, 12+ characters, when the seed bootstraps the admin |
| `STUDENT_PASSWORD` | Optional password for the local demo student account |
| `.dev.vars` | Local Worker secrets file; ignored and never commit it |
| `wrangler.json` | Worker identity and a specific D1 database ID; remote environments need their own bindings |
| `.openai/hosting.json` | Inherited hosting metadata naming `DB` |

Authentication now fails closed when no secret is configured. Do not treat
local seed accounts or the inherited Sites sign-in mock as operational
authentication; the application uses its own `pr_session` cookie.

## Existing API routes

This table describes **current code**, not the proposed final contract. Responses and authorization will change as the planned foundations are implemented.

| Method | Route | Current behavior |
|---|---|---|
| POST | `/api/auth/register` | Creates a student account/session; submitted technician/admin roles are ignored |
| POST | `/api/auth/login` | Credential login and session cookie |
| POST | `/api/auth/logout` | Clears the session cookie |
| GET | `/api/auth/me` | Current profile or null user |
| GET | `/api/rooms` | Public active-room list |
| GET | `/api/availability?roomId=&date=YYYY-MM-DD` | Public slots grouped by period; may generate missing slots |
| POST | `/api/bookings` | Validates and reserves slots through the D1 booking store; still accepts evaluation guest requests |
| GET | `/api/bookings?filter=upcoming\|past` | Own bookings, all for staff; unauthenticated requests return an empty list |
| DELETE | `/api/bookings/:id` | Owner/staff cancellation with a start-time cutoff and transactional slot release |
| GET | `/api/bookings/status?ref=` | Returns the current booking phase for the active-reservation card |
| GET | `/api/equipment?query=&type=&locationId=&status=` | Public inventory search/filter |
| GET | `/api/equipment/room/:roomId` | Default room equipment grouped by readiness |
| PATCH | `/api/equipment/:id` | Technician/admin condition/location update |
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

Rescheduling, usage logs, repair tracking, suitability, reports and support requests require new endpoints/workflows. See the [target API design](docs/ARCHITECTURE.md).

## Verification snapshot — 2026-10-04

Checks were run against backend baseline `d0f1682` while preparing these documents:

| Check | Result |
|---|---|
| Frozen dependency installation | Passed with pnpm 11.25.0 |
| `npm test` | **13 passed**, 0 failed |
| `corepack pnpm exec tsc --noEmit` | Passed |
| `corepack pnpm build` | Passed; reported a large client-chunk warning |
| `corepack pnpm lint` | **20 existing errors, 22 warnings**; tracked in P0 |
| Local D1 schema / built Worker / seed / room reads | Passed using the bootstrap/preview commands above |
| Concurrent API writes / browser acceptance / remote deployment | Not verified by these baseline checks; explicit implementation release gates |

The current conflict test operates on arrays sequentially. It does not establish database concurrency safety. The booking UI now uses the backend session when one exists, while anonymous booking remains supported by the current backend route. Equipment directory and room setup reads use the live API by default; the legacy fixture presentation is available only with the explicit `?demo=1` query parameter (or `NEXT_PUBLIC_DEMO_PRESENTATION=true`). Other fixture-backed prototype journeys and unsupported booking lifecycle flows remain outside this integration.

## Deployment direction

Host the application/API on Cloudflare Workers and its database on D1. GitHub Pages is appropriate for the research case study, not the operational backend.

The release workflow is: complete P0/P1 foundations → configure separate staging/production resources and secrets → apply tracked migrations → build → deploy with the generated Worker configuration → run authenticated smoke/concurrency checks. The [architecture](docs/ARCHITECTURE.md) describes migration, rollback and restore requirements. The `start` script previews locally; it does not publish a Worker.

## Next development milestone

Begin with **P0 and P1** in the [implementation plan](docs/IMPLEMENTATION_PLAN.md): repeatable migration/CI setup, account boundaries, canonical room/time identities and atomic bookings. Then connect the four MVP journeys before adding the rest of V1.
