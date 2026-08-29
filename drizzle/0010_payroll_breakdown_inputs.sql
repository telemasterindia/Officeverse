CREATE TABLE `employment_periods` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	`active` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`created_by_user_id` int unsigned,
	`updated_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `employment_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `employment_periods_user_start_uq` UNIQUE(`user_id`,`start_date`)
);
--> statement-breakpoint
CREATE TABLE `overtime_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`work_date` date NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`scheduled_shift_start` varchar(5),
	`scheduled_shift_end` varchar(5),
	`actual_logout` datetime,
	`overtime_minutes` int unsigned NOT NULL DEFAULT 0,
	`status` enum('PENDING','APPROVED','REJECTED','VOID') NOT NULL DEFAULT 'PENDING',
	`reason` varchar(255),
	`created_by_user_id` int unsigned,
	`approved_by_user_id` int unsigned,
	`approved_at` datetime,
	`payroll_run_id` bigint unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `overtime_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `overtime_records_user_date_uq` UNIQUE(`user_id`,`work_date`)
);
--> statement-breakpoint
CREATE TABLE `payroll_adjustments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`kind` enum('EARNING','DEDUCTION') NOT NULL,
	`label` varchar(120) NOT NULL,
	`amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`status` enum('ACTIVE','VOID') NOT NULL DEFAULT 'ACTIVE',
	`reason` varchar(255),
	`created_by_user_id` int unsigned,
	`voided_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `payroll_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `unpaid` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `monthly_base_salary` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `payable_base_salary` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `proration_basis` varchar(24);--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `proration_numerator` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `proration_denominator` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `unpaid_leave_days` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `unpaid_leave_deduction` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `off_days_considered` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `off_deduction` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `approved_overtime_minutes` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `overtime_amount` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `adjustments_total` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `employment_periods` ADD CONSTRAINT `employment_periods_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_periods` ADD CONSTRAINT `employment_periods_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_periods` ADD CONSTRAINT `employment_periods_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_approved_by_user_id_users_id_fk` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_payroll_run_id_payroll_runs_id_fk` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_voided_by_user_id_users_id_fk` FOREIGN KEY (`voided_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `employment_periods_user_idx` ON `employment_periods` (`user_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `overtime_records_month_status_idx` ON `overtime_records` (`period_month`,`status`);--> statement-breakpoint
CREATE INDEX `overtime_records_user_month_idx` ON `overtime_records` (`user_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `payroll_adjustments_user_month_idx` ON `payroll_adjustments` (`user_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `payroll_adjustments_status_idx` ON `payroll_adjustments` (`status`);