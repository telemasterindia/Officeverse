CREATE TABLE `payroll_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL,
	`status` enum('DRAFT','CALCULATED','APPROVED','LOCKED') NOT NULL DEFAULT 'DRAFT',
	`base_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`regularity_bonus` int unsigned NOT NULL DEFAULT 0,
	`calculated_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`leave_count` int unsigned NOT NULL DEFAULT 0,
	`off_count` int unsigned NOT NULL DEFAULT 0,
	`salary_profile_id` bigint unsigned,
	`bonus_record_id` bigint unsigned,
	`calculation_version` varchar(16) NOT NULL DEFAULT 'v1',
	`calculated_by_user_id` int unsigned,
	`calculated_at` datetime,
	`approved_by_user_id` int unsigned,
	`approved_at` datetime,
	`locked_by_user_id` int unsigned,
	`locked_at` datetime,
	`reopened_by_user_id` int unsigned,
	`reopened_at` datetime,
	`reopen_reason` varchar(255),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `payroll_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_runs_user_month_uq` UNIQUE(`user_id`,`period_month`)
);
--> statement-breakpoint
CREATE TABLE `salary_profiles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`base_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`effective_from` date NOT NULL,
	`effective_to` date,
	`active` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`created_by_user_id` int unsigned,
	`updated_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `salary_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `salary_profiles_user_from_uq` UNIQUE(`user_id`,`effective_from`)
);
--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_salary_profile_id_salary_profiles_id_fk` FOREIGN KEY (`salary_profile_id`) REFERENCES `salary_profiles`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_bonus_record_id_regularity_bonus_id_fk` FOREIGN KEY (`bonus_record_id`) REFERENCES `regularity_bonus`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_calculated_by_user_id_users_id_fk` FOREIGN KEY (`calculated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_approved_by_user_id_users_id_fk` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_locked_by_user_id_users_id_fk` FOREIGN KEY (`locked_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_reopened_by_user_id_users_id_fk` FOREIGN KEY (`reopened_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_profiles` ADD CONSTRAINT `salary_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_profiles` ADD CONSTRAINT `salary_profiles_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_profiles` ADD CONSTRAINT `salary_profiles_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `payroll_runs_month_idx` ON `payroll_runs` (`period_month`);--> statement-breakpoint
CREATE INDEX `payroll_runs_status_idx` ON `payroll_runs` (`status`);--> statement-breakpoint
CREATE INDEX `salary_profiles_user_idx` ON `salary_profiles` (`user_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `salary_profiles_active_idx` ON `salary_profiles` (`active`);