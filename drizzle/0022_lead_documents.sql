CREATE TABLE `lead_documents` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`lead_id` int unsigned NOT NULL,
	`file_name` varchar(160) NOT NULL,
	`mime` enum('application/pdf','image/png','image/jpeg','image/webp') NOT NULL,
	`size_bytes` int unsigned NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`uploaded_by_user_id` int unsigned,
	`uploaded_by_role` varchar(16),
	`created_at` datetime NOT NULL,
	CONSTRAINT `lead_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `lead_documents` ADD CONSTRAINT `lead_documents_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lead_documents` ADD CONSTRAINT `lead_documents_uploaded_by_user_id_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `lead_documents_lead_idx` ON `lead_documents` (`lead_id`);