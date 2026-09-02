CREATE TABLE `company_profile` (
	`id` int unsigned NOT NULL DEFAULT 1,
	`company_name` varchar(160) NOT NULL DEFAULT 'TMI Officeverse',
	`legal_name` varchar(200),
	`logo_mime` varchar(64),
	`logo_data` mediumtext,
	`logo_updated_at` datetime,
	`address_line` varchar(400),
	`tax_id` varchar(40),
	`contact_email` varchar(191),
	`contact_phone` varchar(40),
	`document_footer` varchar(400),
	`updated_by_user_id` int unsigned,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `company_profile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `company_profile` ADD CONSTRAINT `company_profile_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;