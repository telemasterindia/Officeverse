CREATE TABLE `celebration_assets` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`category` varchar(24) NOT NULL,
	`kind` enum('video','effect') NOT NULL DEFAULT 'video',
	`label` varchar(80) NOT NULL,
	`storage_key` varchar(255),
	`mime` varchar(60),
	`size_bytes` int unsigned,
	`duration_ms` int unsigned,
	`effect` varchar(24),
	`enabled` boolean NOT NULL DEFAULT true,
	`builtin` boolean NOT NULL DEFAULT false,
	`uploaded_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime,
	CONSTRAINT `celebration_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `office_tv_announcements` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(120) NOT NULL,
	`subtitle` varchar(160),
	`message` varchar(600) NOT NULL,
	`audience` enum('all','agents','closers') NOT NULL DEFAULT 'all',
	`process` enum('US','UK','IN','AU'),
	`effect` varchar(24),
	`asset_id` int unsigned,
	`duration_ms` int unsigned NOT NULL DEFAULT 12000,
	`priority` enum('NORMAL','IMPORTANT','URGENT') NOT NULL DEFAULT 'NORMAL',
	`status` enum('scheduled','published','stopped','expired') NOT NULL DEFAULT 'scheduled',
	`publish_at` datetime,
	`expires_at` datetime,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime,
	`published_at` datetime,
	CONSTRAINT `office_tv_announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `office_tv_displays` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`token_hash` varchar(191) NOT NULL,
	`token_prefix` varchar(16) NOT NULL,
	`scope` varchar(40) NOT NULL DEFAULT 'tv_read',
	`enabled` boolean NOT NULL DEFAULT true,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`last_seen_at` datetime,
	`revoked_at` datetime,
	`rotated_at` datetime,
	CONSTRAINT `office_tv_displays_id` PRIMARY KEY(`id`),
	CONSTRAINT `office_tv_display_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `office_tv_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` varchar(32) NOT NULL,
	`subject_user_id` int unsigned,
	`tier` int unsigned NOT NULL DEFAULT 1,
	`effect` varchar(24),
	`asset_category` varchar(24),
	`message` varchar(200),
	`reference_type` varchar(40),
	`reference_id` varchar(64),
	`dedupe_key` varchar(191) NOT NULL,
	`operational_date` date NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `office_tv_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `office_tv_event_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `office_tv_settings` (
	`id` int unsigned NOT NULL DEFAULT 1,
	`display_name` varchar(80) NOT NULL DEFAULT 'Officeverse Live',
	`rotation_sec` int unsigned NOT NULL DEFAULT 12,
	`leaderboard_window` varchar(12) NOT NULL DEFAULT 'daily',
	`celebration_intensity` varchar(12) NOT NULL DEFAULT 'normal',
	`sound_enabled` boolean NOT NULL DEFAULT false,
	`third_accepted_threshold` int unsigned NOT NULL DEFAULT 3,
	`team_milestone_every` int unsigned NOT NULL DEFAULT 0,
	`updated_by_user_id` int unsigned,
	`updated_at` datetime,
	CONSTRAINT `office_tv_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `celebration_assets` ADD CONSTRAINT `celebration_assets_uploaded_by_user_id_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD CONSTRAINT `office_tv_announcements_asset_id_celebration_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `celebration_assets`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD CONSTRAINT `office_tv_announcements_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_tv_displays` ADD CONSTRAINT `office_tv_displays_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_tv_events` ADD CONSTRAINT `office_tv_events_subject_user_id_users_id_fk` FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_tv_settings` ADD CONSTRAINT `office_tv_settings_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `celebration_assets_category_idx` ON `celebration_assets` (`category`,`enabled`);--> statement-breakpoint
CREATE INDEX `office_tv_announcements_live_idx` ON `office_tv_announcements` (`status`,`enabled`);--> statement-breakpoint
CREATE INDEX `office_tv_events_feed_idx` ON `office_tv_events` (`operational_date`,`created_at`);