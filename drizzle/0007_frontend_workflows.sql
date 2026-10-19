ALTER TABLE `bookings` ADD COLUMN `policy_version` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `phone` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `is_active` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `equipment` ADD COLUMN `archived` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `equipment` ADD COLUMN `photo_attachment_id` integer REFERENCES `attachments`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `equipment_movements` ADD COLUMN `reservation_id` integer REFERENCES `bookings`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `reports` ADD COLUMN `attachment_ids` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE `attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_user_id` integer NOT NULL,
  `file_name` text NOT NULL,
  `media_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `data_url` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_owner_created` ON `attachments` (`owner_user_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `practice_journal_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `booking_id` integer NOT NULL,
  `user_id` integer NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `attachment_ids` text NOT NULL DEFAULT '[]',
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_practice_journal_booking_user` ON `practice_journal_entries` (`booking_id`, `user_id`);
--> statement-breakpoint
CREATE TABLE `booking_policies` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `version` text NOT NULL UNIQUE,
  `slot_minutes` integer NOT NULL DEFAULT 30,
  `minimum_minutes` integer NOT NULL DEFAULT 30,
  `maximum_minutes` integer NOT NULL DEFAULT 180,
  `advance_days` integer NOT NULL DEFAULT 14,
  `opening_time` text NOT NULL DEFAULT '00:00',
  `closing_time` text NOT NULL DEFAULT '00:00',
  `cancellation_cutoff_minutes` integer NOT NULL DEFAULT 0,
  `equipment_handling` text NOT NULL,
  `movement_rules` text NOT NULL,
  `published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `published_by_user_id` integer,
  `is_current` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`published_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_booking_policies_current` ON `booking_policies` (`is_current`) WHERE `is_current` = 1;
--> statement-breakpoint
CREATE TABLE `support_contacts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `team` text NOT NULL,
  `email` text,
  `phone` text,
  `hours` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_user_id` integer,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `reason` text,
  `details` text NOT NULL DEFAULT '{}',
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity` ON `audit_events` (`entity_type`, `entity_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_actor` ON `audit_events` (`actor_user_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `idempotency_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_user_id` integer NOT NULL,
  `operation` text NOT NULL,
  `request_key` text NOT NULL,
  `request_hash` text NOT NULL,
  `status_code` integer NOT NULL,
  `response_body` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_idempotency_actor_operation_key` ON `idempotency_records` (`actor_user_id`, `operation`, `request_key`);
--> statement-breakpoint
INSERT OR IGNORE INTO `booking_policies`
  (`version`, `slot_minutes`, `minimum_minutes`, `maximum_minutes`, `advance_days`, `opening_time`, `closing_time`, `cancellation_cutoff_minutes`, `equipment_handling`, `movement_rules`, `is_current`)
VALUES
  ('2026-10-pilot', 30, 30, 180, 14, '00:00', '00:00', 0,
   'A booking reserves room time only. Equipment readiness is observed at confirmation and is not guaranteed for a future session.',
   'Students may move only policy-designated equipment during an active session and must record an expected return.', 1);
--> statement-breakpoint
INSERT INTO `support_contacts` (`name`, `team`, `email`, `phone`, `hours`, `sort_order`)
SELECT 'Facilities & Technical Support', 'FTS', NULL, NULL, 'Support contact details are pending institutional verification.', 0
WHERE NOT EXISTS (SELECT 1 FROM `support_contacts`);
