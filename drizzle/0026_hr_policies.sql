CREATE TABLE `hr_policies` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` mediumtext NOT NULL,
	`effective_date` date,
	`status` enum('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
	`created_by_user_id` int unsigned,
	`updated_by_user_id` int unsigned,
	`published_by_user_id` int unsigned,
	`published_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `hr_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `hr_policies` ADD CONSTRAINT `hr_policies_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `hr_policies` ADD CONSTRAINT `hr_policies_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `hr_policies` ADD CONSTRAINT `hr_policies_published_by_user_id_users_id_fk` FOREIGN KEY (`published_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `hr_policies_status_idx` ON `hr_policies` (`status`,`effective_date`);