ALTER TABLE `rooms` ADD COLUMN `location_id` integer;
--> statement-breakpoint
ALTER TABLE `rooms` ADD COLUMN `readiness_state` text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `rooms` ADD COLUMN `readiness_notes` text;
--> statement-breakpoint
ALTER TABLE `rooms` ADD COLUMN `readiness_verified_at` text;
--> statement-breakpoint
ALTER TABLE `rooms` ADD COLUMN `readiness_verified_by_user_id` integer;
--> statement-breakpoint
UPDATE `rooms`
SET `location_id` = (SELECT id FROM `locations` WHERE locations.code = rooms.code LIMIT 1)
WHERE `location_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `rooms_readiness_state_guard_insert`
BEFORE INSERT ON `rooms`
WHEN NEW.readiness_state NOT IN ('usable', 'restricted', 'closed', 'unknown')
BEGIN SELECT RAISE(ABORT, 'invalid room readiness state'); END;
--> statement-breakpoint
CREATE TRIGGER `rooms_readiness_state_guard_update`
BEFORE UPDATE OF `readiness_state` ON `rooms`
WHEN NEW.readiness_state NOT IN ('usable', 'restricted', 'closed', 'unknown')
BEGIN SELECT RAISE(ABORT, 'invalid room readiness state'); END;
--> statement-breakpoint
CREATE TABLE `room_restrictions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `room_id` integer NOT NULL,
  `activity_key` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('allowed', 'restricted', 'unsupported', 'unknown')),
  `explanation` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_by_user_id` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE cascade,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_room_restrictions_room` ON `room_restrictions` (`room_id`, `activity_key`, `is_active`);
--> statement-breakpoint
CREATE TABLE `room_closures` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `room_id` integer NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `reason` text NOT NULL,
  `source_report_id` integer,
  `created_by_user_id` integer NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `cancelled_at` text,
  CHECK (`starts_at` < `ends_at`),
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE cascade,
  FOREIGN KEY (`source_report_id`) REFERENCES `reports`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_room_closures_room_window` ON `room_closures` (`room_id`, `starts_at`, `ends_at`, `is_active`);
--> statement-breakpoint
CREATE TABLE `equipment_inspections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `equipment_id` integer NOT NULL,
  `inspector_user_id` integer NOT NULL,
  `result` text NOT NULL CHECK (`result` IN ('passed', 'failed')),
  `condition` text NOT NULL,
  `notes` text,
  `observed_at` text NOT NULL,
  `repair_job_id` integer,
  FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`),
  FOREIGN KEY (`inspector_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_equipment_inspections_equipment` ON `equipment_inspections` (`equipment_id`, `observed_at`);
--> statement-breakpoint
CREATE TABLE `repair_jobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `equipment_id` integer NOT NULL,
  `source_report_id` integer,
  `stage` text NOT NULL DEFAULT 'reported' CHECK (`stage` IN ('reported', 'assessing', 'awaiting_parts', 'in_repair', 'awaiting_inspection', 'completed')),
  `expected_return_at` text,
  `opened_by_user_id` integer NOT NULL,
  `opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  `completed_by_user_id` integer,
  `completion_inspection_id` integer,
  FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`),
  FOREIGN KEY (`source_report_id`) REFERENCES `reports`(`id`),
  FOREIGN KEY (`opened_by_user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`completed_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_repair_jobs_equipment_stage` ON `repair_jobs` (`equipment_id`, `stage`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repair_jobs_one_open` ON `repair_jobs` (`equipment_id`) WHERE `stage` <> 'completed';
--> statement-breakpoint
CREATE TRIGGER `repair_jobs_completion_inspection_guard_insert`
BEFORE INSERT ON `repair_jobs`
WHEN NEW.stage = 'completed' AND NOT EXISTS (
  SELECT 1 FROM `equipment_inspections` i
  WHERE i.id = NEW.completion_inspection_id AND i.equipment_id = NEW.equipment_id AND i.result = 'passed'
)
BEGIN SELECT RAISE(ABORT, 'repair completion requires a passed inspection'); END;
--> statement-breakpoint
CREATE TRIGGER `repair_jobs_completion_inspection_guard_update`
BEFORE UPDATE OF `stage`, `completion_inspection_id` ON `repair_jobs`
WHEN NEW.stage = 'completed' AND NOT EXISTS (
  SELECT 1 FROM `equipment_inspections` i
  WHERE i.id = NEW.completion_inspection_id AND i.equipment_id = NEW.equipment_id AND i.result = 'passed'
)
BEGIN SELECT RAISE(ABORT, 'repair completion requires a passed inspection'); END;
--> statement-breakpoint
CREATE TABLE `repair_updates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `repair_job_id` integer NOT NULL,
  `stage` text NOT NULL CHECK (`stage` IN ('reported', 'assessing', 'awaiting_parts', 'in_repair', 'awaiting_inspection', 'completed')),
  `expected_return_at` text,
  `public_message` text,
  `private_note` text,
  `actor_user_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`repair_job_id`) REFERENCES `repair_jobs`(`id`) ON DELETE cascade,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_repair_updates_job_created` ON `repair_updates` (`repair_job_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `practice_profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `category` text NOT NULL CHECK (`category` IN ('vocal', 'band', 'instrument')),
  `description` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `version` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE `practice_requirements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `profile_id` integer NOT NULL,
  `requirement_key` text NOT NULL,
  `label` text NOT NULL,
  `equipment_type` text,
  `equipment_name_pattern` text,
  `quantity` integer NOT NULL DEFAULT 1,
  `is_hard` integer NOT NULL DEFAULT 1,
  `student_supplied` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`profile_id`) REFERENCES `practice_profiles`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_practice_types` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `room_id` integer NOT NULL,
  `profile_id` integer NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('supported', 'restricted', 'unsupported', 'unknown')),
  `explanation` text NOT NULL,
  `updated_by_user_id` integer,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE cascade,
  FOREIGN KEY (`profile_id`) REFERENCES `practice_profiles`(`id`) ON DELETE cascade,
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_practice_types_unique` ON `room_practice_types` (`room_id`, `profile_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `practice_profiles` (`code`, `name`, `category`, `description`) VALUES
  ('vocal-acoustic', 'Vocal · acoustic', 'vocal', 'Unamplified vocal practice.'),
  ('vocal-amplified', 'Vocal · amplified', 'vocal', 'Amplified vocal practice with a basic PA setup.'),
  ('band', 'Band rehearsal', 'band', 'Band practice with room capacity and rhythm-section checks.'),
  ('instrument-keyboard', 'Individual · keyboard', 'instrument', 'Individual keyboard practice with power support.');
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'microphone', 'Microphone', 'mic', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-acoustic';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'microphone', 'Microphone', 'mic', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-amplified';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'mixer', 'Mixer', 'mixer', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-amplified';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'speaker', 'Speaker', 'speaker', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-amplified';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'cable', 'Microphone cable', 'cable', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-amplified';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'stand', 'Microphone stand', 'stand', 1, 1 FROM `practice_profiles` WHERE code = 'vocal-amplified';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'drum-kit', 'Drum kit', 'drum', 1, 1 FROM `practice_profiles` WHERE code = 'band';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'mixer', 'Mixer', 'mixer', 1, 0 FROM `practice_profiles` WHERE code = 'band';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'keyboard', 'Keyboard', 'keyboard', 1, 1 FROM `practice_profiles` WHERE code = 'instrument-keyboard';
--> statement-breakpoint
INSERT INTO `practice_requirements` (`profile_id`, `requirement_key`, `label`, `equipment_type`, `quantity`, `is_hard`)
SELECT id, 'adapter', 'Keyboard power adapter', 'accessory', 1, 1 FROM `practice_profiles` WHERE code = 'instrument-keyboard';
