CREATE TABLE `lead_assignments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`lead_id` int unsigned NOT NULL,
	`from_closer_id` int unsigned,
	`to_closer_id` int unsigned,
	`action` enum('assign','reassign','unassign') NOT NULL,
	`by_user_id` int unsigned,
	`note` varchar(500),
	`created_at` datetime NOT NULL,
	CONSTRAINT `lead_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `lead_assignments` ADD CONSTRAINT `lead_assignments_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lead_assignments` ADD CONSTRAINT `lead_assignments_from_closer_id_closers_id_fk` FOREIGN KEY (`from_closer_id`) REFERENCES `closers`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lead_assignments` ADD CONSTRAINT `lead_assignments_to_closer_id_closers_id_fk` FOREIGN KEY (`to_closer_id`) REFERENCES `closers`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lead_assignments` ADD CONSTRAINT `lead_assignments_by_user_id_users_id_fk` FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `lead_assignments_lead_idx` ON `lead_assignments` (`lead_id`);--> statement-breakpoint
CREATE INDEX `lead_assignments_created_idx` ON `lead_assignments` (`created_at`);