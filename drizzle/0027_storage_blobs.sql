CREATE TABLE `storage_blobs` (
	`storage_key` varchar(500) NOT NULL,
	`bytes` longblob NOT NULL,
	`mime` varchar(100),
	`size_bytes` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime,
	CONSTRAINT `storage_blobs_storage_key` PRIMARY KEY(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `staff_photos` MODIFY COLUMN `storage` enum('local','s3','r2','supabase','database','memory') NOT NULL DEFAULT 'local';