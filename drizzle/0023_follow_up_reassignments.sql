CREATE TABLE `follow_up_reassignments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`follow_up_id` int unsigned NOT NULL,
	`follow_up_code` varchar(32) NOT NULL,
	`from_owner_user_id` int unsigned,
	`from_owner_role` varchar(16),
	`to_owner_user_id` int unsigned,
	`to_owner_role` varchar(16),
	`reassigned_by_user_id` int unsigned,
	`reason` varchar(500),
	`created_at` datetime NOT NULL,
	CONSTRAINT `follow_up_reassignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `follow_up_reassignments` ADD CONSTRAINT `follow_up_reassignments_follow_up_id_follow_ups_id_fk` FOREIGN KEY (`follow_up_id`) REFERENCES `follow_ups`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_up_reassignments` ADD CONSTRAINT `follow_up_reassignments_from_owner_user_id_users_id_fk` FOREIGN KEY (`from_owner_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_up_reassignments` ADD CONSTRAINT `follow_up_reassignments_to_owner_user_id_users_id_fk` FOREIGN KEY (`to_owner_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_up_reassignments` ADD CONSTRAINT `follow_up_reassignments_reassigned_by_user_id_users_id_fk` FOREIGN KEY (`reassigned_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `follow_up_reassignments_fu_idx` ON `follow_up_reassignments` (`follow_up_id`,`created_at`);