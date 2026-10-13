# Design: Student names on time slots ("Who's in the room")

Date: 2026-10-10
Status: Approved

## Problem

The time slots screen shows slots as "booked" without saying who booked them, so
nobody can see who is in which room. Bookers also never identify themselves: the
UI hardcodes `guestName: "Student Practice User"` when submitting a reservation.

## Goal

1. Anybody viewing a room's time slots can see who is booked in each slot.
2. The booker enters their name on the "Review reservation" screen; the name is
   stored with the booking and shown back on the slots screen and success screen.

## Approach

Names are resolved at read time. `GET /api/availability` joins
`booking_slots → bookings (→ users)` and returns `bookedBy` (display name) on
every slot. Alternatives considered: a denormalized `bookedBy` column on
`time_slots` (needs a D1 migration, can desync on cancellation — rejected) and
resolving client-side via `/api/bookings` (auth-scoped to the caller's own
bookings — wrong tool, rejected).

## Contract

- `SlotData.bookedBy?: string | null` — display name of the confirmed booking
  holding the slot; `null` for available/maintenance slots. For logged-in users
  this is `users.fullName`, otherwise `bookings.guestStudentName`.

## Changes

### Backend

`app/api/availability/route.ts`:
- After loading slot rows, if any are booked, run one extra query joining
  `bookingSlots → bookings → users` (bookings restricted to `status =
  "confirmed"`), and map `timeSlotId → bookedBy` using
  `users.fullName ?? guestStudentName ?? null`.
- Every slot in the response gains `bookedBy`.
- Past-date in-memory grids have no booking links, so `bookedBy` is `null` there.

### Frontend (`app/page.tsx`, `lib/api-client.ts`)

- `SlotData` gains `bookedBy?: string | null` (`lib/api-client.ts`).
- Slots screen fetches live availability for the selected room and merges two
  responses by slot start time: date D for 06:00–24:00 slots and date D+1 for
  the 00:00–06:00 late-night tail (matching the operational-day semantics).
  Booked tiles render a second line `Booked · <name>`.
- Demo fallback: if the API is unreachable, the existing demo booked sets apply
  and booked tiles show plain "Booked" (no name known). The same applies to
  `maintenance` rows and demo data.
- Review reservation screen: "Your name" text input above the summary; value is
  trimmed, defaults to "Student Practice User" when empty; summary gains a
  "Booked for" row; value is sent as `guestName` to `POST /api/bookings`
  (already persisted by the backend). State resets with the rest of the flow.
- Success screen: `ConfirmationDetails` shows the entered name.
- `POST /api/bookings` response includes `guestStudentName` so the success
  screen can echo the stored value.

## Error handling

- Availability fetch failure → demo fallback (existing behavior).
- Empty/whitespace name → default "Student Practice User".
- Booking conflict flow unchanged.

## Testing

- Existing unit tests (`npm test`, 23 tests) must stay green; no route-level
  test harness exists in the repo (only `lib/` is unit-tested), so routes are
  verified by typecheck plus a live dev-server check: book a slot with a name,
  then confirm `GET /api/availability` returns that name on the booked slot.
- `tsc --noEmit` clean; lint introduces no new issues.
