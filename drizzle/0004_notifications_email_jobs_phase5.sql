DROP INDEX `notifications_recipient_idx` ON `notifications`;--> statement-breakpoint
ALTER TABLE `email_jobs` MODIFY COLUMN `kind` varchar(60) NOT NULL;--> statement-breakpoint
ALTER TABLE `email_jobs` MODIFY COLUMN `body_text` mediumtext;--> statement-breakpoint
ALTER TABLE `email_jobs` ADD `payload` json;--> statement-breakpoint
ALTER TABLE `email_jobs` ADD `failed_at` datetime;--> statement-breakpoint
ALTER TABLE `notifications` ADD `metadata` json;--> statement-breakpoint
CREATE INDEX `email_jobs_lease_idx` ON `email_jobs` (`status`,`locked_at`);--> statement-breakpoint
CREATE INDEX `email_jobs_to_user_idx` ON `email_jobs` (`to_user_id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_user_id`,`created_at`);