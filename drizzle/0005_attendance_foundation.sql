CREATE TABLE `attendance` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`role` enum('admin','agent','closer','hr') NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL,
	`shift_name` varchar(40) NOT NULL,
	`operational_date` date NOT NULL,
	`reporting_at` datetime NOT NULL,
	`shift_start_at` datetime NOT NULL,
	`shift_end_at` datetime NOT NULL,
	`first_check_in_at` datetime,
	`last_check_out_at` datetime,
	`total_minutes` int unsigned NOT NULL DEFAULT 0,
	`late_minutes` int unsigned NOT NULL DEFAULT 0,
	`early_departure_minutes` int unsigned NOT NULL DEFAULT 0,
	`check_in_status` enum('ON_TIME','SHORT','LATE','PENDING') NOT NULL DEFAULT 'PENDING',
	`check_out_status` enum('ON_TIME','SHORT','EARLY_DEPARTURE','PENDING') NOT NULL DEFAULT 'PENDING',
	`status` enum('ON_TIME','SHORT_ATTENDANCE','LATE','EARLY_DEPARTURE','PENDING','ABSENT') NOT NULL DEFAULT 'PENDING',
	`short_attendance` boolean NOT NULL DEFAULT false,
	`session_count` int unsigned NOT NULL DEFAULT 0,
	`source` enum('derived','corrected') NOT NULL DEFAULT 'derived',
	`corrected_by_user_id` int unsigned,
	`corrected_at` datetime,
	`correction_reason` varchar(500),
	`original_snapshot` json,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_user_day_uq` UNIQUE(`user_id`,`operational_date`)
);
--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_corrected_by_user_id_users_id_fk` FOREIGN KEY (`corrected_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `attendance_date_idx` ON `attendance` (`operational_date`);--> statement-breakpoint
CREATE INDEX `attendance_user_date_idx` ON `attendance` (`user_id`,`operational_date`);--> statement-breakpoint
CREATE INDEX `attendance_status_idx` ON `attendance` (`status`);--> statement-breakpoint
CREATE INDEX `attendance_process_idx` ON `attendance` (`process`);