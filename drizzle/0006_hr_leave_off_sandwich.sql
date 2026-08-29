CREATE TABLE `holidays` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`holiday_date` date NOT NULL,
	`name` varchar(120) NOT NULL,
	`holiday_type` enum('US_FEDERAL','INDIAN','COMPANY','WEEKLY_OFF') NOT NULL,
	`applies_to_process` enum('US','UK','IN','AU'),
	`observed` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL,
	CONSTRAINT `holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `holidays_day_type_uq` UNIQUE(`holiday_date`,`holiday_type`,`applies_to_process`)
);
--> statement-breakpoint
CREATE TABLE `leave_days` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`leave_request_id` bigint unsigned NOT NULL,
	`user_id` int unsigned NOT NULL,
	`leave_date` date NOT NULL,
	`day_type` enum('ORIGINAL','SANDWICH_WEEKEND','SANDWICH_HOLIDAY') NOT NULL,
	`non_working_reason` varchar(60),
	`calculated_at` datetime NOT NULL,
	`rule_version` varchar(16) NOT NULL DEFAULT 'v1',
	`created_at` datetime NOT NULL,
	CONSTRAINT `leave_days_id` PRIMARY KEY(`id`),
	CONSTRAINT `leave_days_req_day_uq` UNIQUE(`leave_request_id`,`leave_date`)
);
--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`leave_type` varchar(40) NOT NULL DEFAULT 'general',
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`status` enum('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`reason` varchar(500),
	`created_by_user_id` int unsigned NOT NULL,
	`approved_by_user_id` int unsigned,
	`approved_at` datetime,
	`decision_note` varchar(500),
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `leave_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`off_type` enum('LATE_CONVERSION','SHORT_ATTENDANCE_CONVERSION','WEEKLY_OFF','OTHER_COMPANY_OFF') NOT NULL,
	`period_month` varchar(7) NOT NULL,
	`off_index` int unsigned NOT NULL,
	`source_count` int unsigned NOT NULL,
	`source_description` varchar(200) NOT NULL,
	`status` enum('ACTIVE','VOID') NOT NULL DEFAULT 'ACTIVE',
	`calculated_at` datetime NOT NULL,
	`rule_version` varchar(16) NOT NULL DEFAULT 'v1',
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `off_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `off_records_idem_uq` UNIQUE(`user_id`,`off_type`,`period_month`,`off_index`)
);
--> statement-breakpoint
ALTER TABLE `leave_days` ADD CONSTRAINT `leave_days_leave_request_id_leave_requests_id_fk` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_days` ADD CONSTRAINT `leave_days_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_approved_by_user_id_users_id_fk` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `off_records` ADD CONSTRAINT `off_records_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `holidays_date_idx` ON `holidays` (`holiday_date`);--> statement-breakpoint
CREATE INDEX `leave_days_user_date_idx` ON `leave_days` (`user_id`,`leave_date`);--> statement-breakpoint
CREATE INDEX `leave_days_req_idx` ON `leave_days` (`leave_request_id`);--> statement-breakpoint
CREATE INDEX `leave_requests_user_idx` ON `leave_requests` (`user_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `leave_requests_status_idx` ON `leave_requests` (`status`);--> statement-breakpoint
CREATE INDEX `leave_requests_start_idx` ON `leave_requests` (`start_date`);--> statement-breakpoint
CREATE INDEX `off_records_user_month_idx` ON `off_records` (`user_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `off_records_type_idx` ON `off_records` (`off_type`);