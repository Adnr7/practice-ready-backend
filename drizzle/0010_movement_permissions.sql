CREATE TABLE `movement_permissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `equipment_id` integer NOT NULL REFERENCES `equipment`(`id`),
  `to_location_id` integer NOT NULL REFERENCES `locations`(`id`),
  `is_active` integer DEFAULT 0 NOT NULL,
  `updated_by_user_id` integer NOT NULL REFERENCES `users`(`id`),
  `reason` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `movement_permissions_active_check` CHECK (`is_active` IN (0, 1)),
  CONSTRAINT `movement_permissions_ids_check` CHECK (`equipment_id` > 0 AND `to_location_id` > 0 AND `updated_by_user_id` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_movement_permissions_pair` ON `movement_permissions` (`equipment_id`, `to_location_id`);
