# Student Names on Time Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who booked each time slot ("Booked · <name>") on the slots screen and let the booker enter their name on the Review reservation screen.

**Architecture:** Names resolve at read time: `GET /api/availability` joins `booking_slots → bookings (→ users)` and returns `bookedBy` per slot. The frontend fetches live availability for the selected room (date D for 06:00–24:00, date D+1 for the 00:00–06:00 late-night tail), replaces the demo booked set when the fetch succeeds, and falls back to demo data on failure. Name entry happens on the "Review reservation" screen and flows through the existing `guestName` field of `POST /api/bookings`.

**Tech Stack:** Next.js (vinext) App Router, Drizzle ORM on Cloudflare D1, React 19, Tailwind 4.

## Global Constraints

- `SlotData.bookedBy?: string | null` — display name of the confirmed booking holding the slot (`users.fullName ?? guestStudentName`), `null` for available/maintenance/passed slots. Exact shape, agreed contract.
- Late-night semantics: slots with `startTime < "06:00"` belong to the NEXT calendar date's response. Daytime merge uses date D rows with `startTime >= "06:00"`; late-night merge uses date D+1 rows with `startTime < "06:00"`.
- Demo fallback: only when both availability fetches fail do the demo booked sets apply.
- No new dependencies. No schema/migration changes.
- Repo has no route-level or component test harness; verification is `npm test` (23 existing tests stay green), `npx tsc --noEmit` clean, and a live dev-server check performed by the controller.
- Existing code style: no comments except where they explain "why"; match surrounding formatting exactly.

---

### Task 1: Backend — `bookedBy` on availability, `guestStudentName` in booking response

**Files:**
- Modify: `app/api/availability/route.ts`
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- Consumes: existing tables `bookingSlots`, `bookings`, `users` from `@/db/schema`.
- Produces: every slot in the availability response gains `bookedBy: string | null`; `POST /api/bookings` response `booking` object gains `guestStudentName: string | null`. Task 2 relies on `SlotData.bookedBy`.

- [ ] **Step 1: Update `app/api/availability/route.ts` imports**

Change the drizzle import and schema import at the top (lines 1-9) to:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookingSlots, bookings, rooms, timeSlots, users } from "@/db/schema";
import {
  generateDailyTimeSlots,
  getInstitutionNow,
  isStartInPast,
  type TimePeriod,
} from "@/lib/booking-engine";
```

- [ ] **Step 2: Resolve booked names after slots load**

Immediately after the `if/else` block that assigns `slots` (i.e., right before the `// A slot whose start time has already passed...` comment), insert:

```ts
// Resolve the display name of the confirmed booking holding each booked slot
// so clients can show who is in the room.
const bookedSlotIds = slots
  .filter((slot) => slot.status === "booked")
  .map((slot) => slot.id);

const bookedByBySlotId = new Map<number, string>();
if (bookedSlotIds.length > 0) {
  const links = await db
    .select({
      timeSlotId: bookingSlots.timeSlotId,
      userName: users.fullName,
      guestName: bookings.guestStudentName,
      bookingStatus: bookings.status,
    })
    .from(bookingSlots)
    .innerJoin(bookings, eq(bookingSlots.bookingId, bookings.id))
    .leftJoin(users, eq(bookings.userId, users.id))
    .where(inArray(bookingSlots.timeSlotId, bookedSlotIds));

  for (const link of links) {
    if (link.bookingStatus !== "confirmed") continue;
    const name = link.userName ?? link.guestName;
    if (name) bookedByBySlotId.set(link.timeSlotId, name);
  }
}
```

- [ ] **Step 3: Include `bookedBy` in each response slot**

Replace the existing `responseSlots` mapping with:

```ts
const responseSlots = slots.map((slot) => {
  const passed =
    isPastDate || (isToday && isStartInPast(dateParam, slot.startTime, now));
  return {
    ...slot,
    status:
      passed && slot.status === "available" ? ("booked" as const) : slot.status,
    passed,
    bookedBy: slot.status === "booked" ? (bookedByBySlotId.get(slot.id) ?? null) : null,
  };
});
```

Note: passed slots whose underlying status is `"available"` intentionally get `bookedBy: null` — they were never booked, they merely elapsed.

- [ ] **Step 4: Include `guestStudentName` in the booking POST response**

In `app/api/bookings/route.ts`, inside the `Response.json({ booking: { ... } }, { status: 201 })` object, add one field after `durationMinutes`:

```ts
          guestStudentName: newBooking.guestStudentName,
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, 23 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/availability/route.ts app/api/bookings/route.ts
git commit -m "feat(api): return booked-by name on availability slots"
```

---

### Task 2: Frontend — names on slot tiles + name entry on Review screen

**Files:**
- Modify: `lib/api-client.ts` (SlotData interface)
- Modify: `app/page.tsx` (imports, state, live-fetch effect, booked-set merge, Slots props/tiles, review screen input, Summary, ConfirmationDetails, confirm/home handlers)

**Interfaces:**
- Consumes: `GET /api/availability` slots now carry `bookedBy?: string | null` (Task 1).
- Produces: `Slots` component receives new prop `bookedBy: Record<string, string>` (startTime → display name). `Summary` and `ConfirmationDetails` accept optional `bookedFor?: string`.

- [ ] **Step 1: `lib/api-client.ts` — extend SlotData**

In the `SlotData` interface, after `status`, add:

```ts
  bookedBy?: string | null;
```

- [ ] **Step 2: `app/page.tsx` — imports**

Change the api-client import (line 27) to:

```ts
import { fetchAvailability, submitBooking } from "@/lib/api-client";
```

Add `User` to the lucide-react icon import list (alphabetical order, between `Sun` and `Volume2`... actually between `TriangleAlert` and `Volume2`).

- [ ] **Step 3: `app/page.tsx` — state**

Immediately after the `const [selectedDate, setSelectedDate] = useState<Date | null>(null);` line (line ~2574) add:

```ts
  const [studentName, setStudentName] = useState("");
  const [liveBookedBy, setLiveBookedBy] = useState<Record<string, string> | null>(null);
```

- [ ] **Step 4: `app/page.tsx` — live availability effect**

Add this effect right after the state block's other effects (place it after the existing `useEffect` that plays music is fine; anywhere in the component body before the screen conditionals):

```ts
  useEffect(() => {
    if (!["slots2", "slots3", "slots4", "slots5"].includes(screen)) {
      setLiveBookedBy(null);
      return;
    }
    let cancelled = false;
    const roomId = room.includes("2") ? 2 : room.includes("3") ? 3 : room.includes("4") ? 4 : room.includes("5") ? 5 : 1;
    const base = selectedDate || new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const nextDay = new Date(base);
    nextDay.setDate(base.getDate() + 1);
    // Slots from midnight to 06:00 belong to the next calendar date (see
    // bookingDateForSlots), so booked names come from two calendar dates.
    Promise.all([fetchAvailability(roomId, fmt(base)), fetchAvailability(roomId, fmt(nextDay))])
      .then(([today, tomorrow]) => {
        if (cancelled) return;
        if (!today && !tomorrow) {
          setLiveBookedBy(null);
          return;
        }
        const map: Record<string, string> = {};
        for (const slot of today?.slots ?? []) {
          if (slot.startTime >= "06:00" && slot.status === "booked" && slot.bookedBy) {
            map[slot.startTime] = slot.bookedBy;
          }
        }
        for (const slot of tomorrow?.slots ?? []) {
          if (slot.startTime < "06:00" && slot.status === "booked" && slot.bookedBy) {
            map[slot.startTime] = slot.bookedBy;
          }
        }
        setLiveBookedBy(map);
      })
      .catch(() => {
        if (!cancelled) setLiveBookedBy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, room, selectedDate]);
```

- [ ] **Step 5: `app/page.tsx` — merge live bookings into the `booked` set**

Replace the block at lines ~3495-3506:

```ts
    const baseBooked =
      room === "MPR 2"
        ? booked2
        : room === "MPR 4"
          ? booked4
          : room === "MPR 5"
            ? booked5
            : booked3;
    const booked = new Set(baseBooked);
```

with:

```ts
    const baseBooked =
      liveBookedBy !== null
        ? Object.keys(liveBookedBy)
        : room === "MPR 2"
          ? booked2
          : room === "MPR 4"
            ? booked4
            : room === "MPR 5"
              ? booked5
              : booked3;
    const booked = new Set(baseBooked);
```

and extend the `<Slots ... />` invocation (lines ~3508-3525) with:

```tsx
        bookedBy={liveBookedBy ?? {}}
```

- [ ] **Step 6: `Slots` component — accept and render names**

Add to the `Slots` props type and destructure: `bookedBy: Record<string, string>;`

In the tile render (the `<button ...>` inside `periods[activePeriod].times.map`, line ~5758), replace the single left span:

```tsx
                <span className="font-semibold">{slotLabel(t)}</span>
```

with:

```tsx
                <span className="min-w-0">
                  <span className="block font-semibold">{slotLabel(t)}</span>
                  {isBooked && bookedBy[t] ? (
                    <span className="mt-0.5 block truncate text-xs font-normal text-slate-400 dark:text-[#8F9BB2]">
                      Booked · {bookedBy[t]}
                    </span>
                  ) : null}
                </span>
```

The right-hand pill stays "Booked".

- [ ] **Step 7: Name input on the Review screen**

In the `screen === "review"` block, directly after `<Summary room={room} time={time} date={bookingDate} />` (line ~4154), insert:

```tsx
        <div className="mt-3.5 sm:mt-5">
          <label htmlFor="student-name" className="mb-1.5 block text-sm font-semibold">
            Your name
          </label>
          <Input
            type="text"
            value={studentName}
            onChange={(event) => setStudentName(event.target.value)}
            placeholder="Student Practice User"
            maxLength={80}
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-[#9AA6BC]">
            Shown on the time slots so others can see who is in the room.
          </p>
        </div>
```

- [ ] **Step 8: `confirm()` — send the entered name**

In `confirm()`, change `guestName: "Student Practice User",` to:

```ts
      guestName: studentName.trim() || "Student Practice User",
```

- [ ] **Step 9: `Summary` — optional "Booked for" row**

Change `Summary` (line ~2294) to accept `bookedFor?: string` and render it as a strip below the 3-col grid (the border/rounded outer wrapper moves to a plain div):

```tsx
function Summary({
  room,
  time,
  date,
  bookedFor,
}: {
  room: string;
  time: string;
  date: Date;
  bookedFor?: string;
}) {
  const details = [
    { label: "Date", value: shortDate(date) },
    { label: "Time", value: time },
    { label: "Room", value: room },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-[#30384D] dark:bg-[#151A2B] dark:text-[#F5F7FF]">
      <div className="grid min-w-0 grid-cols-3">
        {details.map((detail, index) => (
          <div
            key={detail.label}
            className={`min-w-0 px-3 py-3.5 sm:px-5 sm:py-4 ${index > 0 ? "border-l border-slate-200 dark:border-[#30384D]" : ""}`}
          >
            <small className="block text-xs text-slate-500 dark:text-[#8F9BB2]">
              {detail.label}
            </small>
            <p className="mt-1 break-words text-[13px] font-semibold leading-5 sm:text-sm">
              {detail.value}
            </p>
          </div>
        ))}
      </div>
      {bookedFor ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-[#30384D] px-3 py-2.5 sm:px-5 sm:py-3">
          <small className="text-xs text-slate-500 dark:text-[#8F9BB2]">Booked for</small>
          <p className="min-w-0 truncate text-[13px] font-semibold sm:text-sm">{bookedFor}</p>
        </div>
      ) : null}
    </div>
  );
}
```

On the review screen call site only (line ~4154), pass it:

```tsx
        <Summary
          room={room}
          time={time}
          date={bookingDate}
          bookedFor={studentName.trim() || undefined}
        />
```

- [ ] **Step 10: Success screen echo**

Extend `ConfirmationDetails` with an optional `bookedFor?: string` prop; after the existing details grid (inside the outer `<div className="grid rounded-2xl ...">`'s parent section), append:

```tsx
      {bookedFor ? (
        <div className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] px-3.5 py-3 shadow-sm sm:gap-3 sm:p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 dark:bg-[#211A38] text-violet-700 dark:text-violet-300 sm:h-10 sm:w-10">
            <User size={18} />
          </span>
          <span className="min-w-0">
            <small className="block text-xs text-slate-500 dark:text-[#8F9BB2]">Booked for</small>
            <p className="mt-0.5 truncate text-[13px] font-semibold leading-5 sm:text-sm">{bookedFor}</p>
          </span>
        </div>
      ) : null}
```

At the success screen call site (line ~4245):

```tsx
        <ConfirmationDetails
          room={room}
          time={time}
          date={bookingDate}
          bookedFor={studentName.trim() || undefined}
        />
```

- [ ] **Step 11: Reset state**

In the `home()` reset function, after `setConflictSlot("");` add:

```ts
    setStudentName("");
```

Also ensure `setLiveBookedBy(null)` is safe there (it is cleared by the effect when leaving slots screens; no explicit reset needed).

- [ ] **Step 12: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, 23 tests pass.

- [ ] **Step 13: Commit**

```bash
git add app/page.tsx lib/api-client.ts
git commit -m "feat(ui): show booked student names on time slots and collect booker name"
```
