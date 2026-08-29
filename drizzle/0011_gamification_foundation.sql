CREATE TABLE `gamification_achievements` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(60) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(400),
	`badge` varchar(16),
	`category` varchar(40) NOT NULL DEFAULT 'general',
	`criteria` json,
	`repeatable` boolean NOT NULL DEFAULT false,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `gamification_achievements_id` PRIMARY KEY(`id`),
	CONSTRAINT `gamification_achievements_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `gamification_point_rules` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`event` enum('LEAD_SUBMITTED','LEAD_ACCEPTED','SALE','TEAM_MILESTONE','ACHIEVEMENT_UNLOCKED','ADMIN_ADJUSTMENT') NOT NULL,
	`points` int NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`updated_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `gamification_point_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `gamification_point_rules_event_uq` UNIQUE(`event`)
);
--> statement-breakpoint
CREATE TABLE `gamification_point_transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`role` enum('agent','closer') NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL,
	`event` enum('LEAD_SUBMITTED','LEAD_ACCEPTED','SALE','TEAM_MILESTONE','ACHIEVEMENT_UNLOCKED','ADMIN_ADJUSTMENT') NOT NULL,
	`points` int NOT NULL,
	`operational_date` date NOT NULL,
	`reference_type` varchar(40),
	`reference_id` varchar(64),
	`dedupe_key` varchar(191) NOT NULL,
	`status` enum('ACTIVE','REVERSED') NOT NULL DEFAULT 'ACTIVE',
	`source` enum('system','admin') NOT NULL DEFAULT 'system',
	`reversal_of_id` bigint unsigned,
	`reason` varchar(255),
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	CONSTRAINT `gamification_point_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `gamification_point_txn_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `gamification_streaks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`streak_type` enum('ACCEPTED_LEAD_STREAK') NOT NULL,
	`current_count` int unsigned NOT NULL DEFAULT 0,
	`best_count` int unsigned NOT NULL DEFAULT 0,
	`last_operational_date` date,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `gamification_streaks_id` PRIMARY KEY(`id`),
	CONSTRAINT `gamification_streak_user_type_uq` UNIQUE(`user_id`,`streak_type`)
);
--> statement-breakpoint
CREATE TABLE `gamification_user_achievements` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`achievement_code` varchar(60) NOT NULL,
	`earned_at` datetime NOT NULL,
	`trigger_type` varchar(40),
	`trigger_id` varchar(64),
	`created_by_user_id` int unsigned,
	CONSTRAINT `gamification_user_achievements_id` PRIMARY KEY(`id`),
	CONSTRAINT `gamification_user_achievement_uq` UNIQUE(`user_id`,`achievement_code`)
);
--> statement-breakpoint
ALTER TABLE `gamification_point_rules` ADD CONSTRAINT `gamification_point_rules_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD CONSTRAINT `gamification_point_transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD CONSTRAINT `gamification_point_transactions_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_streaks` ADD CONSTRAINT `gamification_streaks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_user_achievements` ADD CONSTRAINT `gamification_user_achievements_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_user_achievements` ADD CONSTRAINT `gamification_user_achievements_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `gamification_point_txn_user_date_idx` ON `gamification_point_transactions` (`user_id`,`operational_date`);--> statement-breakpoint
CREATE INDEX `gamification_point_txn_date_idx` ON `gamification_point_transactions` (`operational_date`);--> statement-breakpoint
CREATE INDEX `gamification_point_txn_user_status_idx` ON `gamification_point_transactions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `gamification_user_achievement_user_idx` ON `gamification_user_achievements` (`user_id`);