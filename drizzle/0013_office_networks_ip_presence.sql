CREATE TABLE `office_networks` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`cidr` varchar(64) NOT NULL,
	`process` enum('US','UK','IN','AU'),
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(255),
	`created_by_user_id` int unsigned,
	`updated_by_user_id` int unsigned,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	`disabled_at` datetime,
	CONSTRAINT `office_networks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin_ip` varchar(45);--> statement-breakpoint
ALTER TABLE `sessions` ADD `office_network_id` int unsigned;--> statement-breakpoint
ALTER TABLE `sessions` ADD `attendance_eligible` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `office_networks` ADD CONSTRAINT `office_networks_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `office_networks` ADD CONSTRAINT `office_networks_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `office_networks_enabled_idx` ON `office_networks` (`enabled`);--> statement-breakpoint
CREATE INDEX `office_networks_process_idx` ON `office_networks` (`process`);