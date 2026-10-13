# Design: Room schedule board ("Who's in the rooms")

Date: 2026-10-10
Status: Approved

## Problem

Booked student names are visible on the slots screen, but only after walking the
full booking flow (date -> MPR -> period -> slots). There is no direct view that
shows, at a glance, which users are booked in which rooms.

## Goal

A "Room Schedule" board: pick a date, see every MPR's booked time ranges with
the booking student's name. Reached from a new home-screen card.

## Approach

Read-time aggregation, consistent with the names feature (no schema changes).

### Backend

New route `GET /api/schedule?date=YYYY-MM-DD` (defaults to today on the
institution clock). Returns the operational day view for the chosen date: the
date's bookings with `startTime >= "06:00"` plus the next calendar date's
late-night tail (`startTime < "06:00"`), merged server-side. One query joins
`bookings → users`; only `status = "confirmed"` bookings; every active room is
listed even when it has no bookings.

```json
{ "date": "2026-10-11",
  "rooms": [{ "id": 1, "name": "MPR 2",
    "bookings": [{ "bookingRef": "PR-2026-1234", "startTime": "09:00",
                   "endTime": "09:30", "bookedBy": "Ada Okafor" }] }] }
```

`bookedBy` = `users.fullName ?? guestStudentName ?? "Student"` (display name
only — no emails or student IDs, same privacy policy as the slots screen).

### Frontend

- Home screen gains a third card "Room Schedule" (after Book a Room and
  Equipment, before the conflict-demo card): "See who is booked in each MPR."
- New `schedule` screen: a 7-day rolling date strip (today first, same window
  as booking) plus one card per active MPR listing booked ranges
  `09:00–09:30 · Ada Okafor`, or "No bookings yet." One fetch per date change;
  loading and failure states; back to home.
- `lib/api-client.ts` gains `ScheduleBooking`/`ScheduleRoom`/`ScheduleResponse`
  types and `fetchSchedule(date)` with the usual null-on-failure fallback.

## Testing

No route/component test harness exists (established in the prior spec):
`npx tsc --noEmit` clean, existing 23 tests green, plus a live curl of the
endpoint against the seeded local database.
