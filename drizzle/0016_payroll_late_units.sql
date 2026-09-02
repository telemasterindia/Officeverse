ALTER TABLE `payroll_runs` ADD `late_short_count` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `late_full_count` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `late_units` decimal(4,1) DEFAULT '0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD `late_deduction` decimal(12,2) DEFAULT '0.00' NOT NULL;