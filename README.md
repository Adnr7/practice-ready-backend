# Practice Ready

**Practice Ready** is an HCI/UI-UX prototype for improving Music Practice Room (MPR) booking and equipment readiness at the True School of Music.

The project addresses a practical problem faced by students: before arriving for practice, they may not have a reliable way to know whether an MPR is available, what equipment is assigned to it, where that equipment is currently located, or whether it is in working condition.

Practice Ready brings this information together so students can make a more informed room-booking decision before beginning a practice session.

## Live Links

- **Current Interactive Prototype:** https://practice-ready.asmi-battoo.workers.dev
- **HCI/UI-UX Case Study:** https://asmib170.github.io/practice-ready/

## Must-Have Features

The prototype is built around four prioritized Must-Have features:

1. **View MPR availability and daily time slots**
2. **Reserve an MPR time slot**
3. **View MPR setups and TSM equipment locations**, including default and current locations
4. **View equipment working condition**

## Design Process

The project was developed through an iterative HCI/UI-UX process involving:

- User interviews
- Information architecture
- Open hierarchical card sorting
- Tree testing and IA refinement
- Feature prioritization
- Skeletal wireframing
- Nielsen heuristic inspection
- Interactive prototyping
- Informal usability testing and iterative refinement

The interface was refined around principles including visibility of system status, error prevention, consistency and standards, recognition rather than recall, clear affordances, and user control and freedom.

## Prototype

The current responsive prototype supports the complete room-booking journey across desktop and mobile.

Users can:

- Select a date, MPR, time period and consecutive 30-minute time slots, with a maximum booking duration of three hours.
- Switch between time periods while viewing detailed room availability.
- Change the selected MPR from the time-period or time-slot flow without losing the current selection when the same MPR is retained.
- Preserve selected time periods and selected time-slot ranges when reviewing the same MPR, while clearing room-specific slot selections when a genuinely different MPR is chosen.
- Review an MPR's equipment readiness before continuing with a reservation.
- View currently available equipment assigned to an MPR and search that list by equipment name or ID.
- Search the Equipment Directory by equipment name, type, ID or common descriptive terms.
- Browse equipment by TSM location.
- Compare Available and Unavailable equipment states.
- View default location, current location and working condition where relevant.
- Search for alternatives when assigned equipment is unavailable.
- Recover from equipment-availability issues without implying that equipment can be borrowed or relocated.
- Experience a simulated simultaneous-booking conflict through the dedicated **Booking Conflict Demo** and recover by adjusting the selected time or choosing another MPR.

Equipment search supports meaningful partial terms, word prefixes, common aliases and equipment-specific combinations across the Equipment Directory, MPR equipment lists, location browsing and contextual alternative searches. Results prioritize the actual requested equipment type before related accessories or label matches, preserve the established location order, avoid unintended substring matches and automatically open the Unavailable tab when no available matches exist but unavailable matches do.

For broad equipment queries, results are also contextually ranked. For example, a search for **guitar** prioritizes acoustic, electric and bass guitars before related amplifiers, instrument cables, individual stands and floor racks.

The prototype also includes an expanded illustrative equipment inventory across practice rooms and performance spaces, including wired and wireless microphones, PA speakers, guitar stands and racks, amplifiers, cables and other rehearsal equipment.

## Audio Experience

Practice Ready includes a subtle music-focused audio layer designed to support the atmosphere of the prototype without interfering with task completion.

- Smooth-jazz background music plays on the Home screen at the main listening level.
- The same track continues at a lower volume on internal task-focused screens.
- On desktop/laptop, the Home music level is approximately **23%** and internal pages are approximately **15%**.
- On mobile, the Home music level is approximately **23%** and internal pages are approximately **13%**.
- Successful-booking and conflict/error final screens remain at the same lower internal-page music level rather than increasing back to the Home level.
- A short three-note success chime provides additional confirmation feedback when a booking is completed.
- A soft descending two-note conflict tone plays once when the booking-conflict/error state appears, giving clear negative-state feedback without using a harsh buzzer or alarm sound.
- Enabled buttons throughout the interface use a very subtle rounded interaction tone rather than a conventional click sound.
- The animated time-period intro on the **Choose Your Time Slots** screen uses a quiet six-note ascending bar-chime sequence synchronized with the existing cascading tab animation.
- The bar-chime sequence plays only during that intro animation. Manually switching between Early Morning, Morning, Afternoon, Evening, Night and Late Night continues to use the standard subtle button-interaction tone instead.
- The music control mutes and unmutes the **background jazz only**. Interface feedback sounds—including the rounded button tone, booking-success chime, booking-conflict/error tone and animated time-period bar chimes—remain available when the background music is muted.
- On mobile, the music control is shown on the Home screen only.
- On desktop/laptop, the music control remains accessible throughout the interface.
- Web Audio gain control is used for reliable background-music volume changes, while the short UI feedback sounds are preloaded audio assets for more consistent playback across supported mobile and desktop browsers, including iPhone.

The audio layer is supplementary and does not affect the booking workflow if background music is muted or unavailable.

## Interface

The interface includes:

- Responsive desktop and mobile layouts
- Light and dark themes
- Animated ambient backgrounds
- Written equipment-status labels
- Consistent selected and disabled states
- Mobile-safe sticky actions
- Contextual booking-state preservation
- Equipment image/detail views
- Shared semantic search behavior across equipment-related flows
- Background music and subtle audio interaction feedback

## Technology

- TypeScript
- React 19
- Vinext (Next.js App Router on Cloudflare Workers)
- Cloudflare D1 (SQLite) with Drizzle ORM
- Edge WebCrypto API (PBKDF2 password hashing & HMAC-SHA256 sessions)
- Tailwind CSS
- Web Audio API
- Cloudflare Wrangler tooling

## Production Backend Architecture

Practice Ready includes an enterprise-ready, serverless edge backend tailored for university music conservatory deployments:

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
                                      │   - Users & RBAC Sessions     │
                                      │   - Rooms & Campus Locations  │
                                      │   - Equipment & Conditions    │
                                      │   - Slots & Atomic Bookings   │
                                      └───────────────────────────────┘
```

### Database Schema (`db/schema.ts`)
- **`users`**: University student & staff accounts (`student`, `technician`, `admin`) with PBKDF2 hash + salt and student ID records.
- **`rooms`**: Music Practice Rooms (MPR 2, 3, 4, 5, Performance Hall) with capacity, description, and status.
- **`locations`**: Campus locations (rooms, blocks, labs, storage).
- **`equipment`**: 40+ authentic music gear items tracking default room, current physical location, condition, and status (`ready`, `away`, `attention`, `service`, `missing`).
- **`time_slots`**: Pre-generated 30-minute intervals indexed by `(room_id, date, status)`.
- **`bookings`**: Reservations with institutional booking reference (`PR-YYYY-XXXX`), student ownership, and duration constraints.
- **`booking_slots`**: Relational junction table linking bookings to reserved time slots.

### REST API Reference

| Method | Endpoint | Description | Role / Access |
|---|---|---|---|
| `POST` | `/api/auth/register` | Student/Staff account registration | Public |
| `POST` | `/api/auth/login` | Login and set `pr_session` HTTP-only cookie | Public |
| `POST` | `/api/auth/logout` | Clear session cookie | Authenticated |
| `GET` | `/api/auth/me` | Current user profile & role verification | Authenticated |
| `GET` | `/api/rooms` | Active practice rooms with capacity | Public |
| `GET` | `/api/availability` | Room slots grouped by period (`?roomId=X&date=YYYY-MM-DD`) | Public |
| `POST` | `/api/bookings` | Atomic slot booking with double-booking prevention | Student / Guest |
| `GET` | `/api/bookings` | Retrieve user bookings (`?filter=upcoming\|past`) | Student / Admin |
| `DELETE` | `/api/bookings/:id` | Cancel reservation and release time slots | Owner / Admin |
| `GET` | `/api/equipment` | Search equipment (`?query=&type=&locationId=&status=`) | Public |
| `GET` | `/api/equipment/room/:roomId` | Room equipment readiness breakdown (ready, away, attention) | Public |
| `PATCH` | `/api/equipment/:id` | Update equipment condition or physical location | Technician / Admin |
| `POST` | `/api/seed` | Initialize True School of Music rooms, gear, and slots | Admin / Dev |

### Booking Policy Enforcement
1. **Continuous 30-Minute Slots**: Disallows gap bookings or arbitrary time offsets.
2. **Maximum 3-Hour Duration**: Limits single student reservations to 180 minutes (6 consecutive 30-min slots).
3. **Atomic Concurrency Check**: If another user reserves an overlapping slot concurrently, returns `409 Conflict` with `conflictingSlots` list.

## Local Setup & Development

Install dependencies:

```bash
pnpm install
```

Generate database migrations:

```bash
pnpm db:generate
```

Run unit & concurrency tests:

```bash
npm test
```

Build the project:

```bash
npm run build
```

Start the production server:

```bash
npx vinext start
```

## Cloudflare D1 Deployment Guide

1. Create the D1 database on Cloudflare:
   ```bash
   npx wrangler d1 create practice_ready_db
   ```
2. Update the `database_id` in `wrangler.json`.
3. Apply migrations to Cloudflare D1:
   ```bash
   npx wrangler d1 migrations apply practice_ready_db --remote
   ```
4. Deploy the Workers application:
   ```bash
   npx wrangler deploy
   ```
5. Trigger initial seeding:
   ```bash
   curl -X POST https://<your-worker>.workers.dev/api/seed
   ```

