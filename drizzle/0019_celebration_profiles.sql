CREATE TABLE `celebration_profiles` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(400),
	`enabled` boolean NOT NULL DEFAULT false,
	`recognition_level` enum('LEVEL_1','LEVEL_2','LEVEL_3','LEVEL_4') NOT NULL DEFAULT 'LEVEL_1',
	`trigger_event` enum('LEAD_SUBMITTED','LEAD_ACCEPTED','SALE','THIRD_ACCEPTED_LEAD','TEAM_MILESTONE','ACHIEVEMENT_UNLOCKED','MANUAL'),
	`priority` int NOT NULL DEFAULT 100,
	`config` json NOT NULL,
	`created_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `celebration_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `celebration_profiles` ADD CONSTRAINT `celebration_profiles_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `celebration_profiles_enabled_idx` ON `celebration_profiles` (`enabled`,`trigger_event`);