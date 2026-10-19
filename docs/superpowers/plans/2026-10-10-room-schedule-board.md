# Room Schedule Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Room Schedule" board — pick a date, see every MPR's booked time ranges with the booking student's name — reached from a new home-screen card.

**Architecture:** New aggregate endpoint `GET /api/schedule?date=...` resolves the operational day (date D daytime + date D+1 late-night tail, merged server-side) via one join of `bookings → users`. The frontend adds a home card, a `schedule` screen with a 7-day date strip and per-room booking cards, and a typed `fetchSchedule` client.

**Tech Stack:** Next.js (vinext) App Router, Drizzle ORM on Cloudflare D1, React 19, Tailwind 4.

## Global Constraints

- `bookedBy` = `users.fullName ?? guestStudentName ?? "Student"`; never emails or student IDs.
- Operational-day merge: date D with `startTime >= "06:00"` plus date D+1 with `startTime < "06:00"`; only `status = "confirmed"`; every active room appears even with zero bookings.
- No new dependencies, no schema/migration changes. New files: `app/api/schedule/route.ts` only; modify `app/page.tsx` and `lib/api-client.ts`.
- No route/component test harness exists; verification is `npx tsc --noEmit` clean, existing `npm test` (23 tests) green, plus a controller-run live curl.
- Match surrounding code style exactly; minimal diff; no drive-by refactoring. Do NOT push — the controller commits/pushes.

---

### Task 1: Schedule API + home card + schedule screen

**Files:**
- Create: `app/api/schedule/route.ts`
- Modify: `lib/api-client.ts`, `app/page.tsx`

**Interfaces:**
- Produces: `fetchSchedule(date: string): Promise<ScheduleResponse | null>` and types `ScheduleBooking { bookingRef: string; startTime: string; endTime: string; bookedBy: string }`, `ScheduleRoom { id: number; name: string; bookings: ScheduleBooking[] }`, `ScheduleResponse { date: string; rooms: ScheduleRoom[] }`.

- [ ] **Step 1: Create `app/api/schedule/route.ts`**

```ts
import { and, asc, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, rooms, users } from "@/db/schema";
import { getInstitutionNow } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const date = dateParam ?? getInstitutionNow().date;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { error: "date must be in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    // The operational day runs 06:00-06:00: daytime bookings live on this
    // calendar date, the late-night tail (00:00-06:00) on the next one.
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().split("T")[0];

    const db = getDb();

    const activeRooms = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(asc(rooms.id));

    const rows = await db
      .select({
        roomId: bookings.roomId,
        bookingRef: bookings.bookingRef,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        guestName: bookings.guestStudentName,
        userName: users.fullName,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.userId, users.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          or(
            and(eq(bookings.date, date), gte(bookings.startTime, "06:00")),
            and(eq(bookings.date, nextDateStr), lt(bookings.startTime, "06:00"))
          )
        )
      )
      .orderBy(asc(bookings.startTime));

    const byRoom = new Map<
      number,
      { bookingRef: string; startTime: string; endTime: string; bookedBy: string }[]
    >();
    for (const row of rows) {
      const list = byRoom.get(row.roomId) ?? [];
      list.push({
        bookingRef: row.bookingRef,
        startTime: row.startTime,
        endTime: row.endTime,
        bookedBy: row.userName ?? row.guestName ?? "Student",
      });
      byRoom.set(row.roomId, list);
    }

    return Response.json({
      date,
      rooms: activeRooms.map((room) => ({
        id: room.id,
        name: room.name,
        bookings: byRoom.get(room.id) ?? [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: `lib/api-client.ts` — types and client**

After `fetchAvailability` add:

```ts
export interface ScheduleBooking {
  bookingRef: string;
  startTime: string;
  endTime: string;
  bookedBy: string;
}

export interface ScheduleRoom {
  id: number;
  name: string;
  bookings: ScheduleBooking[];
}

export interface ScheduleResponse {
  date: string;
  rooms: ScheduleRoom[];
}

export async function fetchSchedule(
  date: string
): Promise<ScheduleResponse | null> {
  try {
    const res = await fetch(`/api/schedule?date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ScheduleResponse;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: `app/page.tsx` — imports and Screen type**

- Add `Users` to the lucide-react import list (alphabetical: between `TriangleAlert` and `Volume2`).
- Extend the api-client import (line 27) to: `import { fetchSchedule, fetchAvailability, submitBooking } from "@/lib/api-client";` keeping alphabetical order: `fetchAvailability, fetchSchedule, submitBooking`.
- Add `| "schedule"` to the `Screen` union (after `"directory-browse"`).

- [ ] **Step 4: `app/page.tsx` — ScheduleScreen component**

Insert after the `HomeCard` component:

```tsx
function ScheduleScreen({ back }: { back: () => void }) {
  const [scheduleDate, setScheduleDate] = useState(() => new Date());
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSchedule(null);
    setLoadFailed(false);
    fetchSchedule(dateKey(scheduleDate)).then((data) => {
      if (cancelled) return;
      if (data) setSchedule(data);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [scheduleDate]);

  const days = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    return day;
  });

  return (
    <Shell
      title="Room Schedule"
      subtitle="See who is booked in each MPR."
      back={back}
    >
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((day) => {
          const selected = sameDay(day, scheduleDate);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setScheduleDate(day)}
              aria-pressed={selected}
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition ${
                selected
                  ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                  : "border-violet-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] text-slate-600 dark:text-[#AAB3C7] hover:border-violet-400 dark:hover:border-violet-500"
              }`}
            >
              {sameDay(day, new Date()) ? "Today" : shortDate(day)}
            </button>
          );
        })}
      </div>

      {loadFailed ? (
        <div className="mt-4 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-[#321820] p-4 text-sm text-rose-900 dark:text-rose-200">
          Could not load the schedule. Please try again later.
        </div>
      ) : schedule === null ? (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-[#9AA6BC]">
          Loading schedule…
        </p>
      ) : (
        <div className="mt-3 space-y-3 sm:space-y-4">
          {schedule.rooms.map((room) => (
            <div
              key={room.id}
              className="rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{room.name}</h2>
                <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-[#9AA6BC]">
                  {room.bookings.length === 0
                    ? "Free all day"
                    : `${room.bookings.length} booking${room.bookings.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {room.bookings.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-[#9AA6BC]">
                  No bookings yet.
                </p>
              ) : (
                <ul className="mt-2.5 space-y-2">
                  {room.bookings.map((booking) => (
                    <li
                      key={`${room.id}-${booking.bookingRef}-${booking.startTime}`}
                      className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-[#252C3E] pt-2 text-sm"
                    >
                      <span className="shrink-0 font-semibold">
                        {booking.startTime}–{booking.endTime}
                      </span>
                      <span className="min-w-0 truncate text-right text-slate-600 dark:text-[#AAB3C7]">
                        {booking.bookedBy}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
```

Add `ScheduleResponse` to the api-client type import in `app/page.tsx` (line 27 area): `import { fetchSchedule, submitBooking, type ScheduleResponse } from "@/lib/api-client";` — merge with the existing `fetchAvailability` import into one statement:

```ts
import {
  fetchAvailability,
  fetchSchedule,
  submitBooking,
  type ScheduleResponse,
} from "@/lib/api-client";
```

- [ ] **Step 5: `app/page.tsx` — wire the home card and route**

- HomeScreen props (line ~4787): add `onSchedule: () => void;` to the type and destructure.
- Insert a new card after the Equipment card:

```tsx
              <HomeCard
                icon={<Users />}
                title="Room Schedule"
                text="See who is booked in each MPR today."
                onClick={onSchedule}
              />
```

- HomeScreen call site (line ~3242): add `onSchedule={() => go("schedule")}`.
- Add the screen block immediately after the `screen === "home"` block (line ~3264):

```tsx
  if (screen === "schedule")
    return (
      <ScheduleScreen back={back} />
    );
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, 23 tests pass.

- [ ] **Step 7: Commit (local only)**

```bash
git add app/api/schedule/route.ts app/page.tsx lib/api-client.ts
git commit -m "feat: room schedule board showing booked users per MPR"
```
