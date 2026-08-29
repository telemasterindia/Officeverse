ALTER TABLE `follow_up_attempts` MODIFY COLUMN `outcome` enum('SCHEDULED','RESCHEDULED','COMPLETED','CANCELLED','CONVERTED') NOT NULL;--> statement-breakpoint
ALTER TABLE `follow_up_attempts` ADD `related_lead_id` int unsigned;--> statement-breakpoint
ALTER TABLE `follow_up_attempts` ADD `related_lead_code` varchar(32);--> statement-breakpoint
ALTER TABLE `follow_up_attempts` ADD CONSTRAINT `follow_up_attempts_related_lead_id_leads_id_fk` FOREIGN KEY (`related_lead_id`) REFERENCES `leads`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `fu_attempts_related_lead_idx` ON `follow_up_attempts` (`related_lead_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_owner_status_idx` ON `follow_ups` (`owner_user_id`,`status`);