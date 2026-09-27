# Production-Ready Backend System Specification for Practice Ready

**Document Version:** 1.0.0  
**Date:** 2026-09-27  
**Status:** Approved for Implementation  
**Target Environment:** Cloudflare Workers + Cloudflare D1 (SQLite) + Drizzle ORM + Vinext (Next.js App Router)

---

## 1. Executive Summary & Objective

**Practice Ready** is an HCI/UI-UX product built for the True School of Music (TSM) to solve critical operational challenges around Music Practice Room (MPR) bookings and equipment readiness.

The current system has an evaluated, highly responsive frontend with subtle music/audio layers, consecutive slot selection, equipment tracking, and simulated conflict demos, but relies on hardcoded in-memory state.

This specification details the production-ready backend architecture designed for institutional sale to a university or music conservatory. The backend provides:
1. **Persistent Cloudflare D1 Database** via **Drizzle ORM** with relational integrity, cascading slot assignments, and indexed queries.
2. **Edge-Native Authentication & RBAC** supporting Students (with university email and student ID validation) and Campus Technicians/Admins (with equipment condition and physical location update authority).
3. **Deterministic Booking & Conflict Prevention Engine** with transactional atomicity, enforcing continuous 30-minute slots and a maximum 3-hour booking limit.
4. **Comprehensive REST API Surface** for rooms, availability, equipment readiness, and booking lifecycle management.
5. **Zero Design Disruption on Frontend**: The frontend visual layout, CSS styling, ambient backgrounds, and audio feedback remain 100% intact, while data layers are connected to live API endpoints.
6. **Repository Sanitation**: Complete removal of temporary `.kiro/` artifacts.

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers Runtime                      │
│                                                                        │
│  ┌────────────────────────┐         ┌───────────────────────────────┐  │
│  │   Next.js / Vinext     │         │       REST API Endpoints      │  │
│  │   Client UI Components │ ◄─────► │     (app/api/.../route.ts)    │  │
│  │    (Preserved 100%)    │  fetch  │   - Auth & Session Cookies    │  │
│  └────────────────────────┘         │   - Availability & Slots      │  │
│                                     │   - Atomic Booking Engine     │  │
│                                     │   - Equipment Readiness       │  │
│                                     └──────────────┬────────────────┘  │
│                                                    │                   │
│                                     ┌──────────────▼────────────────┐  │
│                                     │          Drizzle ORM          │  │
│                                     │   (drizzle-orm/d1 + Schema)   │  │
│                                     └──────────────┬────────────────┘  │
└────────────────────────────────────────────────────┼───────────────────┘
                                                     │
                                      ┌──────────────▼────────────────┐
                                      │    Cloudflare D1 (SQLite)     │
                                      │   - Users & Sessions          │
                                      │   - Rooms & Locations         │
                                      │   - Equipment & Conditions    │
                                      │   - Slots & Atomic Bookings   │
                                      └───────────────────────────────┘
```

---

## 3. Database Schema Design ([`db/schema.ts`](file:///c:/Documents/github%20projs/practice-ready/db/schema.ts))

The schema is defined using `drizzle-orm/sqlite-core`.

### 3.1 Table Definitions

#### `users`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `email`: `text("email").notNull().unique()`
* `passwordHash`: `text("password_hash").notNull()`
* `salt`: `text("salt").notNull()`
* `fullName`: `text("full_name").notNull()`
* `studentId`: `text("student_id")`
* `role`: `text("role", { enum: ["student", "technician", "admin"] }).notNull().default("student")`
* `createdAt`: `text("created_at").notNull().default(sql\`CURRENT_TIMESTAMP\`)`

#### `rooms`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `name`: `text("name").notNull()` (e.g., `"MPR 3"`)
* `code`: `text("code").notNull().unique()` (e.g., `"mpr-3"`)
* `capacity`: `integer("capacity").notNull()`
* `description`: `text("description").notNull()`
* `isActive`: `integer("is_active", { mode: "boolean" }).notNull().default(true)`

#### `locations`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `code`: `text("code").notNull().unique()` (e.g., `"arts-block-a"`, `"mp-lab-1"`)
* `name`: `text("name").notNull()` (e.g., `"Arts Block A"`)
* `type`: `text("type").notNull()` (`"room" | "block" | "lab" | "storage"`)

#### `equipment`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `equipmentId`: `text("equipment_id").notNull().unique()` (e.g., `"KEY-01"`, `"MIX-01"`)
* `name`: `text("name").notNull()` (e.g., `"Yamaha P-125 digital piano"`)
* `type`: `text("type").notNull()` (`"keyboard" | "mixer" | "speaker" | "drum" | "mic" | "cable" | "stand" | "accessory"`)
* `modelName`: `text("model_name")`
* `condition`: `text("condition").notNull().default("Fully functional")`
* `status`: `text("status", { enum: ["ready", "away", "attention", "service", "missing"] }).notNull().default("ready")`
* `defaultLocationId`: `integer("default_location_id").references(() => locations.id)`
* `currentLocationId`: `integer("current_location_id").notNull().references(() => locations.id)`
* `defaultRoomId`: `integer("default_room_id").references(() => rooms.id)`
* `lastInspectedAt`: `text("last_inspected_at")`
* `notes`: `text("notes")`

#### `time_slots`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `roomId`: `integer("room_id").notNull().references(() => rooms.id)`
* `date`: `text("date").notNull()` (`YYYY-MM-DD`)
* `period`: `text("period").notNull()` (`"early-morning" | "morning" | "afternoon" | "evening" | "night" | "late-night"`)
* `startTime`: `text("start_time").notNull()` (`HH:MM`, 24h format, e.g., `"09:00"`)
* `endTime`: `text("end_time").notNull()` (`HH:MM`, e.g., `"09:30"`)
* `status`: `text("status", { enum: ["available", "booked", "maintenance"] }).notNull().default("available")`

#### `bookings`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `bookingRef`: `text("booking_ref").notNull().unique()` (e.g., `"PR-2026-9482"`)
* `userId`: `integer("user_id").references(() => users.id)`
* `guestStudentName`: `text("guest_student_name")`
* `guestStudentId`: `text("guest_student_id")`
* `roomId`: `integer("room_id").notNull().references(() => rooms.id)`
* `date`: `text("date").notNull()` (`YYYY-MM-DD`)
* `startTime`: `text("start_time").notNull()` (`HH:MM`)
* `endTime`: `text("end_time").notNull()` (`HH:MM`)
* `durationMinutes`: `integer("duration_minutes").notNull()`
* `status`: `text("status", { enum: ["confirmed", "cancelled", "completed"] }).notNull().default("confirmed")`
* `createdAt`: `text("created_at").notNull().default(sql\`CURRENT_TIMESTAMP\`)`

#### `booking_slots`
* `id`: `integer("id").primaryKey({ autoIncrement: true })`
* `bookingId`: `integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" })`
* `timeSlotId`: `integer("time_slot_id").notNull().references(() => time_slots.id)`

### 3.2 Database Indexes
* `idx_time_slots_lookup`: `(room_id, date, status)`
* `idx_time_slots_range`: `(room_id, date, start_time)`
* `idx_equipment_room`: `(default_room_id)`
* `idx_equipment_current_location`: `(current_location_id)`
* `idx_bookings_user`: `(user_id, date)`

---

## 4. Authentication, Security & RBAC ([`lib/auth.ts`](file:///c:/Documents/github%20projs/practice-ready/lib/auth.ts))

### 4.1 Edge-Native Web Crypto Implementation
* Utilizes `crypto.subtle` for standard PBKDF2 key derivation and HMAC-SHA256 signature verification.
* Session tokens signed with HMAC-SHA256 secret stored in environment variables (`JWT_SECRET` / `AUTH_SECRET`), falling back to a deterministic development secret.
* Cookies issued with `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Max-Age=86400` (24 hours).

### 4.2 Role Permissions
| Role | Capabilities |
|---|---|
| `student` | Book up to 3 consecutive hours, view personal upcoming/past bookings, cancel own bookings before start time. |
| `technician` | All student capabilities + update equipment condition, update equipment physical location, log maintenance. |
| `admin` | Full system control: room activation/deactivation, slot maintenance locking, viewing all institutional bookings. |
| `guest` | Unauthenticated visitor allowed during prototype evaluation to explore and execute simulated reservations. |

---

## 5. REST API Specifications

### 5.1 Authentication Endpoints
* `POST /api/auth/register`:
  - Request: `{ email, password, fullName, studentId }`
  - Validates email format and student ID format.
  - Returns: `{ user: { id, email, fullName, role } }` with `Set-Cookie`.
* `POST /api/auth/login`:
  - Request: `{ email, password }`
  - Returns: `{ user: { id, email, fullName, role } }` with `Set-Cookie`.
* `POST /api/auth/logout`:
  - Clears `pr_session` cookie.
* `GET /api/auth/me`:
  - Returns current user profile or `{ user: null }`.

### 5.2 Room & Availability Endpoints
* `GET /api/rooms`:
  - Returns all active rooms with equipment count, capacity, and current readiness status summary.
* `GET /api/availability?date=YYYY-MM-DD&roomId=X`:
  - Returns all 30-minute slots for the given room and date, grouped into periods: `early-morning`, `morning`, `afternoon`, `evening`, `night`, `late-night`.
  - For each slot: `{ id, startTime, endTime, period, status: "available" | "booked" | "maintenance" }`.

### 5.3 Booking & Conflict Detection Engine
* `POST /api/bookings`:
  - Request: `{ roomId, date, startTime, endTime, guestName?, guestStudentId? }`
  - **Validation Pipeline**:
    1. Verify date is valid (>= today).
    2. Verify start time and end time are aligned to 30-minute steps.
    3. Verify duration <= 180 minutes (3 hours max).
    4. Compute required slot intervals between start and end.
  - **Atomic Concurrency Check**:
    - Runs in D1 transaction.
    - Selects all slots in `[startTime, endTime)` for `roomId` and `date`.
    - If count mismatch or any slot is not `"available"`, returns:
      ```json
      {
        "error": "Booking conflict detected: One or more selected time slots have already been reserved.",
        "conflictingSlots": ["10:30", "11:00"]
      }
      ```
      Status: `409 Conflict`.
    - Otherwise, inserts `bookings` record, inserts `booking_slots`, updates matching `time_slots` to `"booked"`.
    - Returns: `{ booking: { id, bookingRef, date, startTime, endTime, status } }` with status `201 Created`.
* `GET /api/bookings?filter=upcoming|past`:
  - Returns user's bookings (or all if admin).
* `DELETE /api/bookings/[id]`:
  - Releases associated time slots back to `"available"`, marks booking status `"cancelled"`.

### 5.4 Equipment Readiness Endpoints
* `GET /api/equipment?query=&type=&locationId=&status=`:
  - Full-text search and filtering across equipment inventory.
* `GET /api/equipment/room/[roomId]`:
  - Returns readiness breakdown for the room:
    - `available`: equipment assigned to room and currently located in room.
    - `away`: equipment assigned to room but currently relocated elsewhere.
    - `attention`: equipment with condition issues or requiring inspection.
* `PATCH /api/equipment/[id]`:
  - Requires `technician` or `admin` role.
  - Request: `{ condition?: string, currentLocationId?: number, status?: string, notes?: string }`.
  - Updates equipment status and records inspection timestamp.

### 5.5 Database Initialization & Seed Endpoint
* `POST /api/seed`:
  - Automatically initializes rooms, locations, equipment inventory (40+ items matching prototype data), and generates daily slots for the next 14 days.

---

## 6. Frontend Integration & Compatibility Rules

**CRITICAL REQUIREMENT:** The visual frontend design, styles, ambient backgrounds, animations, and sound design must remain completely unaffected.

1. **Lightweight Data Layer**:
   Create [`lib/api-client.ts`](file:///c:/Documents/github%20projs/practice-ready/lib/api-client.ts) providing:
   - `fetchRooms()`
   - `fetchRoomAvailability(roomId, date)`
   - `fetchRoomEquipment(roomId)`
   - `createBooking(payload)`
   - `searchEquipment(query)`
2. **Resilient Fallback**:
   If the API returns an error or is unreachable (e.g., during static preview or build), the client falls back to the high-fidelity mock data already embedded in the app.
3. **Sound & Interaction Preservation**:
   All booking success chimes, conflict tones, and UI click sounds remain triggered on live API success/conflict responses.

---

## 7. Artifact Cleanup Plan

The following untracked files generated by Kiro will be removed:
- `.kiro/specs/practice-ready-backend/requirements.md`
- `.kiro/specs/practice-ready-backend/.config.kiro`
- Entire `.kiro/` directory

All necessary requirements, constraints, and business logic have been absorbed into this formal specification.

---

## 8. Verification & Test Plan

1. **Unit & Integration Tests**:
   - `tests/booking-rules.test.ts`: Test consecutive slot validator, 3-hour limit validator, conflict rejection.
   - `tests/auth.test.ts`: Test password hashing, JWT creation/verification, role guard.
2. **Drizzle Schema & Migrations**:
   - Run `pnpm db:generate` to generate SQL migration files in `drizzle/`.
3. **Seed & Live Route Verification**:
   - Trigger seed to populate SQLite database.
   - Query `/api/availability` and verify generated 30-minute intervals.
   - Submit concurrent booking to verify deterministic `409 Conflict`.
4. **Build Verification**:
   - Run `pnpm build` to verify TypeScript type checking and bundle generation.
