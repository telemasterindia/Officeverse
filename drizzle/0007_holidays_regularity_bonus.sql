CREATE TABLE `regularity_bonus` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`eligible` boolean NOT NULL,
	`bonus_amount` int unsigned NOT NULL DEFAULT 0,
	`leave_count` int unsigned NOT NULL DEFAULT 0,
	`off_count` int unsigned NOT NULL DEFAULT 0,
	`disqualifying_reasons` json,
	`calculated_at` datetime NOT NULL,
	`calculation_version` varchar(16) NOT NULL DEFAULT 'v1',
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `regularity_bonus_id` PRIMARY KEY(`id`),
	CONSTRAINT `regularity_bonus_user_month_uq` UNIQUE(`user_id`,`period_month`)
);
--> statement-breakpoint
ALTER TABLE `holidays` ADD `observed_date` date;--> statement-breakpoint
ALTER TABLE `holidays` ADD `active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `holidays` ADD `created_by_user_id` int unsigned;--> statement-breakpoint
ALTER TABLE `holidays` ADD `updated_by_user_id` int unsigned;--> statement-breakpoint
ALTER TABLE `holidays` ADD `updated_at` datetime NOT NULL;--> statement-breakpoint
ALTER TABLE `regularity_bonus` ADD CONSTRAINT `regularity_bonus_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `regularity_bonus_month_idx` ON `regularity_bonus` (`period_month`);--> statement-breakpoint
CREATE INDEX `regularity_bonus_eligible_idx` ON `regularity_bonus` (`eligible`);--> statement-breakpoint
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `holidays_active_idx` ON `holidays` (`active`,`holiday_date`);