CREATE TABLE `incentive_results` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`scheme_id` int unsigned NOT NULL,
	`scheme_version` int NOT NULL,
	`user_id` int unsigned NOT NULL,
	`period_from` date NOT NULL,
	`period_to` date NOT NULL,
	`status` enum('CALCULATED','REVIEWED','APPROVED','FINALIZED','REVERSED','NOT_ELIGIBLE','NO_MATCH','OUT_OF_SCOPE') NOT NULL DEFAULT 'CALCULATED',
	`points` int NOT NULL DEFAULT 0,
	`reward_kind` enum('FIXED','TIERED','PERCENT','RECOGNITION') NOT NULL,
	`reward_amount` int NOT NULL DEFAULT 0,
	`currency` varchar(8) NOT NULL DEFAULT 'INR',
	`reward_label` varchar(120),
	`metrics` json,
	`explanation` json,
	`dedupe_key` varchar(191) NOT NULL,
	`calculated_by_user_id` int unsigned,
	`calculated_at` datetime NOT NULL,
	`reviewed_by_user_id` int unsigned,
	`reviewed_at` datetime,
	`approved_by_user_id` int unsigned,
	`approved_at` datetime,
	`finalized_by_user_id` int unsigned,
	`finalized_at` datetime,
	`reversed_by_user_id` int unsigned,
	`reversed_at` datetime,
	`reason` varchar(255),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `incentive_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `incentive_results_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `incentive_scheme_versions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`scheme_id` int unsigned NOT NULL,
	`version` int NOT NULL,
	`name_snapshot` varchar(120) NOT NULL,
	`period_type_snapshot` enum('daily','weekly','monthly','custom') NOT NULL,
	`scope` json,
	`eligibility` json,
	`reward` json NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'INR',
	`effective_from` date NOT NULL,
	`effective_until` date,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	CONSTRAINT `incentive_scheme_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `incentive_scheme_versions_scheme_version_uq` UNIQUE(`scheme_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `incentive_schemes` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(400),
	`enabled` boolean NOT NULL DEFAULT false,
	`period_type` enum('daily','weekly','monthly','custom') NOT NULL DEFAULT 'monthly',
	`priority` int NOT NULL DEFAULT 100,
	`combine_mode` enum('independent','exclusive','highest') NOT NULL DEFAULT 'independent',
	`current_version` int NOT NULL DEFAULT 1,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `incentive_schemes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_scheme_id_incentive_schemes_id_fk` FOREIGN KEY (`scheme_id`) REFERENCES `incentive_schemes`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_calculated_by_user_id_users_id_fk` FOREIGN KEY (`calculated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_reviewed_by_user_id_users_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_approved_by_user_id_users_id_fk` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_finalized_by_user_id_users_id_fk` FOREIGN KEY (`finalized_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_results` ADD CONSTRAINT `incentive_results_reversed_by_user_id_users_id_fk` FOREIGN KEY (`reversed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_scheme_versions` ADD CONSTRAINT `incentive_scheme_versions_scheme_id_incentive_schemes_id_fk` FOREIGN KEY (`scheme_id`) REFERENCES `incentive_schemes`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_scheme_versions` ADD CONSTRAINT `incentive_scheme_versions_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `incentive_schemes` ADD CONSTRAINT `incentive_schemes_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `incentive_results_user_idx` ON `incentive_results` (`user_id`,`period_from`);--> statement-breakpoint
CREATE INDEX `incentive_results_scheme_idx` ON `incentive_results` (`scheme_id`,`status`);--> statement-breakpoint
CREATE INDEX `incentive_scheme_versions_scheme_idx` ON `incentive_scheme_versions` (`scheme_id`);--> statement-breakpoint
CREATE INDEX `incentive_schemes_enabled_idx` ON `incentive_schemes` (`enabled`);