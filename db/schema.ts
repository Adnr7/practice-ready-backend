import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  name: text("name").notNull(), // e.g. "MPR 2", "MPR 3"
  code: text("code").notNull().unique(), // e.g. "mpr-2", "mpr-3"
  capacity: integer("capacity").notNull(),
  description: text("description").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(), // e.g. "arts-block-a", "mp-lab-1"
  name: text("name").notNull(), // e.g. "Arts Block A"
  type: text("type").notNull(), // "room", "block", "lab", "storage"
});

export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: text("equipment_id").notNull().unique(), // e.g. "KEY-01", "MIX-01"
  name: text("name").notNull(), // e.g. "Yamaha P-125 digital piano"
  type: text("type").notNull(), // "keyboard", "mixer", "speaker", "drum", "mic", "cable", "stand", "accessory"
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
  uniqueIndex("idx_time_slots_unique").on(table.roomId, table.date, table.startTime),
]);

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingRef: text("booking_ref").notNull().unique(), // e.g. "PR-2026-9821"
  userId: integer("user_id").references(() => users.id),
  guestStudentName: text("guest_student_name"),
  guestStudentId: text("guest_student_id"),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(), // HH:MM
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


export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference").notNull().unique(),
  reporterId: integer("reporter_id").notNull().references(() => users.id),
  category: text("category", { enum: ["equipment", "room", "assistance"] }).notNull(),
  equipmentId: integer("equipment_id").references(() => equipment.id),
  roomId: integer("room_id").references(() => rooms.id),
  locationId: integer("location_id").references(() => locations.id),
  bookingId: integer("booking_id").references(() => bookings.id),
  issueType: text("issue_type"),
  description: text("description").notNull(),
  status: text("status", {
    enum: ["open", "acknowledged", "in_progress", "resolved", "closed", "reopened"],
  }).notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("idx_reports_reporter_created").on(table.reporterId, table.createdAt),
  index("idx_reports_status_created").on(table.status, table.createdAt),
  index("idx_reports_equipment").on(table.equipmentId),
  index("idx_reports_room").on(table.roomId),
  check("reports_category_check", sql`${table.category} IN ('equipment', 'room', 'assistance')`),
  check("reports_status_check", sql`${table.status} IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened')`),
]);

export const reportUpdates = sqliteTable("report_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id),
  status: text("status", {
    enum: ["open", "acknowledged", "in_progress", "resolved", "closed", "reopened"],
  }),
  message: text("message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_report_updates_report_created").on(table.reportId, table.createdAt),
  check("report_updates_status_check", sql`${table.status} IS NULL OR ${table.status} IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened')`),
]);
