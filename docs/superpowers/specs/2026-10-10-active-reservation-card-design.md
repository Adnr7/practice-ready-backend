# Design: Live "Your Active Reservation" card on Home

Date: 2026-10-10
Status: Approved

## Problem

After a student confirms a booking, the confirmation only exists on the success
screen. Returning Home loses it, and there is no at-a-glance reminder of the
upcoming reservation. The reference app (image 1) shows a persistent
"Your Active Reservation" card at the top of Home with room, date/time,
reference, and a status pill.

## Goal

Home shows a single, live-updating "Your Active Reservation" card for the most
recent booking made on this device:

- Room, date, time range, reference ID, and status pill.
- A ticking relative label ("Starts in 2h 15m" -> "In progress, 25m left").
- Status kept in sync with the server (confirmed / in progress / completed /
  cancelled) via periodic polling.
- The card disappears once the reservation is completed or cancelled.

Display-only (no tap/popup). No authentication: bookings continue to be made as
guests. If auth is added later, the data source can switch to the session
booking without changing the card.

## Approach

A device-remembered reservation + a public status endpoint. No schema changes.

### Backend

New route `GET /api/bookings/status?ref=PR-YYYY-NNNN` (public, no session):

- Validate `ref` against `/^PR-\d{4}-\d{4}$/`; return 400 otherwise.
- Look up the booking by its unique `bookingRef`, joined to `rooms.name`;
  return 404 when not found.
- Return the current phase, derived server-side on the institution clock:

```json
{ "booking": { "bookingRef": "PR-2026-8812", "roomName": "MPR 3",
    "date": "2026-09-29", "startTime": "07:30", "endTime": "08:00",
    "status": "confirmed", "guestStudentName": "Student Practice User" },
  "phase": "upcoming" }
```

- `phase` is `upcoming | in_progress | completed | cancelled`:
  - `cancelled` / `completed` pass through the stored status.
  - Otherwise `in_progress` when the start has passed but the end has not,
    else `upcoming` (using `isStartInPast` / `isBookingElapsed`).
- Pure read: polling never writes (unlike the list endpoint's reconciliation).

Phase derivation is extracted to an exported `deriveBookingPhase(date,
startTime, endTime, status, now?)` in `lib/booking-engine.ts` so it is
unit-testable and shared by the route.

### Client

- `lib/api-client.ts`: `BookingPhase`, `BookingStatus` types and
  `fetchBookingStatus(ref)` with the usual null-on-failure fallback.
- On successful booking in `confirm()`, persist the returned booking to
  `localStorage` under `practice-ready-active-reservation` (and set state).
  Only the most recent booking is kept (overwrite). The demo-conflict path
  creates no reservation and stores nothing.
- New `useActiveReservation()` hook in `app/page.tsx`: SSR-safe hydrate from
  storage in an effect, poll `fetchBookingStatus` every 30s, tick a local clock
  every 30s, and clear storage/hide when `phase` is `completed`/`cancelled`.
- `HomeScreen` receives the reservation and renders `ActiveReservationCard` as
  the first item of the card stack (above "Book a Room"), matching image 1.

### Card visual

Dark rounded card: green check circle + "Your Active Reservation" title; a
status pill (green "Confirmed", violet "In progress"); second row with a map-pin
and `MPR 3 · 2026-09-29 (07:30–08:00)` plus a mono `PR-2026-8812`; a live line
"Starts in 2h 15m" / "In progress, 25m left". Hidden when the reservation is
completed or cancelled.

## Edge cases

- No reservation, unreadable/corrupt storage, or `localStorage` unavailable:
  no card (Home unchanged).
- Poll failure: keep the last known state and keep ticking locally; hide only
  when a successful poll reports completed/cancelled.
- SSR/hydration: start with no card, hydrate from storage in an effect.
- Countdown uses the viewer's clock; the authoritative `phase` comes from the
  server, so a timezone-skewed viewer still sees the correct status.

## Testing

No route/component test harness exists (established in prior specs):
unit-test `deriveBookingPhase` via `npm test`, `npx tsc --noEmit` clean, and a
live curl of the new endpoint against the seeded local database (including a
404 for an unknown reference).

## Out of scope

Cancel/reschedule from the card, authentication, a multi-reservation list,
cross-device sync, and notifications.
