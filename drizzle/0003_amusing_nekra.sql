-- Wrangler/D1 executes this whole file and its ledger insertion in one transaction.
-- Keep foreign keys enabled. Stage history WITHOUT foreign keys, then remove the
-- old child before dropping its parent so ON DELETE CASCADE cannot erase history.
CREATE TABLE `__backup_report_updates` AS
SELECT "id", "report_id", "author_id", "status", "message", "created_at" FROM `report_updates`;
--> statement-breakpoint
-- Preserve previously issued IDs even when the highest rows have been deleted.
CREATE TABLE `__backup_report_sequences` AS
SELECT "name", "seq" FROM `sqlite_sequence` WHERE "name" IN ('reports', 'report_updates');
--> statement-breakpoint
DROP TABLE `report_updates`;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`reporter_id` integer NOT NULL,
	`category` text NOT NULL,
	`equipment_id` integer,
	`room_id` integer,
	`location_id` integer,
	`booking_id` integer,
	`issue_type` text,
	`description` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_category_check" CHECK("__new_reports"."category" IN ('equipment', 'room', 'assistance')),
	CONSTRAINT "reports_status_check" CHECK("__new_reports"."status" IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened'))
);
--> statement-breakpoint
INSERT INTO `__new_reports`("id", "reference", "reporter_id", "category", "equipment_id", "room_id", "location_id", "booking_id", "issue_type", "description", "status", "created_at", "updated_at", "resolved_at") SELECT "id", "reference", "reporter_id", "category", "equipment_id", "room_id", "location_id", "booking_id", "issue_type", "description", "status", "created_at", "updated_at", "resolved_at" FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reference_unique` ON `reports` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_reports_reporter_created` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_status_created` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_equipment` ON `reports` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `idx_reports_room` ON `reports` (`room_id`);--> statement-breakpoint
CREATE TABLE `__new_report_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`status` text,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_updates_status_check" CHECK("__new_report_updates"."status" IS NULL OR "__new_report_updates"."status" IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened'))
);
--> statement-breakpoint
INSERT INTO `__new_report_updates`("id", "report_id", "author_id", "status", "message", "created_at") SELECT "id", "report_id", "author_id", "status", "message", "created_at" FROM `__backup_report_updates`;--> statement-breakpoint
DROP TABLE `__backup_report_updates`;--> statement-breakpoint
ALTER TABLE `__new_report_updates` RENAME TO `report_updates`;--> statement-breakpoint
CREATE INDEX `idx_report_updates_report_created` ON `report_updates` (`report_id`,`created_at`);--> statement-breakpoint
INSERT INTO `sqlite_sequence` ("name", "seq")
SELECT b.name, b.seq FROM `__backup_report_sequences` b
WHERE NOT EXISTS (SELECT 1 FROM `sqlite_sequence` s WHERE s.name = b.name);
--> statement-breakpoint
UPDATE `sqlite_sequence`
SET "seq" = max("seq", coalesce((SELECT b.seq FROM `__backup_report_sequences` b WHERE b.name = sqlite_sequence.name), 0))
WHERE "name" IN ('reports', 'report_updates');
--> statement-breakpoint
DROP TABLE `__backup_report_sequences`;
