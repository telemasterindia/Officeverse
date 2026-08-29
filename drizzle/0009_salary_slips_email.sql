CREATE TABLE `salary_slip_sends` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`salary_slip_id` bigint unsigned NOT NULL,
	`attempt_no` int unsigned NOT NULL,
	`status` enum('SENT','FAILED') NOT NULL,
	`recipient_email` varchar(191) NOT NULL,
	`provider` varchar(40),
	`provider_message_id` varchar(191),
	`error_message` varchar(500),
	`sent_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	CONSTRAINT `salary_slip_sends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `salary_slips` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`payroll_run_id` bigint unsigned NOT NULL,
	`user_id` int unsigned NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`status` enum('GENERATED','SENT','FAILED') NOT NULL DEFAULT 'GENERATED',
	`is_preview` boolean NOT NULL DEFAULT false,
	`employee_name` varchar(200) NOT NULL,
	`employee_email` varchar(191) NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL,
	`base_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`regularity_bonus` int unsigned NOT NULL DEFAULT 0,
	`calculated_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`leave_count` int unsigned NOT NULL DEFAULT 0,
	`off_count` int unsigned NOT NULL DEFAULT 0,
	`payroll_status_at_generation` enum('DRAFT','CALCULATED','APPROVED','LOCKED') NOT NULL,
	`calculation_version` varchar(16) NOT NULL DEFAULT 'v1',
	`file_name` varchar(255) NOT NULL,
	`storage_key` varchar(500) NOT NULL,
	`content_sha256` varchar(64) NOT NULL,
	`byte_size` int unsigned NOT NULL DEFAULT 0,
	`send_count` int unsigned NOT NULL DEFAULT 0,
	`last_sent_at` datetime,
	`last_error` varchar(500),
	`generated_by_user_id` int unsigned,
	`generated_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `salary_slips_id` PRIMARY KEY(`id`),
	CONSTRAINT `salary_slips_run_version_uq` UNIQUE(`payroll_run_id`,`version`)
);
--> statement-breakpoint
ALTER TABLE `salary_slip_sends` ADD CONSTRAINT `salary_slip_sends_salary_slip_id_salary_slips_id_fk` FOREIGN KEY (`salary_slip_id`) REFERENCES `salary_slips`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_slip_sends` ADD CONSTRAINT `salary_slip_sends_sent_by_user_id_users_id_fk` FOREIGN KEY (`sent_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD CONSTRAINT `salary_slips_payroll_run_id_payroll_runs_id_fk` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD CONSTRAINT `salary_slips_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD CONSTRAINT `salary_slips_generated_by_user_id_users_id_fk` FOREIGN KEY (`generated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `salary_slip_sends_slip_idx` ON `salary_slip_sends` (`salary_slip_id`);--> statement-breakpoint
CREATE INDEX `salary_slips_user_month_idx` ON `salary_slips` (`user_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `salary_slips_month_idx` ON `salary_slips` (`period_month`);--> statement-breakpoint
CREATE INDEX `salary_slips_status_idx` ON `salary_slips` (`status`);