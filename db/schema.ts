import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  fullName: text("full_name").notNull(),
  studentId: text("student_id"),
  phone: text("phone"),
  role: text("role", { enum: ["student", "technician", "admin"] }).notNull().default("student"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // e.g. "MPR 2", "MPR 3"
  code: text("code").notNull().unique(), // e.g. "mpr-2", "mpr-3"
  capacity: integer("capacity").notNull(),
  description: text("description").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  locationId: integer("location_id"),
  readinessState: text("readiness_state", { enum: ["usable", "restricted", "closed", "unknown"] }).notNull().default("unknown"),
  readinessNotes: text("readiness_notes"),
  readinessVerifiedAt: text("readiness_verified_at"),
  readinessVerifiedByUserId: integer("readiness_verified_by_user_id").references(() => users.id),
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
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  photoAttachmentId: integer("photo_attachment_id").references(() => attachments.id, { onDelete: "set null" }),
}, (table) => [
  index("idx_equipment_room").on(table.defaultRoomId),
  index("idx_equipment_location").on(table.currentLocationId, table.status),
]);

export const equipmentMovements = sqliteTable("equipment_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  movedByUserId: integer("moved_by_user_id").notNull().references(() => users.id),
  fromLocationId: integer("from_location_id").notNull().references(() => locations.id),
  toLocationId: integer("to_location_id").notNull().references(() => locations.id),
  status: text("status", { enum: ["open", "returned", "corrected"] }).notNull().default("open"),
  expectedReturnAt: text("expected_return_at"),
  movedAt: text("moved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  returnedAt: text("returned_at"),
  returnedByUserId: integer("returned_by_user_id").references(() => users.id),
  returnLocationId: integer("return_location_id").references(() => locations.id),
  notes: text("notes"),
  reservationId: integer("reservation_id").references(() => bookings.id, { onDelete: "set null" }),
  correctionReason: text("correction_reason"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_equipment_movements_equipment").on(table.equipmentId, table.status),
  index("idx_equipment_movements_user").on(table.movedByUserId, table.movedAt),
  uniqueIndex("idx_equipment_movements_one_open").on(table.equipmentId)
    .where(sql`${table.status} = 'open'`),
]);

export const movementReturnEvents = sqliteTable("movement_return_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  movementId: integer("movement_id").notNull().references(() => equipmentMovements.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  fromLocationId: integer("from_location_id").notNull().references(() => locations.id),
  toLocationId: integer("to_location_id").notNull().references(() => locations.id),
  eventType: text("event_type", { enum: ["return", "correction"] }).notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_movement_return_events_movement").on(table.movementId, table.createdAt),
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
  endDate: text("end_date"), // YYYY-MM-DD; null on legacy rows means date
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(), // HH:MM
  durationMinutes: integer("duration_minutes").notNull(),
  policyVersion: text("policy_version"),
  status: text("status", { enum: ["confirmed", "cancelled", "completed"] }).notNull().default("confirmed"),
  version: integer("version").notNull().default(1),
  mutationToken: text("mutation_token"),
  sessionEndedAt: text("session_ended_at"),
  cancelledAt: text("cancelled_at"),
  cancelledByUserId: integer("cancelled_by_user_id").references(() => users.id),
  cancellationReason: text("cancellation_reason"),
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

/** Active room occupancy. Historical booking_slots links are retained separately. */
export const bookingClaims = sqliteTable("booking_claims", {
  timeSlotId: integer("time_slot_id").primaryKey().references(() => timeSlots.id),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
}, (table) => [
  index("idx_booking_claims_booking").on(table.bookingId),
]);

export const bookingHistory = sqliteTable("booking_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: text("action", { enum: ["created", "rescheduled", "cancelled", "session_ended"] }).notNull(),
  previousRoomId: integer("previous_room_id"),
  previousDate: text("previous_date"),
  previousStartTime: text("previous_start_time"),
  previousEndTime: text("previous_end_time"),
  newRoomId: integer("new_room_id"),
  newDate: text("new_date"),
  newStartTime: text("new_start_time"),
  newEndTime: text("new_end_time"),
  reason: text("reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_booking_history_booking").on(table.bookingId, table.createdAt),
]);

export const sessionEquipmentUsage = sqliteTable("session_equipment_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  equipmentLabel: text("equipment_label").notNull(),
  equipmentCode: text("equipment_code").notNull(),
  observedLocationId: integer("observed_location_id").references(() => locations.id),
  observedCondition: text("observed_condition").notNull(),
  observedStatus: text("observed_status").notNull(),
  observedAt: text("observed_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_session_equipment_usage_unique").on(table.bookingId, table.equipmentId),
  index("idx_session_equipment_usage_booking").on(table.bookingId, table.createdAt),
]);

export const roomRestrictions = sqliteTable("room_restrictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  activityKey: text("activity_key").notNull(),
  state: text("state", { enum: ["allowed", "restricted", "unsupported", "unknown"] }).notNull(),
  explanation: text("explanation").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_room_restrictions_room").on(table.roomId, table.activityKey, table.isActive),
]);

export const roomClosures = sqliteTable("room_closures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text("reason").notNull(),
  sourceReportId: integer("source_report_id"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: text("cancelled_at"),
}, (table) => [
  index("idx_room_closures_room_window").on(table.roomId, table.startsAt, table.endsAt, table.isActive),
]);

export const equipmentInspections = sqliteTable("equipment_inspections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  inspectorUserId: integer("inspector_user_id").notNull().references(() => users.id),
  result: text("result", { enum: ["passed", "failed"] }).notNull(),
  condition: text("condition").notNull(),
  notes: text("notes"),
  observedAt: text("observed_at").notNull(),
  repairJobId: integer("repair_job_id"),
}, (table) => [
  index("idx_equipment_inspections_equipment").on(table.equipmentId, table.observedAt),
]);

export const repairJobs = sqliteTable("repair_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  sourceReportId: integer("source_report_id"),
  stage: text("stage", { enum: ["reported", "assessing", "awaiting_parts", "in_repair", "awaiting_inspection", "completed"] }).notNull().default("reported"),
  expectedReturnAt: text("expected_return_at"),
  openedByUserId: integer("opened_by_user_id").notNull().references(() => users.id),
  openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completionInspectionId: integer("completion_inspection_id"),
}, (table) => [
  index("idx_repair_jobs_equipment_stage").on(table.equipmentId, table.stage),
  uniqueIndex("idx_repair_jobs_one_open").on(table.equipmentId).where(sql`${table.stage} <> 'completed'`),
]);

export const repairUpdates = sqliteTable("repair_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repairJobId: integer("repair_job_id").notNull().references(() => repairJobs.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["reported", "assessing", "awaiting_parts", "in_repair", "awaiting_inspection", "completed"] }).notNull(),
  expectedReturnAt: text("expected_return_at"),
  publicMessage: text("public_message"),
  privateNote: text("private_note"),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_repair_updates_job_created").on(table.repairJobId, table.createdAt),
]);

export const practiceProfiles = sqliteTable("practice_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category", { enum: ["vocal", "band", "instrument"] }).notNull(),
  description: text("description").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const practiceRequirements = sqliteTable("practice_requirements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").notNull().references(() => practiceProfiles.id, { onDelete: "cascade" }),
  requirementKey: text("requirement_key").notNull(),
  label: text("label").notNull(),
  equipmentType: text("equipment_type"),
  equipmentNamePattern: text("equipment_name_pattern"),
  quantity: integer("quantity").notNull().default(1),
  isHard: integer("is_hard", { mode: "boolean" }).notNull().default(true),
  studentSupplied: integer("student_supplied", { mode: "boolean" }).notNull().default(false),
});

export const roomPracticeTypes = sqliteTable("room_practice_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").notNull().references(() => practiceProfiles.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["supported", "restricted", "unsupported", "unknown"] }).notNull(),
  explanation: text("explanation").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_room_practice_types_unique").on(table.roomId, table.profileId),
]);

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  dataUrl: text("data_url").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_attachments_owner_created").on(table.ownerUserId, table.createdAt),
]);

export const practiceJournalEntries = sqliteTable("practice_journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  note: text("note").notNull().default(""),
  attachmentIds: text("attachment_ids").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_practice_journal_booking_user").on(table.bookingId, table.userId),
]);

export const bookingPolicies = sqliteTable("booking_policies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: text("version").notNull().unique(),
  slotMinutes: integer("slot_minutes").notNull().default(30),
  minimumMinutes: integer("minimum_minutes").notNull().default(30),
  maximumMinutes: integer("maximum_minutes").notNull().default(180),
  advanceDays: integer("advance_days").notNull().default(14),
  openingTime: text("opening_time").notNull().default("00:00"),
  closingTime: text("closing_time").notNull().default("00:00"),
  cancellationCutoffMinutes: integer("cancellation_cutoff_minutes").notNull().default(0),
  studentWindow: integer("student_window", { mode: "boolean" }).notNull().default(true),
  equipmentHandling: text("equipment_handling").notNull(),
  movementRules: text("movement_rules").notNull(),
  publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedByUserId: integer("published_by_user_id").references(() => users.id),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
}, (table) => [
  uniqueIndex("idx_booking_policies_current").on(table.isCurrent).where(sql`${table.isCurrent} = 1`),
]);

export const supportContacts = sqliteTable("support_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  team: text("team").notNull(),
  email: text("email"),
  phone: text("phone"),
  hours: text("hours").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  reason: text("reason"),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
  index("idx_audit_events_actor").on(table.actorUserId, table.createdAt),
]);

export const idempotencyRecords = sqliteTable("idempotency_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  operation: text("operation").notNull(),
  requestKey: text("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at"),
}, (table) => [
  uniqueIndex("idx_idempotency_actor_operation_key").on(table.actorUserId, table.operation, table.requestKey),
]);


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
  attachmentIds: text("attachment_ids").notNull().default("[]"),
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

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey().notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [
  index("idx_sessions_user").on(table.userId),
  index("idx_sessions_expiry").on(table.expiresAt),
]);

export const movementPermissions = sqliteTable("movement_permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull().references(() => equipment.id),
  toLocationId: integer("to_location_id").notNull().references(() => locations.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  updatedByUserId: integer("updated_by_user_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_movement_permissions_pair").on(table.equipmentId, table.toLocationId),
  check("movement_permissions_active_check", sql`${table.isActive} IN (0, 1)`),
  check("movement_permissions_ids_check", sql`${table.equipmentId} > 0 AND ${table.toLocationId} > 0 AND ${table.updatedByUserId} > 0`),
]);
