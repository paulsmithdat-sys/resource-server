CREATE TABLE IF NOT EXISTS `audit_log` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`actor` blob,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`resource_id` blob,
	`signature` text,
	CONSTRAINT `audit_log_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "audit_log_visibility_check" CHECK(`visibility` IN ('private'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_limit` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`key` text NOT NULL UNIQUE,
	`count` integer DEFAULT 0,
	`value` text,
	`expires_at` integer NOT NULL,
	CONSTRAINT `auth_limit_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `chat_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "chat_visibility_check" CHECK(`visibility` IN ('private', 'shared', 'authenticated', 'public'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_share` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`can_read` integer DEFAULT 1,
	`can_write` integer DEFAULT 0,
	`chat_id` blob NOT NULL,
	`user_id` blob,
	`user_group_id` blob,
	CONSTRAINT `chat_share_chat_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE,
	CONSTRAINT `chat_share_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `chat_share_user_group_id_fk` FOREIGN KEY (`user_group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `chat_share_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `chat_share_chat_id_user_id_unique` UNIQUE(`chat_id`,`user_id`),
	CONSTRAINT `chat_share_chat_id_user_group_id_unique` UNIQUE(`chat_id`,`user_group_id`),
	CONSTRAINT "chat_share_visibility_check" CHECK(`visibility` IN ('private')),
	CONSTRAINT "chat_share_check_0" CHECK((`user_id` IS NULL) <> (`user_group_id` IS NULL)),
	CONSTRAINT "chat_share_check_1" CHECK(`can_read` OR `can_write`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`text` text NOT NULL,
	`chat_id` blob NOT NULL,
	CONSTRAINT `message_chat_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON DELETE CASCADE,
	CONSTRAINT `message_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "message_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_role` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`role` text NOT NULL,
	`user_id` blob NOT NULL,
	CONSTRAINT `user_role_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `user_role_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `user_role_user_id_role_unique` UNIQUE(`user_id`,`role`),
	CONSTRAINT "user_role_visibility_check" CHECK(`visibility` IN ('private'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_log_owner_index` ON `audit_log` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_limit_owner_index` ON `auth_limit` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_owner_index` ON `chat` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_share_chat_id_index` ON `chat_share` (`chat_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_share_user_id_index` ON `chat_share` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_share_user_group_id_index` ON `chat_share` (`user_group_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_share_owner_index` ON `chat_share` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_chat_id_index` ON `message` (`chat_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_owner_index` ON `message` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_role_user_id_index` ON `user_role` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_role_owner_index` ON `user_role` (`owner`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `audit_log_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `audit_log_updated`
AFTER UPDATE ON `audit_log`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `audit_log`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `auth_limit_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `auth_limit_updated`
AFTER UPDATE ON `auth_limit`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `auth_limit`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chat_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `chat_updated`
AFTER UPDATE ON `chat`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `chat`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chat_share_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `chat_share_updated`
AFTER UPDATE ON `chat_share`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `chat_share`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `message_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `message_updated`
AFTER UPDATE ON `message`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `message`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `user_role_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_role_updated`
AFTER UPDATE ON `user_role`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `user_role`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP VIEW IF EXISTS `audit_log_view`;
--> statement-breakpoint
CREATE VIEW `audit_log_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  (CASE WHEN `t`.`actor` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`actor`, 1, 4))) || '-' || lower(hex(substr(`t`.`actor`, 5, 2))) || '-' || lower(hex(substr(`t`.`actor`, 7, 2))) || '-' || lower(hex(substr(`t`.`actor`, 9, 2))) || '-' || lower(hex(substr(`t`.`actor`, 11, 6)))) END) AS `actor`,
  `t`.`action` AS `action`,
  `t`.`resource` AS `resource`,
  (CASE WHEN `t`.`resource_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`resource_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`resource_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`resource_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`resource_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`resource_id`, 11, 6)))) END) AS `resource_id`,
  `t`.`signature` AS `signature`
FROM `audit_log` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `chat_view`;
--> statement-breakpoint
CREATE VIEW `chat_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`name` AS `name`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'text', `r`.`text`, 'chat_id', (CASE WHEN `r`.`chat_id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`chat_id`, 1, 4))) || '-' || lower(hex(substr(`r`.`chat_id`, 5, 2))) || '-' || lower(hex(substr(`r`.`chat_id`, 7, 2))) || '-' || lower(hex(substr(`r`.`chat_id`, 9, 2))) || '-' || lower(hex(substr(`r`.`chat_id`, 11, 6)))) END))), json('[]')) FROM `message` AS `r` WHERE `r`.`chat_id` = `t`.`id` ORDER BY `r`.`id`) AS `messages`
FROM `chat` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `chat_share_view`;
--> statement-breakpoint
CREATE VIEW `chat_share_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`can_read` AS `can_read`,
  `t`.`can_write` AS `can_write`,
  (CASE WHEN `t`.`chat_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`chat_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`chat_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 11, 6)))) END) AS `chat_id`,
  (CASE WHEN `t`.`user_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) END) AS `user_id`,
  (CASE WHEN `t`.`user_group_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_group_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_group_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 11, 6)))) END) AS `user_group_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`) FROM `chat` AS `r` WHERE `r`.`id` = `t`.`chat_id` LIMIT 1) AS `chat`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'description', `r`.`description`) FROM `user_group` AS `r` WHERE `r`.`id` = `t`.`user_group_id` LIMIT 1) AS `user_group`
FROM `chat_share` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `message_view`;
--> statement-breakpoint
CREATE VIEW `message_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`text` AS `text`,
  (CASE WHEN `t`.`chat_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`chat_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`chat_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`chat_id`, 11, 6)))) END) AS `chat_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`) FROM `chat` AS `r` WHERE `r`.`id` = `t`.`chat_id` LIMIT 1) AS `chat`
FROM `message` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_role_view`;
--> statement-breakpoint
CREATE VIEW `user_role_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`role` AS `role`,
  (CASE WHEN `t`.`user_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) END) AS `user_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`
FROM `user_role` AS `t`;
