ALTER TABLE `bookings` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `mutation_token` text;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `session_ended_at` text;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `cancelled_at` text;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `cancelled_by_user_id` integer;
--> statement-breakpoint
ALTER TABLE `bookings` ADD COLUMN `cancellation_reason` text;
--> statement-breakpoint
CREATE TABLE `booking_claims` (
  `time_slot_id` integer PRIMARY KEY NOT NULL,
  `booking_id` integer NOT NULL,
  FOREIGN KEY (`time_slot_id`) REFERENCES `time_slots`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_booking_claims_booking` ON `booking_claims` (`booking_id`);
--> statement-breakpoint
CREATE TABLE `booking_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL,
  `actor_user_id` integer,
  `action` text NOT NULL CHECK (`action` IN ('created', 'rescheduled', 'cancelled', 'session_ended')),
  `previous_room_id` integer,
  `previous_date` text,
  `previous_start_time` text,
  `previous_end_time` text,
  `new_room_id` integer,
  `new_date` text,
  `new_start_time` text,
  `new_end_time` text,
  `reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_booking_history_booking` ON `booking_history` (`booking_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `session_equipment_usage` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL,
  `equipment_id` integer NOT NULL,
  `actor_user_id` integer NOT NULL,
  `equipment_label` text NOT NULL,
  `equipment_code` text NOT NULL,
  `observed_location_id` integer,
  `observed_condition` text NOT NULL,
  `observed_status` text NOT NULL,
  `observed_at` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`observed_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_equipment_usage_unique` ON `session_equipment_usage` (`booking_id`, `equipment_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_equipment_usage_booking` ON `session_equipment_usage` (`booking_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_booking_slots_unique` ON `booking_slots` (`booking_id`, `time_slot_id`);
--> statement-breakpoint
INSERT INTO `booking_claims` (`time_slot_id`, `booking_id`)
SELECT bs.time_slot_id, bs.booking_id
FROM `booking_slots` bs
JOIN `bookings` b ON b.id = bs.booking_id
WHERE b.status = 'confirmed';
--> statement-breakpoint
UPDATE `time_slots`
SET `status` = 'booked'
WHERE `id` IN (SELECT `time_slot_id` FROM `booking_claims`);
