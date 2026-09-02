CREATE TABLE `scoring_rule_versions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`rule_id` int unsigned NOT NULL,
	`version` int NOT NULL,
	`name_snapshot` varchar(120) NOT NULL,
	`event_snapshot` varchar(64) NOT NULL,
	`applies_to_snapshot` json,
	`condition_tree` json,
	`outcome` json NOT NULL,
	`effective_from` date NOT NULL,
	`effective_until` date,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	CONSTRAINT `scoring_rule_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `scoring_rule_versions_rule_version_uq` UNIQUE(`rule_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `scoring_rules` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`event` varchar(64) NOT NULL,
	`applies_to` json,
	`rule_matching_mode` enum('FIRST_MATCH','HIGHEST_MATCH','ALL_MATCHES') NOT NULL DEFAULT 'FIRST_MATCH',
	`priority` int NOT NULL DEFAULT 100,
	`enabled` boolean NOT NULL DEFAULT false,
	`current_version` int NOT NULL DEFAULT 1,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `scoring_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scoring_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`source_type` varchar(40) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`subject_user_id` int unsigned NOT NULL,
	`operational_date` date NOT NULL,
	`occurred_at` datetime NOT NULL,
	`payload_snapshot` json,
	`matched_rule_ids` json,
	`awarded_points_total` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL,
	CONSTRAINT `scoring_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scoring_runs_event_source_uq` UNIQUE(`event_type`,`source_type`,`source_id`)
);
--> statement-breakpoint
ALTER TABLE `gamification_point_rules` MODIFY COLUMN `event` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` MODIFY COLUMN `event` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD `rule_id` int unsigned;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD `rule_version` int;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD `rule_name` varchar(120);--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD `context` json;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD `score_run_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `scoring_rule_versions` ADD CONSTRAINT `scoring_rule_versions_rule_id_scoring_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `scoring_rules`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `scoring_rule_versions` ADD CONSTRAINT `scoring_rule_versions_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `scoring_rules` ADD CONSTRAINT `scoring_rules_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `scoring_rule_versions_rule_idx` ON `scoring_rule_versions` (`rule_id`);--> statement-breakpoint
CREATE INDEX `scoring_rules_event_idx` ON `scoring_rules` (`event`);--> statement-breakpoint
CREATE INDEX `scoring_rules_enabled_event_idx` ON `scoring_rules` (`enabled`,`event`);--> statement-breakpoint
CREATE INDEX `scoring_runs_subject_idx` ON `scoring_runs` (`subject_user_id`);--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD CONSTRAINT `gamification_point_transactions_rule_id_scoring_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `scoring_rules`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `gamification_point_transactions` ADD CONSTRAINT `gamification_point_transactions_score_run_id_scoring_runs_id_fk` FOREIGN KEY (`score_run_id`) REFERENCES `scoring_runs`(`id`) ON DELETE set null ON UPDATE cascade;