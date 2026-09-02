CREATE TABLE `shift_overrides` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL,
	`operational_date` date NOT NULL,
	`start_hhmm` varchar(5) NOT NULL,
	`end_hhmm` varchar(5) NOT NULL,
	`reporting_hhmm` varchar(5),
	`short_late_from_hhmm` varchar(5),
	`late_from_hhmm` varchar(5),
	`reason` varchar(255),
	`created_by_user_id` int unsigned,
	`updated_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `shift_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `shift_overrides_process_date_uq` UNIQUE(`process`,`operational_date`)
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `joining_date` date;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `monthly_base_salary` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `payable_base_salary` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `unpaid_leave_days` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `late_short_count` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `late_full_count` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `late_units` decimal(4,1) DEFAULT '0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `late_deduction` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `employee_code` varchar(32) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `joining_date` date;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_name` varchar(160) DEFAULT 'TMI Officeverse' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_legal_name` varchar(200);--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_address` varchar(400);--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_tax_id` varchar(40);--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_footer` varchar(400);--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_logo_mime` varchar(64);--> statement-breakpoint
ALTER TABLE `salary_slips` ADD `company_logo_data` mediumtext;--> statement-breakpoint
ALTER TABLE `shift_overrides` ADD CONSTRAINT `shift_overrides_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `shift_overrides` ADD CONSTRAINT `shift_overrides_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `shift_overrides_date_idx` ON `shift_overrides` (`operational_date`);