CREATE TABLE `agents` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`agent_code` varchar(24) NOT NULL,
	`dob` date,
	`monthly_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
	`registered_on` date NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `agents_user_uq` UNIQUE(`user_id`),
	CONSTRAINT `agents_code_uq` UNIQUE(`agent_code`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_user_id` int unsigned,
	`actor_role` enum('admin','agent','closer','hr','system'),
	`action` varchar(80) NOT NULL,
	`entity_type` varchar(40),
	`entity_id` int unsigned,
	`entity_code` varchar(32),
	`metadata` json,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`created_at` datetime NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`client_code` varchar(24) NOT NULL,
	`name` varchar(200) NOT NULL,
	`contact_name` varchar(200),
	`email` varchar(191),
	`phone` varchar(40),
	`address` varchar(500),
	`status` enum('active','prospect','inactive','closed') NOT NULL DEFAULT 'prospect',
	`registered_on` date NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_code_uq` UNIQUE(`client_code`)
);
--> statement-breakpoint
CREATE TABLE `closers` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`closer_code` varchar(24) NOT NULL,
	`dob` date,
	`registered_on` date NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `closers_id` PRIMARY KEY(`id`),
	CONSTRAINT `closers_user_uq` UNIQUE(`user_id`),
	CONSTRAINT `closers_code_uq` UNIQUE(`closer_code`)
);
--> statement-breakpoint
CREATE TABLE `email_jobs` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('closer-followup','shift-summary') NOT NULL,
	`to_email` varchar(191) NOT NULL,
	`to_name` varchar(200),
	`to_user_id` int unsigned,
	`subject` varchar(500) NOT NULL,
	`body_text` mediumtext NOT NULL,
	`body_html` mediumtext,
	`related_entity_type` varchar(40),
	`related_entity_id` int unsigned,
	`dedupe_key` varchar(191) NOT NULL,
	`status` enum('queued','processing','sent','failed') NOT NULL DEFAULT 'queued',
	`retry_count` int unsigned NOT NULL DEFAULT 0,
	`max_retries` int unsigned NOT NULL DEFAULT 5,
	`next_attempt_at` datetime NOT NULL,
	`scheduled_for` datetime,
	`provider` varchar(40),
	`provider_message_id` varchar(255),
	`error_message` varchar(1000),
	`locked_at` datetime,
	`locked_by` varchar(80),
	`sent_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `email_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_jobs_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `follow_up_attempts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`follow_up_id` int unsigned NOT NULL,
	`attempt_no` int unsigned NOT NULL,
	`scheduled_at` datetime NOT NULL,
	`outcome` enum('RESCHEDULED','COMPLETED','CANCELLED') NOT NULL,
	`note` text,
	`recorded_at` datetime NOT NULL,
	`recorded_by_user_id` int unsigned,
	CONSTRAINT `follow_up_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `fu_attempts_no_uq` UNIQUE(`follow_up_id`,`attempt_no`)
);
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`follow_up_code` varchar(32) NOT NULL,
	`owner_user_id` int unsigned NOT NULL,
	`owner_role` enum('agent','closer') NOT NULL,
	`customer_name` varchar(200) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`phone_normalized` varchar(24),
	`email` varchar(191),
	`email_normalized` varchar(191),
	`address` varchar(500),
	`city` varchar(120),
	`state` varchar(120),
	`zip` varchar(20),
	`debt_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`credit_status` varchar(60),
	`current_debts` enum('Current','Late'),
	`capture_date` date NOT NULL,
	`scheduled_at` datetime NOT NULL,
	`scheduled_tz` varchar(10) NOT NULL DEFAULT '+05:30',
	`comment` text,
	`status` enum('SCHEDULED','COMPLETED','CANCELLED','CONVERTED') NOT NULL DEFAULT 'SCHEDULED',
	`lead_id` int unsigned,
	`converted_lead_code` varchar(32),
	`converted_at` datetime,
	`completed_at` datetime,
	`cancelled_at` datetime,
	`created_by_user_id` int unsigned NOT NULL,
	`source` enum('app','import') NOT NULL DEFAULT 'app',
	`import_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`),
	CONSTRAINT `follow_ups_code_uq` UNIQUE(`follow_up_code`)
);
--> statement-breakpoint
CREATE TABLE `import_errors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`import_id` int unsigned NOT NULL,
	`row_number` int unsigned NOT NULL,
	`field` varchar(80),
	`value` varchar(500),
	`code` varchar(60) NOT NULL,
	`message` varchar(500) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `import_errors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`import_id` int unsigned NOT NULL,
	`row_number` int unsigned NOT NULL,
	`raw` json NOT NULL,
	`parsed` json,
	`decision` enum('pending','new','update','skip','duplicate','error') NOT NULL DEFAULT 'pending',
	`target_entity_type` enum('lead','follow_up'),
	`target_entity_id` int unsigned,
	`target_entity_code` varchar(32),
	`committed` boolean NOT NULL DEFAULT false,
	CONSTRAINT `import_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_rows_row_uq` UNIQUE(`import_id`,`row_number`)
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`stored_path` varchar(500),
	`type` enum('leads','follow_ups','workbook') NOT NULL,
	`uploaded_by_user_id` int unsigned NOT NULL,
	`status` enum('uploaded','mapping','validating','validated','committing','committed','failed','rolled_back') NOT NULL DEFAULT 'uploaded',
	`sheet_name` varchar(120),
	`column_mapping` json,
	`total_rows` int unsigned NOT NULL DEFAULT 0,
	`valid_rows` int unsigned NOT NULL DEFAULT 0,
	`invalid_rows` int unsigned NOT NULL DEFAULT 0,
	`new_rows` int unsigned NOT NULL DEFAULT 0,
	`update_rows` int unsigned NOT NULL DEFAULT 0,
	`duplicate_rows` int unsigned NOT NULL DEFAULT 0,
	`skipped_rows` int unsigned NOT NULL DEFAULT 0,
	`error_rows` int unsigned NOT NULL DEFAULT 0,
	`success_count` int unsigned NOT NULL DEFAULT 0,
	`error_count` int unsigned NOT NULL DEFAULT 0,
	`committed_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`lead_code` varchar(32) NOT NULL,
	`shift_date` date NOT NULL,
	`customer_name` varchar(200) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`phone_normalized` varchar(24),
	`email` varchar(191),
	`email_normalized` varchar(191),
	`address` varchar(500),
	`city` varchar(120),
	`state` varchar(120),
	`zip` varchar(20),
	`debt_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`credit_status` varchar(60),
	`current_debts` enum('Current','Late') NOT NULL DEFAULT 'Current',
	`lead_file` varchar(200),
	`comments` text,
	`agent_id` int unsigned NOT NULL,
	`assigned_closer_id` int unsigned,
	`status` enum('NEW','ASSIGNED','ACCEPTED','REJECTED','FOLLOW-UP','COMPLETED') NOT NULL DEFAULT 'NEW',
	`converted_from_follow_up_id` int unsigned,
	`source` enum('app','import','conversion') NOT NULL DEFAULT 'app',
	`import_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `leads_code_uq` UNIQUE(`lead_code`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`recipient_user_id` int unsigned NOT NULL,
	`type` varchar(60) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` varchar(1000) NOT NULL,
	`related_entity_type` varchar(40),
	`related_entity_id` int unsigned,
	`related_entity_code` varchar(32),
	`read_at` datetime,
	`dedupe_key` varchar(191),
	`created_at` datetime NOT NULL,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `schema_meta` (
	`id` int unsigned NOT NULL DEFAULT 1,
	`data_mode` enum('empty','production','demo') NOT NULL DEFAULT 'empty',
	`seeded_at` datetime,
	`app_version` varchar(40),
	`note` varchar(255),
	CONSTRAINT `schema_meta_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`revoked_at` datetime,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_photos` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`storage` enum('local','s3','r2','supabase') NOT NULL DEFAULT 'local',
	`path` varchar(500) NOT NULL,
	`url` varchar(1000),
	`mime` varchar(100),
	`bytes` int unsigned,
	`width` int unsigned,
	`height` int unsigned,
	`uploaded_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	CONSTRAINT `staff_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(200) NOT NULL,
	`role` enum('admin','agent','closer','hr') NOT NULL,
	`process` enum('US','UK','IN','AU') NOT NULL DEFAULT 'US',
	`status` enum('active','inactive','suspended','on_leave') NOT NULL DEFAULT 'active',
	`phone` varchar(40),
	`photo_asset_id` int unsigned,
	`must_change_password` boolean NOT NULL DEFAULT false,
	`last_login_at` datetime,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `agents` ADD CONSTRAINT `agents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `closers` ADD CONSTRAINT `closers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `email_jobs` ADD CONSTRAINT `email_jobs_to_user_id_users_id_fk` FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_up_attempts` ADD CONSTRAINT `follow_up_attempts_follow_up_id_follow_ups_id_fk` FOREIGN KEY (`follow_up_id`) REFERENCES `follow_ups`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_up_attempts` ADD CONSTRAINT `follow_up_attempts_recorded_by_user_id_users_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_import_id_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `import_errors` ADD CONSTRAINT `import_errors_import_id_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_import_id_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `imports` ADD CONSTRAINT `imports_uploaded_by_user_id_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_assigned_closer_id_closers_id_fk` FOREIGN KEY (`assigned_closer_id`) REFERENCES `closers`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_converted_from_follow_up_id_follow_ups_id_fk` FOREIGN KEY (`converted_from_follow_up_id`) REFERENCES `follow_ups`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_import_id_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_user_id_users_id_fk` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `staff_photos` ADD CONSTRAINT `staff_photos_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `staff_photos` ADD CONSTRAINT `staff_photos_uploaded_by_user_id_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `clients_status_idx` ON `clients` (`status`);--> statement-breakpoint
CREATE INDEX `email_jobs_drain_idx` ON `email_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `fu_attempts_fu_idx` ON `follow_up_attempts` (`follow_up_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_owner_idx` ON `follow_ups` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_status_idx` ON `follow_ups` (`status`);--> statement-breakpoint
CREATE INDEX `follow_ups_due_scan_idx` ON `follow_ups` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `follow_ups_lead_idx` ON `follow_ups` (`lead_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_phone_idx` ON `follow_ups` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `import_errors_import_idx` ON `import_errors` (`import_id`);--> statement-breakpoint
CREATE INDEX `import_errors_row_idx` ON `import_errors` (`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `import_rows_import_idx` ON `import_rows` (`import_id`);--> statement-breakpoint
CREATE INDEX `import_rows_decision_idx` ON `import_rows` (`import_id`,`decision`);--> statement-breakpoint
CREATE INDEX `imports_by_user_idx` ON `imports` (`uploaded_by_user_id`);--> statement-breakpoint
CREATE INDEX `imports_status_idx` ON `imports` (`status`);--> statement-breakpoint
CREATE INDEX `leads_agent_idx` ON `leads` (`agent_id`);--> statement-breakpoint
CREATE INDEX `leads_closer_idx` ON `leads` (`assigned_closer_id`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_shift_date_idx` ON `leads` (`shift_date`);--> statement-breakpoint
CREATE INDEX `leads_phone_idx` ON `leads` (`phone_normalized`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_user_id`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`recipient_user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `staff_photos_user_idx` ON `staff_photos` (`user_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);