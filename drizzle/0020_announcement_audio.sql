ALTER TABLE `office_tv_announcements` ADD `tts_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD `tts_config` json;--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD `opening_sound` varchar(16);--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD `closing_sound` varchar(16);--> statement-breakpoint
ALTER TABLE `office_tv_announcements` ADD `celebration_profile_id` int unsigned;