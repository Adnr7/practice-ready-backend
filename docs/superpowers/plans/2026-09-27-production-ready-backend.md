# Production-Ready Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready, university-grade backend for Practice Ready using Cloudflare D1 (SQLite) and Drizzle ORM on Cloudflare Workers (Vinext/Next.js App Router), including edge authentication, atomic booking conflict prevention, full REST APIs, university seed data, frontend data integration with 100% design preservation, and removal of `.kiro/` generator files.

**Architecture:** Cloudflare D1 database managed via Drizzle ORM with foreign keys and compound indexes. REST API route handlers deployed on the Cloudflare Workers edge runtime via Vinext App Router (`app/api/.../route.ts`). Edge-native WebCrypto auth with role-based access control (`student` and `technician`/`admin`) in secure HTTP-only cookies. Concurrency-safe atomic booking transactions preventing double-booking and enforcing continuous 30-minute intervals up to 3 hours maximum.

**Tech Stack:** TypeScript, Next.js / Vinext, Cloudflare Workers & D1, Drizzle ORM, Drizzle Kit, Web Crypto API (`crypto.subtle`), Node test runner / Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-27-production-ready-backend-design.md`](file:///c:/Documents/github%20projs/practice-ready/docs/superpowers/specs/2026-09-27-production-ready-backend-design.md)

## Global Constraints
- Target Environment: Cloudflare Workers edge runtime + Cloudflare D1 (SQLite) via Drizzle ORM.
- Zero Frontend Visual Disruption: Frontend design, layouts, colors, CSS, sounds, animations, and typography in `app/page.tsx` must remain 100% untouched visually.
- Concurrency & Double-Booking: Must reject overlapping bookings with HTTP 409 Conflict atomically.
- Maximum Booking Duration: 3 hours (6 consecutive 30-minute slots) per booking.
- Repository Cleanup: Remove all `.kiro/` files.

---

### Task 1: Repository Cleanup & Foundation Scaffolding

**Files:**
- Remove: `.kiro/` (untracked directory)
- Create: `wrangler.json` (Cloudflare D1 database binding definition)
- Modify: `package.json` (add test & migration scripts)

**Interfaces:**
- Produces: Clean git working tree, valid D1 configuration for `practice_ready_db`, working `pnpm test` script.

- [ ] **Step 1: Remove `.kiro/` directory**
Remove the untracked `.kiro/` directory completely using a shell command.
Run:
```powershell
Remove-Item -Recurse -Force .kiro
```

- [ ] **Step 2: Create `wrangler.json` for Cloudflare D1 configuration**
Write `wrangler.json`:
```json
{
  "name": "practice-ready",
  "main": "dist/server/index.js",
  "compatibility_date": "2026-05-15",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "practice_ready_db",
      "database_id": "00000000-0000-4000-8000-000000000000"
    }
  ]
}
```

- [ ] **Step 3: Update `package.json` with database & test commands**
Add `"test": "node --test tests/**/*.test.mjs tests/**/*.test.ts"` and `"db:migrate": "drizzle-kit migrate"` to `"scripts"`.

- [ ] **Step 4: Verify repository status and clean tree**
Run: `git status`
Expected: `.kiro/` is no longer listed.

- [ ] **Step 5: Commit changes**
```bash
git add wrangler.json package.json
git commit -m "chore: clean kiro artifacts and configure Cloudflare D1 bindings"
```

---

### Task 2: Drizzle Database Schema & Migration Generation

**Files:**
- Create: `db/schema.ts`
- Modify: `db/index.ts`
- Generate: `drizzle/0000_init.sql` (via `drizzle-kit generate`)

**Interfaces:**
- Produces: Exported Drizzle tables `users`, `rooms`, `locations`, `equipment`, `timeSlots`, `bookings`, `bookingSlots`.
- Produces: `getDb(env?)` helper supporting both Workers `env.DB` and local development fallback.

- [ ] **Step 1: Write `db/schema.ts`**
Implement the complete schema with relations, enum constraints, foreign keys, and indexes:
```ts
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  fullName: text("full_name").notNull(),
  studentId: text("student_id"),
  role: text("role", { enum: ["student", "technician", "admin"] }).notNull().default("student"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  capacity: integer("capacity").notNull(),
  description: text("description").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(), // room, block, lab, storage
});

export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: text("equipment_id").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  modelName: text("model_name"),
  condition: text("condition").notNull().default("Fully functional"),
  status: text("status", { enum: ["ready", "away", "attention", "service", "missing"] }).notNull().default("ready"),
  defaultLocationId: integer("default_location_id").references(() => locations.id),
  currentLocationId: integer("current_location_id").notNull().references(() => locations.id),
  defaultRoomId: integer("default_room_id").references(() => rooms.id),
  lastInspectedAt: text("last_inspected_at"),
  notes: text("notes"),
}, (table) => [
  index("idx_equipment_room").on(table.defaultRoomId),
  index("idx_equipment_location").on(table.currentLocationId, table.status),
]);

export const timeSlots = sqliteTable("time_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  date: text("date").notNull(), // YYYY-MM-DD
  period: text("period").notNull(), // early-morning, morning, afternoon, evening, night, late-night
  startTime: text("start_time").notNull(), // HH:MM (24h)
  endTime: text("end_time").notNull(), // HH:MM
  status: text("status", { enum: ["available", "booked", "maintenance"] }).notNull().default("available"),
}, (table) => [
  index("idx_time_slots_lookup").on(table.roomId, table.date, table.status),
  index("idx_time_slots_range").on(table.roomId, table.date, table.startTime),
]);

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingRef: text("booking_ref").notNull().unique(),
  userId: integer("user_id").references(() => users.id),
  guestStudentName: text("guest_student_name"),
  guestStudentId: text("guest_student_id"),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  status: text("status", { enum: ["confirmed", "cancelled", "completed"] }).notNull().default("confirmed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_bookings_user").on(table.userId, table.date),
  index("idx_bookings_room_date").on(table.roomId, table.date),
]);

export const bookingSlots = sqliteTable("booking_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  timeSlotId: integer("time_slot_id").notNull().references(() => timeSlots.id),
});
```

- [ ] **Step 2: Update `db/index.ts` to handle local and edge D1 connections**
Update `db/index.ts` to export `getDb(optionalEnv?)` gracefully handling `env.DB` or passed context.

- [ ] **Step 3: Run `drizzle-kit generate` to generate migration SQL**
Run: `pnpm db:generate`
Expected: Created migration file in `drizzle/` directory.

- [ ] **Step 4: Verify migration file contents**
Inspect `drizzle/` to confirm all 7 tables and indexes are generated.

- [ ] **Step 5: Commit schema and migrations**
```bash
git add db/schema.ts db/index.ts drizzle/
git commit -m "feat(db): implement production Drizzle schema and initial migration"
```

---

### Task 3: Edge Authentication & WebCrypto Utilities

**Files:**
- Create: `lib/auth.ts`
- Create: `tests/auth.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export async function hashPassword(password: string): Promise<{ hash: string; salt: string }>
  export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean>
  export async function createSessionToken(payload: SessionPayload): Promise<string>
  export async function verifySessionToken(token: string): Promise<SessionPayload | null>
  export function parseCookies(header: string | null): Record<string, string>
  export function createSessionCookie(token: string): string
  export function createClearSessionCookie(): string
  ```

- [ ] **Step 1: Write failing test in `tests/auth.test.mjs`**
Write unit test checking password hashing/verification and session token generation/verification using standard WebCrypto.
```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, createSessionToken, verifySessionToken } from "../lib/auth.js";

describe("Edge Auth Utilities", () => {
  it("should hash and verify passwords correctly", async () => {
    const { hash, salt } = await hashPassword("musicPractice2026!");
    assert.ok(hash.length > 20);
    assert.ok(salt.length > 10);
    const valid = await verifyPassword("musicPractice2026!", hash, salt);
    assert.equal(valid, true);
    const invalid = await verifyPassword("wrongpassword", hash, salt);
    assert.equal(invalid, false);
  });

  it("should sign and verify session tokens", async () => {
    const payload = { userId: 42, email: "student@tsm.edu.in", fullName: "Elizabeth John", role: "student" };
    const token = await createSessionToken(payload);
    const verified = await verifySessionToken(token);
    assert.equal(verified?.userId, 42);
    assert.equal(verified?.email, "student@tsm.edu.in");
    assert.equal(verified?.role, "student");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node tests/auth.test.mjs`
Expected: FAIL (module `../lib/auth.js` not found).

- [ ] **Step 3: Implement `lib/auth.ts`**
Implement cryptographic hashing using PBKDF2 (`crypto.subtle.deriveBits`), HMAC-SHA256 token signing, and cookie serialization.

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/auth.test.mjs`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit auth module**
```bash
git add lib/auth.ts tests/auth.test.mjs
git commit -m "feat(auth): add edge-native WebCrypto authentication and session utilities"
```

---

### Task 4: Booking Engine & Conflict Prevention Logic

**Files:**
- Create: `lib/booking-engine.ts`
- Create: `tests/booking-engine.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export function validateBookingRequest(params: {
    date: string;
    startTime: string;
    endTime: string;
  }): { valid: boolean; error?: string; durationMinutes?: number; requiredSlots?: string[] }

  export function generateDailyTimeSlots(roomId: number, date: string): Array<{
    roomId: number;
    date: string;
    period: string;
    startTime: string;
    endTime: string;
    status: "available";
  }>
  ```

- [ ] **Step 1: Write failing test in `tests/booking-engine.test.mjs`**
Test cases:
1. Valid 1-hour booking: "09:00" to "10:00" -> valid: true, duration: 60, slots: ["09:00", "09:30"].
2. Invalid duration > 3 hours: "09:00" to "13:00" (4 hours) -> valid: false, error contains "exceeds maximum allowed duration of 3 hours".
3. Non-consecutive / invalid time alignment: "09:15" to "10:00" -> valid: false, error contains "30-minute intervals".
4. Negative or zero duration: "10:00" to "09:00" -> valid: false.

- [ ] **Step 2: Run test to verify it fails**
Run: `node tests/booking-engine.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/booking-engine.ts`**
Implement time calculations, 30-minute interval generator, 3-hour constraint enforcement, and period mapper (`early-morning`, `morning`, `afternoon`, `evening`, `night`, `late-night`).

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/booking-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit booking engine**
```bash
git add lib/booking-engine.ts tests/booking-engine.test.mjs
git commit -m "feat(booking): implement booking validation and slot calculation engine"
```

---

### Task 5: Authentication REST API Endpoints

**Files:**
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/me/route.ts`

**Interfaces:**
- `POST /api/auth/register`: registers student/technician, returns `{ user }` with HTTP-only cookie.
- `POST /api/auth/login`: verifies password, returns `{ user }` with HTTP-only cookie.
- `POST /api/auth/logout`: expires session cookie.
- `GET /api/auth/me`: decodes token from cookie, returns `{ user }` or `{ user: null }`.

- [ ] **Step 1: Implement `app/api/auth/register/route.ts`**
Handle student/staff registration, email validation, password hashing with salt, database insertion into `users`, and issuing session cookie.

- [ ] **Step 2: Implement `app/api/auth/login/route.ts`**
Handle user lookup by email, password verification via PBKDF2, and issuing session cookie.

- [ ] **Step 3: Implement `app/api/auth/logout/route.ts`**
Return `Response.json({ success: true })` with `Set-Cookie: pr_session=; Max-Age=0; Path=/`.

- [ ] **Step 4: Implement `app/api/auth/me/route.ts`**
Extract `pr_session` from incoming request headers, verify token signature, return `{ user: session }`.

- [ ] **Step 5: Commit auth API routes**
```bash
git add app/api/auth/
git commit -m "feat(api): implement auth registration, login, logout, and me endpoints"
```

---

### Task 6: Rooms, Equipment & Availability REST API Endpoints

**Files:**
- Create: `app/api/rooms/route.ts`
- Create: `app/api/availability/route.ts`
- Create: `app/api/equipment/route.ts`
- Create: `app/api/equipment/room/[roomId]/route.ts`
- Create: `app/api/equipment/[id]/route.ts`

**Interfaces:**
- `GET /api/rooms`: lists active MPRs with capacity and description.
- `GET /api/availability?roomId=X&date=YYYY-MM-DD`: returns 30-minute slots grouped by period with availability status.
- `GET /api/equipment?query=guitar&type=mixer&locationId=1`: filters equipment inventory.
- `GET /api/equipment/room/[roomId]`: returns room readiness categorized by `available`, `away`, and `attention`.
- `PATCH /api/equipment/[id]`: updates condition and physical location (requires `technician` or `admin`).

- [ ] **Step 1: Implement `app/api/rooms/route.ts`**
Fetch active rooms from database ordered by ID.

- [ ] **Step 2: Implement `app/api/availability/route.ts`**
Accept `roomId` and `date`. Query `timeSlots` table. If slots for date don't exist yet, automatically generate slots using `generateDailyTimeSlots` and batch-insert. Return slots grouped by period.

- [ ] **Step 3: Implement `app/api/equipment/route.ts`**
Implement search filtering with case-insensitive name matching, type matching, and location filtering.

- [ ] **Step 4: Implement `app/api/equipment/room/[roomId]/route.ts`**
Fetch equipment assigned to `roomId`. Group into:
- `ready`: located in room and fully functional.
- `away`: assigned to room but current location is elsewhere.
- `attention`: needs service/inspection or missing.

- [ ] **Step 5: Implement `app/api/equipment/[id]/route.ts`**
Handle condition and location updates with role authorization check.

- [ ] **Step 6: Commit rooms and equipment APIs**
```bash
git add app/api/rooms/ app/api/availability/ app/api/equipment/
git commit -m "feat(api): implement rooms, availability, and equipment readiness endpoints"
```

---

### Task 7: Bookings REST API Endpoints with Atomic Conflict Prevention

**Files:**
- Create: `app/api/bookings/route.ts`
- Create: `app/api/bookings/[id]/route.ts`
- Create: `tests/concurrency-conflict.test.mjs`

**Interfaces:**
- `POST /api/bookings`: atomic booking reservation with conflict check. Returns 201 on success or 409 on overlap conflict.
- `GET /api/bookings`: lists user's bookings (or all if admin).
- `DELETE /api/bookings/[id]`: cancels booking and frees time slots.

- [ ] **Step 1: Write test for conflict detection in `tests/concurrency-conflict.test.mjs`**
Test booking validation against overlapping slot arrays and ensure 409 Conflict is returned when a slot is already booked.

- [ ] **Step 2: Implement `POST /api/bookings` in `app/api/bookings/route.ts`**
1. Validate inputs via `validateBookingRequest`.
2. Check user session or accept guest booking details.
3. Query matching `time_slots` for requested range.
4. If any slot is `booked` or `maintenance`, return `409 Conflict` with `conflictingSlots`.
5. Insert `bookings` record with unique booking reference (`PR-YYYY-XXXX`).
6. Update matching `time_slots` to status `"booked"`.
7. Insert `booking_slots` links.
8. Return 201 Created with `{ booking }`.

- [ ] **Step 3: Implement `GET /api/bookings` in `app/api/bookings/route.ts`**
Return upcoming and past bookings for the authenticated user (or all bookings if technician/admin).

- [ ] **Step 4: Implement `DELETE /api/bookings/[id]/route.ts`**
Find booking, verify ownership (or admin role), update linked `time_slots` back to `"available"`, mark booking `"cancelled"`.

- [ ] **Step 5: Run tests and commit**
Run: `node tests/concurrency-conflict.test.mjs`
```bash
git add app/api/bookings/ tests/concurrency-conflict.test.mjs
git commit -m "feat(api): implement booking creation with atomic conflict engine and cancellation"
```

---

### Task 8: Seeding Engine for True School of Music Dataset

**Files:**
- Create: `lib/seed-data.ts`
- Create: `app/api/seed/route.ts`
- Create: `scripts/seed-database.ts`

**Interfaces:**
- Produces: 5 MPR rooms (MPR 2, 3, 4, 5, Performance Hall), 8 campus locations, 40+ authentic music gear items matching the prototype, and 14 days of pre-generated 30-minute slots.
- `POST /api/seed`: triggers idempotent database population.

- [ ] **Step 1: Create `lib/seed-data.ts`**
Export structured initial data arrays matching the True School of Music specifications:
- Rooms: MPR 2 (Ensemble/Keys), MPR 3 (Band/Drums), MPR 4 (Vocal), MPR 5 (Production), Performance Hall.
- Locations: MPR 2, MPR 3, MPR 4, MPR 5, Performance Hall, Arts Block A, MP Lab 1, Central Gear Storage.
- Equipment: Pianos (Yamaha P-125, Roland FP-30X, Casio Privia), Drum sets (Pearl Export parts), Microphones (Shure SM58, wireless mics), PA speakers (JBL EON ONE MK2), Mixers (Yamaha MG10XU), Stands, Cables.
- Admin user: `admin@tsm.edu.in` / `tsmAdmin2026!` (role: `admin`).

- [ ] **Step 2: Create `app/api/seed/route.ts`**
Endpoint that inserts seed data into D1 tables if empty (or resets on `?force=true`).

- [ ] **Step 3: Create `scripts/seed-database.ts`**
CLI script for manual or CI execution.

- [ ] **Step 4: Verify seed data generation**
Run seed script or test insertion into SQLite.

- [ ] **Step 5: Commit seed engine**
```bash
git add lib/seed-data.ts app/api/seed/ scripts/seed-database.ts
git commit -m "feat(seed): add True School of Music database seeder and seed endpoint"
```

---

### Task 9: Non-Disruptive Frontend API Client Integration

**Files:**
- Create: `lib/api-client.ts`
- Modify: `app/page.tsx` (connect backend data fetching without altering ANY visual elements, styles, sounds, or layouts)

**Interfaces:**
- `lib/api-client.ts`: provides typed async functions `apiGetRooms()`, `apiGetAvailability(roomId, date)`, `apiGetRoomEquipment(roomId)`, `apiCreateBooking(payload)`.
- Fallback: Gracefully returns initial mock arrays if backend is unreachable.

- [ ] **Step 1: Create `lib/api-client.ts`**
Implement typed client helpers with fallback to mock data on network errors.

- [ ] **Step 2: Wire `apiGetAvailability` and `apiCreateBooking` into `app/page.tsx`**
- Connect booking confirmation button to `apiCreateBooking`.
- If conflict is returned (`409`), trigger existing conflict screen and `playPracticeReadyConflictTone()`.
- If success is returned (`201`), trigger existing success screen and `playPracticeReadySuccessChime()`.
- **CRITICAL**: Maintain 100% of the existing JSX, CSS class names, audio triggers, animations, and dark/light themes.

- [ ] **Step 3: Verify frontend compiles and builds cleanly**
Run: `pnpm build`
Expected: Build passes with no TypeScript errors.

- [ ] **Step 4: Commit frontend integration**
```bash
git add lib/api-client.ts app/page.tsx
git commit -m "feat(frontend): connect API client to booking and availability flow while preserving UI 100%"
```

---

### Task 10: End-to-End Verification & Production Readiness Review

**Files:**
- Modify: `README.md` (add production backend architecture, API documentation, and D1 deployment guide)

- [ ] **Step 1: Run all test suites**
Run: `node --test tests/**/*.test.mjs`
Expected: All tests pass.

- [ ] **Step 2: Run full build check**
Run: `pnpm build`
Expected: Production build completes with zero errors.

- [ ] **Step 3: Update `README.md` with Backend Architecture & API Guide**
Document D1 setup, Drizzle migrations, REST API reference table, and university deployment steps.

- [ ] **Step 4: Final git status check and commit**
```bash
git status
git add README.md
git commit -m "docs: document production backend architecture and deployment workflow"
```

---
