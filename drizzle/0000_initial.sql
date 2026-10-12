CREATE TABLE `activity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`item_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`end_time` text DEFAULT '' NOT NULL,
	`duration_min` integer DEFAULT 0 NOT NULL,
	`duration_max` integer DEFAULT 0 NOT NULL,
	`approximate` integer DEFAULT 0 NOT NULL,
	`completion` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_action` ON `activity_sessions` (`action_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_date` ON `activity_sessions` (`date`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_reviews` (
	`starred` integer DEFAULT 0 NOT NULL,
	`date` text PRIMARY KEY NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_slots` (
	`date` text NOT NULL,
	`time` text NOT NULL,
	`item_id` text,
	`item_title` text NOT NULL,
	`category_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`date`, `time`)
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`occurred_date` text,
	`occurred_time` text,
	`item_title` text,
	`category_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_history_created_at` ON `history` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_items_category_status` ON `items` (`category_id`,`status`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`estimated_minutes` integer,
	`mode` text DEFAULT '' NOT NULL,
	`work_type` text DEFAULT '' NOT NULL,
	`focused` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`title` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'item' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`did_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nodes_parent_status_position` ON `nodes` (`parent_id`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `idx_nodes_status_kind` ON `nodes` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `planning_cards` (
	`sub_tag` text DEFAULT '' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`promoted_node_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `planning_columns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_planning_cards_column_status_position` ON `planning_cards` (`column_id`,`status`,`position`);--> statement-breakpoint
CREATE TABLE `planning_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_planning_columns_status_position` ON `planning_columns` (`status`,`position`);--> statement-breakpoint
CREATE TABLE `voice_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`proposal` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_token` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `voice_captures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_voice_actions_capture` ON `voice_actions` (`capture_id`);--> statement-breakpoint
CREATE TABLE `voice_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`checksum` text NOT NULL,
	`filename` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`interpretation_model` text DEFAULT '' NOT NULL,
	`interpretation_version` integer DEFAULT 1 NOT NULL,
	`transcript` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`retryable` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_voice_owner_request` ON `voice_captures` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_voice_owner_checksum` ON `voice_captures` (`owner_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `idx_voice_owner_created` ON `voice_captures` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `voice_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`adopted_model` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `voice_captures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_comparisons_capture` ON `voice_comparisons` (`capture_id`);--> statement-breakpoint
CREATE TABLE `voice_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`total_chunks` integer NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_voice_uploads_owner_created` ON `voice_uploads` (`owner_id`,`created_at`);