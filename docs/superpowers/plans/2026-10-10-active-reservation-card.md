# Live "Your Active Reservation" Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live-updating "Your Active Reservation" card at the top of Home for the most recent booking made on this device, with a ticking countdown and server-synced status.

**Architecture:** A public read-only endpoint `GET /api/bookings/status?ref=` derives a booking's phase (upcoming / in_progress / completed / cancelled) on the institution clock. The client remembers the last booking in `localStorage`, polls the endpoint every 30s to sync status, and ticks a local clock every 30s for the countdown. The card is display-only and disappears once completed or cancelled.

**Tech Stack:** Next.js App Router (vinext), Drizzle ORM + Cloudflare D1, React 19, Tailwind 4, `node --test --experimental-strip-types`.

## Global Constraints

- No new dependencies; no DB schema or migration changes.
- The status endpoint is public (no session/auth). Bookings remain guest-based.
- Do NOT push to GitHub without explicit user permission; commit locally only.
- Verification for every task: `npx tsc --noEmit` clean, and `npm test` stays green (currently 23 tests; will grow).
- Follow existing code style; keep diffs minimal. `bookingRef` format is `PR-YYYY-NNNN`.

---

### Task 1: `deriveBookingPhase` engine helper + tests

**Files:**
- Modify: `lib/booking-engine.ts` (add after `isBookingElapsed`, ends line 104)
- Test: `tests/booking-engine.test.mjs`

**Interfaces:**
- Consumes: `isStartInPast(date, startTime, now)`, `isBookingElapsed(date, endTime, now)`, `InstitutionNow`, `getInstitutionNow` (all already in `lib/booking-engine.ts`).
- Produces: `export type BookingPhase = "upcoming" | "in_progress" | "completed" | "cancelled"` and `export function deriveBookingPhase(date: string, startTime: string, endTime: string, status: "confirmed" | "cancelled" | "completed", now?: InstitutionNow): BookingPhase`.

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `tests/booking-engine.test.mjs` (after the final closing `});` on line 245), and add `deriveBookingPhase` to the existing import list at the top of the file (lines 3-13):

```js
describe("Booking phase derivation", () => {
  const NOW = { date: "2026-10-01", minutes: 10 * 60 };

  it("classifies a future booking window as upcoming", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "confirmed", NOW),
      "upcoming"
    );
    assert.equal(
      deriveBookingPhase("2026-10-02", "09:00", "09:30", "confirmed", NOW),
      "upcoming"
    );
  });

  it("classifies a window whose start has passed but end has not as in_progress", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "09:30", "10:30", "confirmed", NOW),
      "in_progress"
    );
  });

  it("classifies a fully elapsed window as completed", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "09:00", "09:30", "confirmed", NOW),
      "completed"
    );
    assert.equal(
      deriveBookingPhase("2026-09-30", "09:00", "09:30", "confirmed", NOW),
      "completed"
    );
  });

  it("passes through stored terminal statuses", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "cancelled", NOW),
      "cancelled"
    );
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "completed", NOW),
      "completed"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `deriveBookingPhase` is not exported / is not a function.

- [ ] **Step 3: Write the minimal implementation**

In `lib/booking-engine.ts`, insert immediately after the `isBookingElapsed` function (after line 104):

```ts
export type BookingPhase =
  | "upcoming"
  | "in_progress"
  | "completed"
  | "cancelled";

/**
 * Derives the presentational phase of a booking from its stored status and the
 * institution clock. Stored terminal statuses win over the clock.
 */
export function deriveBookingPhase(
  date: string,
  startTime: string,
  endTime: string,
  status: "confirmed" | "cancelled" | "completed",
  now: InstitutionNow = getInstitutionNow()
): BookingPhase {
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  if (isBookingElapsed(date, endTime, now)) return "completed";
  if (isStartInPast(date, startTime, now)) return "in_progress";
  return "upcoming";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — existing 23 tests plus the 4 new tests (27 total).

- [ ] **Step 5: Commit**

```bash
git add lib/booking-engine.ts tests/booking-engine.test.mjs
git commit -m "feat(engine): derive booking phase from status and institution clock"
```

---

### Task 2: Public booking status endpoint

**Files:**
- Create: `app/api/bookings/status/route.ts`

**Interfaces:**
- Consumes: `deriveBookingPhase` from Task 1; `getDb` from `@/db`; `bookings`, `rooms` from `@/db/schema`.
- Produces: `GET /api/bookings/status?ref=PR-YYYY-NNNN` returning `{ booking: { bookingRef, roomName, date, startTime, endTime, status, guestStudentName }, phase }`; 400 for a malformed ref; 404 for an unknown ref.

- [ ] **Step 1: Create the route**

Create `app/api/bookings/status/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, rooms } from "@/db/schema";
import { deriveBookingPhase } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ref = (searchParams.get("ref") ?? "").trim();

    if (!/^PR-\d{4}-\d{4}$/.test(ref)) {
      return Response.json(
        { error: "Invalid booking reference." },
        { status: 400 }
      );
    }

    const db = getDb();
    const [booking] = await db
      .select({
        bookingRef: bookings.bookingRef,
        guestStudentName: bookings.guestStudentName,
        date: bookings.date,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
        roomName: rooms.name,
      })
      .from(bookings)
      .leftJoin(rooms, eq(bookings.roomId, rooms.id))
      .where(eq(bookings.bookingRef, ref))
      .limit(1);

    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    const phase = deriveBookingPhase(
      booking.date,
      booking.startTime,
      booking.endTime,
      booking.status
    );

    return Response.json({
      booking: {
        bookingRef: booking.bookingRef,
        roomName: booking.roomName,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        guestStudentName: booking.guestStudentName,
      },
      phase,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 3: Verify live against the seeded local database**

The dev server runs at `http://127.0.0.1:5173`. Create a booking to obtain a real reference, then query it:

```bash
# Create a booking and capture its reference
REF=$(curl -s -X POST http://127.0.0.1:5173/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"roomId":3,"date":"2026-10-20","startTime":"14:00","endTime":"14:30","guestName":"Status Check"}' \
  | sed -n 's/.*"bookingRef":"\([^"]*\)".*/\1/p')
echo "ref=$REF"

# Happy path: expect phase + booking JSON
curl -s "http://127.0.0.1:5173/api/bookings/status?ref=$REF"

# Malformed ref: expect 400
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5173/api/bookings/status?ref=nope"

# Unknown but well-formed ref: expect 404
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5173/api/bookings/status?ref=PR-2026-0001"
```

Expected: `ref=PR-2026-...`; happy path returns `{"booking":{...},"phase":"upcoming"}`; then `400`; then `404`.

- [ ] **Step 4: Commit**

```bash
git add app/api/bookings/status/route.ts
git commit -m "feat(api): public booking status endpoint for live reservation card"
```

---

### Task 3: `fetchBookingStatus` API client

**Files:**
- Modify: `lib/api-client.ts` (append after `fetchSchedule`, ends line 116)

**Interfaces:**
- Consumes: `BookingPhase` type from `@/lib/booking-engine` (Task 1).
- Produces: `export interface BookingStatus { bookingRef: string; roomName?: string | null; date: string; startTime: string; endTime: string; status: string; guestStudentName?: string | null; phase: BookingPhase }` and `export async function fetchBookingStatus(ref: string): Promise<BookingStatus | null>`.

- [ ] **Step 1: Add the type import**

Add this line at the very top of `lib/api-client.ts` (line 1, before the existing doc comment block):

```ts
import type { BookingPhase } from "@/lib/booking-engine";
```

- [ ] **Step 2: Add the types and function**

Append after `fetchSchedule` (after line 116):

```ts
export interface BookingStatus {
  bookingRef: string;
  roomName?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  guestStudentName?: string | null;
  phase: BookingPhase;
}

export async function fetchBookingStatus(
  ref: string
): Promise<BookingStatus | null> {
  try {
    const res = await fetch(
      `/api/bookings/status?ref=${encodeURIComponent(ref)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      booking?: Omit<BookingStatus, "phase">;
      phase?: BookingPhase;
    };
    if (!data.booking || !data.phase) return null;
    return { ...data.booking, phase: data.phase };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 4: Commit**

```bash
git add lib/api-client.ts
git commit -m "feat(api-client): fetchBookingStatus for live reservation sync"
```

---

### Task 4: Live reservation card on Home

**Files:**
- Modify: `app/page.tsx`
  - imports (around lines 27-36)
  - module-scope helpers (around line 1853, near `dateKey`)
  - `confirm()` success branch (around lines 2955-2964)
  - Home component state (around line 2612)
  - `<HomeScreen>` usage (around line 3249)
  - `HomeScreen` signature + card stack (around lines 4799-5025)

**Interfaces:**
- Consumes: `fetchBookingStatus`, `BookingStatus` from `@/lib/api-client` (Task 3); `BookingPhase` from `@/lib/booking-engine` (Task 1).
- Produces: `interface ActiveReservation { bookingRef: string; roomId: number; roomName?: string; date: string; startTime: string; endTime: string; status: string; bookedFor?: string }`; components `useActiveReservation` and `ActiveReservationCard`.

- [ ] **Step 1: Extend the imports**

In `app/page.tsx`, change the api-client import block (lines 27-32) to also import the status function, and add a type-only import of `BookingPhase` on the existing booking-engine import line (line 33):

```ts
import {
  fetchAvailability,
  fetchBookingStatus,
  fetchSchedule,
  submitBooking,
  type ScheduleResponse,
} from "@/lib/api-client";
import { minutesToTime, timeToMinutes, type BookingPhase } from "@/lib/booking-engine";
```

- [ ] **Step 2: Add the storage key, interface, and pure helpers**

Immediately after the `dateKey` helper (after line 1853), add:

```ts
const ACTIVE_RESERVATION_STORAGE_KEY = "practice-ready-active-reservation";

interface ActiveReservation {
  bookingRef: string;
  roomId: number;
  roomName?: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  bookedFor?: string;
}

// Builds a local-time epoch from a calendar date and "HH:MM" time, so the
// countdown respects the viewer's calendar (matches dateKey/date-picker).
const localDateTimeMs = (date: string, time: string, dayOffset = 0) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day + dayOffset, hours, minutes, 0, 0).getTime();
};

const humanizeDuration = (ms: number) => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

const reservationCountdownLabel = (
  reservation: Pick<ActiveReservation, "date" | "startTime" | "endTime">,
  nowMs: number,
) => {
  const startMs = localDateTimeMs(reservation.date, reservation.startTime);
  const endMs = localDateTimeMs(
    reservation.date,
    reservation.endTime,
    reservation.endTime === "00:00" ? 1 : 0,
  );
  if (nowMs < startMs) return `Starts in ${humanizeDuration(startMs - nowMs)}`;
  if (nowMs < endMs) return `In progress, ${humanizeDuration(endMs - nowMs)} left`;
  return "Completed";
};
```

- [ ] **Step 3: Persist the reservation on successful booking**

In `confirm()` (lines 2955-2964), replace the `.then((res) => { ... })` body so it stores the booking. Replace lines 2962-2963:

```ts
          setStudentName(res.booking?.guestStudentName || studentName.trim() || "Student Practice User");
          setScreen("success");
```

with:

```ts
          const booking = res.booking;
          if (booking) {
            const reservation: ActiveReservation = {
              bookingRef: booking.bookingRef,
              roomId: booking.roomId,
              roomName: booking.roomName,
              date: booking.date,
              startTime: booking.startTime,
              endTime: booking.endTime,
              status: booking.status,
              bookedFor: booking.guestStudentName ?? (studentName.trim() || undefined),
            };
            setActiveReservation(reservation);
            try {
              window.localStorage.setItem(
                ACTIVE_RESERVATION_STORAGE_KEY,
                JSON.stringify(reservation),
              );
            } catch {
              // Storage can be unavailable (private mode); the card still shows
              // for this session via state.
            }
          }
          setStudentName(booking?.guestStudentName || studentName.trim() || "Student Practice User");
          setScreen("success");
```

- [ ] **Step 4: Add Home state, hydration, and terminal cleanup**

In the Home component, add the reservation state next to the other `useState` calls (after line 2616, the `liveSlots` state):

```ts
  const [activeReservation, setActiveReservation] = useState<ActiveReservation | null>(null);
```

Then add the hydration and cleanup effects after the greeting effect (search for the existing `useEffect` that sets the greeting; add immediately after its closing `}, []);`):

```ts
  // Hydrate the remembered reservation after mount so SSR and the first client
  // render match (both start with no card).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ACTIVE_RESERVATION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActiveReservation;
      if (parsed && typeof parsed.bookingRef === "string") {
        setActiveReservation(parsed);
      }
    } catch {
      // Ignore unreadable/corrupt storage.
    }
  }, []);

  const { phase: reservationPhase, nowMs: reservationNowMs } =
    useActiveReservation(activeReservation);

  // Once the reservation is finished or cancelled, drop it and forget it.
  useEffect(() => {
    if (!activeReservation) return;
    if (reservationPhase === "completed" || reservationPhase === "cancelled") {
      setActiveReservation(null);
      try {
        window.localStorage.removeItem(ACTIVE_RESERVATION_STORAGE_KEY);
      } catch {
        // Ignore storage errors.
      }
    }
  }, [reservationPhase, activeReservation]);
```

- [ ] **Step 5: Define the hook and card component**

Immediately before `function HomeScreen({` (line 4799), add:

```tsx
function useActiveReservation(reservation: ActiveReservation | null) {
  const [phase, setPhase] = useState<BookingPhase>("upcoming");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const bookingRef = reservation?.bookingRef ?? null;

  useEffect(() => {
    if (!bookingRef) return;
    let cancelled = false;

    const sync = async () => {
      const status = await fetchBookingStatus(bookingRef);
      if (cancelled || !status) return;
      setPhase(status.phase);
    };

    sync();
    const pollId = window.setInterval(sync, 30_000);
    const tickId = window.setInterval(() => setNowMs(Date.now()), 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, [bookingRef]);

  return { phase, nowMs };
}

function ActiveReservationCard({
  reservation,
  phase,
  nowMs,
}: {
  reservation: ActiveReservation;
  phase: BookingPhase;
  nowMs: number;
}) {
  const inProgress = phase === "in_progress";
  const statusLabel = inProgress ? "In progress" : "Confirmed";
  const statusClass = inProgress
    ? "bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/40"
    : "bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/40";

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-[#1B2133] px-4 py-3.5 text-white shadow-[0_10px_28px_rgba(15,23,42,0.28)] sm:px-5 sm:py-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
          <ShieldCheck size={18} />
        </span>
        <strong className="min-w-0 flex-1 truncate text-base font-semibold">
          Your Active Reservation
        </strong>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-slate-300">
          <MapPin size={15} className="shrink-0 text-slate-400" />
          <span className="truncate">
            {reservation.roomName ?? "MPR"} · {reservation.date} (
            {reservation.startTime}–{reservation.endTime})
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-slate-400">
          {reservation.bookingRef}
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-violet-300">
        {reservationCountdownLabel(reservation, nowMs)}
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Pass the reservation into HomeScreen**

In the `<HomeScreen ... />` usage, add these props:

```tsx
        activeReservation={activeReservation}
        reservationPhase={reservationPhase}
        reservationNowMs={reservationNowMs}
```

- [ ] **Step 7: Accept props and render the card**

In `HomeScreen` (line 4799), extend the parameter destructuring and its type. Change:

```tsx
function HomeScreen({
  onBook,
  onEquipment,
  onSchedule,
  greeting,
}: {
  onBook: () => void;
  onEquipment: () => void;
  onSchedule: () => void;
  greeting: string;
}) {
```

to:

```tsx
function HomeScreen({
  onBook,
  onEquipment,
  onSchedule,
  greeting,
  activeReservation,
  reservationPhase,
  reservationNowMs,
}: {
  onBook: () => void;
  onEquipment: () => void;
  onSchedule: () => void;
  greeting: string;
  activeReservation: ActiveReservation | null;
  reservationPhase: BookingPhase;
  reservationNowMs: number;
}) {
```

Then render the card as the first item of the card stack. Change the opening of the stack (lines 4998-4999):

```tsx
            <div className="mt-5 space-y-3 sm:mt-8 sm:space-y-4">
              <HomeCard
```

to:

```tsx
            <div className="mt-5 space-y-3 sm:mt-8 sm:space-y-4">
              {activeReservation && (
                <ActiveReservationCard
                  reservation={activeReservation}
                  phase={reservationPhase}
                  nowMs={reservationNowMs}
                />
              )}
              <HomeCard
```

- [ ] **Step 8: Typecheck, lint, and test**

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npm run lint`
Expected: no new errors.

Run: `npm test`
Expected: PASS — 27 tests.

- [ ] **Step 9: Verify in the live preview**

With the dev server running at `http://127.0.0.1:5173`, book a room end-to-end in the UI (Book a Room → pick a date/room/time → Confirm). On the success screen, tap "Return Home". Expected: the "Your Active Reservation" card appears at the top of Home with the correct MPR, date, time, reference, a green "Confirmed" pill, and "Starts in …". Reload the page: the card persists. Optionally seed a booking with an end time in the past and confirm the card hides after the 30s poll.

- [ ] **Step 10: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): live active reservation card on home"
```

---

## Self-Review

**Spec coverage:**
- Home card matching image 1 → Task 4 (card component + HomeScreen wiring).
- LocalStorage "remember last booking" → Task 4 Step 3/4.
- Ticking relative label → Task 4 Steps 2/5 (`reservationCountdownLabel`, 30s tick).
- Server status sync (public endpoint, 30s poll) → Tasks 1-3, Task 4 Step 5.
- Hide on completed/cancelled → Task 4 Step 4.
- No auth, no schema changes → Global Constraints; endpoint is public.
- Unit tests for phase derivation → Task 1.
- tsc/test/live-curl verification → each task.

**Placeholder scan:** none.

**Type consistency:** `BookingPhase` (engine → api-client type-only import → page.tsx), `BookingStatus`/`fetchBookingStatus` (Task 3 → Task 4), `ActiveReservation` (Task 4 only), props `activeReservation`/`reservationPhase`/`reservationNowMs` consistent across Step 6 and Step 7.
