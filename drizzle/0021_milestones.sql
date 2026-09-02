CREATE TABLE `milestone_triggers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`milestone_id` int unsigned NOT NULL,
	`user_id` int unsigned,
	`period_key` varchar(24) NOT NULL,
	`source_type` varchar(40),
	`source_id` varchar(64),
	`threshold_value` int NOT NULL,
	`actual_value` int NOT NULL,
	`dedupe_key` varchar(191) NOT NULL,
	`recognition_seq` int,
	`triggered_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `milestone_triggers_id` PRIMARY KEY(`id`),
	CONSTRAINT `milestone_triggers_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(400),
	`enabled` boolean NOT NULL DEFAULT false,
	`type` enum('INDIVIDUAL_COUNT','INDIVIDUAL_POINTS','INDIVIDUAL_EVENT','TEAM_COUNT','TEAM_POINTS','TEAM_EVENT') NOT NULL,
	`metric` varchar(64),
	`threshold` int NOT NULL,
	`period` enum('DAILY','WEEKLY','MONTHLY','ALL_TIME') NOT NULL DEFAULT 'ALL_TIME',
	`trigger_policy` enum('ONCE','PER_PERIOD','EVERY_THRESHOLD_CROSSING') NOT NULL DEFAULT 'ONCE',
	`scope` json,
	`priority` int NOT NULL DEFAULT 100,
	`recognition_level` enum('LEVEL_1','LEVEL_2','LEVEL_3','LEVEL_4') NOT NULL DEFAULT 'LEVEL_2',
	`celebration_profile_id` int unsigned,
	`announcement_id` int unsigned,
	`effective_from` date NOT NULL,
	`effective_until` date,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `milestone_triggers` ADD CONSTRAINT `milestone_triggers_milestone_id_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `milestone_triggers` ADD CONSTRAINT `milestone_triggers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `milestone_triggers_milestone_idx` ON `milestone_triggers` (`milestone_id`,`triggered_at`);--> statement-breakpoint
CREATE INDEX `milestones_enabled_idx` ON `milestones` (`enabled`,`type`);