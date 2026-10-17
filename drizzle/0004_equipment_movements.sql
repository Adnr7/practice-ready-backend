CREATE TABLE `equipment_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`equipment_id` integer NOT NULL,
	`moved_by_user_id` integer NOT NULL,
	`from_location_id` integer NOT NULL,
	`to_location_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'returned', 'corrected')),
	`expected_return_at` text,
	`moved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`returned_at` text,
	`returned_by_user_id` integer,
	`return_location_id` integer,
	`notes` text,
	`correction_reason` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`returned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`return_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_equipment_movements_equipment` ON `equipment_movements` (`equipment_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_equipment_movements_user` ON `equipment_movements` (`moved_by_user_id`,`moved_at`);--> statement-breakpoint
CREATE INDEX `idx_equipment_movements_open` ON `equipment_movements` (`equipment_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_equipment_movements_one_open` ON `equipment_movements` (`equipment_id`) WHERE `status` = 'open';--> statement-breakpoint
CREATE TABLE `movement_return_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movement_id` integer NOT NULL,
	`actor_user_id` integer NOT NULL,
	`from_location_id` integer NOT NULL,
	`to_location_id` integer NOT NULL,
	`event_type` text NOT NULL CHECK (`event_type` IN ('return', 'correction')),
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`movement_id`) REFERENCES `equipment_movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_movement_return_events_movement` ON `movement_return_events` (`movement_id`,`created_at`);
