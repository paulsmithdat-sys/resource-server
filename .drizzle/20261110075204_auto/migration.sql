CREATE TABLE IF NOT EXISTS `feedback` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`message` text NOT NULL,
	CONSTRAINT `feedback_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "feedback_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	CONSTRAINT `note_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "note_visibility_check" CHECK(`visibility` IN ('private', 'shared', 'authenticated', 'public'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_share` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`can_read` integer DEFAULT 1,
	`can_write` integer DEFAULT 0,
	`note_id` blob NOT NULL,
	`user_id` blob,
	`user_group_id` blob,
	CONSTRAINT `note_share_note_id_fk` FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON DELETE CASCADE,
	CONSTRAINT `note_share_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `note_share_user_group_id_fk` FOREIGN KEY (`user_group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `note_share_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `note_share_note_id_user_id_unique` UNIQUE(`note_id`,`user_id`),
	CONSTRAINT `note_share_note_id_user_group_id_unique` UNIQUE(`note_id`,`user_group_id`),
	CONSTRAINT "note_share_visibility_check" CHECK(`visibility` IN ('private')),
	CONSTRAINT "note_share_check_0" CHECK((`user_id` IS NULL) <> (`user_group_id` IS NULL)),
	CONSTRAINT "note_share_check_1" CHECK(`can_read` OR `can_write`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payment` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	CONSTRAINT `payment_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "payment_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `request_nonce` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`session_id` blob NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `request_nonce_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `request_nonce_session_id_nonce_unique` UNIQUE(`session_id`,`nonce`)
);
--> statement-breakpoint
ALTER TABLE `article` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `article_tag` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `schema` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `tag` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_group` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_group_membership` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_article` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`heading` text,
	`subheading` text,
	`content` text,
	CONSTRAINT `article_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "article_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_article`(`id`, `updated_at`, `owner`, `heading`, `subheading`, `content`) SELECT `id`, `updated_at`, `owner`, `heading`, `subheading`, `content` FROM `article`;--> statement-breakpoint
DROP TABLE `article`;--> statement-breakpoint
ALTER TABLE `__new_article` RENAME TO `article`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_article_tag` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`article_id` blob NOT NULL,
	`tag_id` blob NOT NULL,
	CONSTRAINT `article_tag_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `article`(`id`),
	CONSTRAINT `article_tag_tag_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`),
	CONSTRAINT `article_tag_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `article_tag_article_id_tag_id_unique` UNIQUE(`article_id`,`tag_id`),
	CONSTRAINT "article_tag_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_article_tag`(`id`, `updated_at`, `owner`, `article_id`, `tag_id`) SELECT `id`, `updated_at`, `owner`, `article_id`, `tag_id` FROM `article_tag`;--> statement-breakpoint
DROP TABLE `article_tag`;--> statement-breakpoint
ALTER TABLE `__new_article_tag` RENAME TO `article_tag`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_schema` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`table_name` text UNIQUE,
	`jsonschema` text,
	CONSTRAINT `schema_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "schema_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_schema`(`id`, `updated_at`, `owner`, `table_name`, `jsonschema`) SELECT `id`, `updated_at`, `owner`, `table_name`, `jsonschema` FROM `schema`;--> statement-breakpoint
DROP TABLE `schema`;--> statement-breakpoint
ALTER TABLE `__new_schema` RENAME TO `schema`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_tag` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text,
	`kind` text,
	CONSTRAINT `tag_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "tag_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_tag`(`id`, `updated_at`, `owner`, `name`, `kind`) SELECT `id`, `updated_at`, `owner`, `name`, `kind` FROM `tag`;--> statement-breakpoint
DROP TABLE `tag`;--> statement-breakpoint
ALTER TABLE `__new_tag` RENAME TO `tag`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_user` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`username` text UNIQUE,
	`email` text UNIQUE,
	`display_name` text,
	CONSTRAINT `user_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "user_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `updated_at`, `owner`, `username`, `email`, `display_name`) SELECT `id`, `updated_at`, `owner`, `username`, `email`, `display_name` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_user_group` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`name` text UNIQUE,
	`description` text,
	CONSTRAINT `user_group_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "user_group_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_user_group`(`id`, `updated_at`, `owner`, `name`, `description`) SELECT `id`, `updated_at`, `owner`, `name`, `description` FROM `user_group`;--> statement-breakpoint
DROP TABLE `user_group`;--> statement-breakpoint
ALTER TABLE `__new_user_group` RENAME TO `user_group`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_user_group_membership` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`user_id` blob NOT NULL,
	`user_group_id` blob NOT NULL,
	CONSTRAINT `user_group_membership_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `user_group_membership_user_group_id_fk` FOREIGN KEY (`user_group_id`) REFERENCES `user_group`(`id`),
	CONSTRAINT `user_group_membership_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `user_group_membership_user_id_user_group_id_unique` UNIQUE(`user_id`,`user_group_id`),
	CONSTRAINT "user_group_membership_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_user_group_membership`(`id`, `updated_at`, `owner`, `user_id`, `user_group_id`) SELECT `id`, `updated_at`, `owner`, `user_id`, `user_group_id` FROM `user_group_membership`;--> statement-breakpoint
DROP TABLE `user_group_membership`;--> statement-breakpoint
ALTER TABLE `__new_user_group_membership` RENAME TO `user_group_membership`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_owner_index` ON `article` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_article_id_index` ON `article_tag` (`article_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_tag_id_index` ON `article_tag` (`tag_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_owner_index` ON `article_tag` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schema_owner_index` ON `schema` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tag_owner_index` ON `tag` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_owner_index` ON `user` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_owner_index` ON `user_group` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_user_id_index` ON `user_group_membership` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_user_group_id_index` ON `user_group_membership` (`user_group_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_owner_index` ON `user_group_membership` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_owner_index` ON `feedback` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `note_owner_index` ON `note` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `note_share_note_id_index` ON `note_share` (`note_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `note_share_user_id_index` ON `note_share` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `note_share_user_group_id_index` ON `note_share` (`user_group_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `note_share_owner_index` ON `note_share` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payment_owner_index` ON `payment` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `request_nonce_owner_index` ON `request_nonce` (`owner`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `feedback_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `feedback_updated`
AFTER UPDATE ON `feedback`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `feedback`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `note_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `note_updated`
AFTER UPDATE ON `note`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `note`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `note_share_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `note_share_updated`
AFTER UPDATE ON `note_share`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `note_share`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `payment_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `payment_updated`
AFTER UPDATE ON `payment`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `payment`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `request_nonce_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `request_nonce_updated`
AFTER UPDATE ON `request_nonce`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `request_nonce`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP VIEW IF EXISTS `article_view`;
--> statement-breakpoint
CREATE VIEW `article_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`heading` AS `heading`,
  `t`.`subheading` AS `subheading`,
  `t`.`content` AS `content`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'kind', `r`.`kind`)), json('[]')) FROM `tag` AS `r` JOIN `article_tag` AS `j` ON `j`.`tag_id` = `r`.`id` WHERE `j`.`article_id` = `t`.`id` ORDER BY `r`.`id`) AS `tag`
FROM `article` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `article_tag_view`;
--> statement-breakpoint
CREATE VIEW `article_tag_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  (CASE WHEN `t`.`article_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`article_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`article_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 11, 6)))) END) AS `article_id`,
  (CASE WHEN `t`.`tag_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`tag_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`tag_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 11, 6)))) END) AS `tag_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'heading', `r`.`heading`, 'subheading', `r`.`subheading`, 'content', `r`.`content`) FROM `article` AS `r` WHERE `r`.`id` = `t`.`article_id` LIMIT 1) AS `article`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'kind', `r`.`kind`) FROM `tag` AS `r` WHERE `r`.`id` = `t`.`tag_id` LIMIT 1) AS `tag`
FROM `article_tag` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `feedback_view`;
--> statement-breakpoint
CREATE VIEW `feedback_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`message` AS `message`
FROM `feedback` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `note_view`;
--> statement-breakpoint
CREATE VIEW `note_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`title` AS `title`,
  `t`.`body` AS `body`
FROM `note` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `note_share_view`;
--> statement-breakpoint
CREATE VIEW `note_share_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`can_read` AS `can_read`,
  `t`.`can_write` AS `can_write`,
  (CASE WHEN `t`.`note_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`note_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`note_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`note_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`note_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`note_id`, 11, 6)))) END) AS `note_id`,
  (CASE WHEN `t`.`user_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) END) AS `user_id`,
  (CASE WHEN `t`.`user_group_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_group_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_group_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 11, 6)))) END) AS `user_group_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'title', `r`.`title`, 'body', `r`.`body`) FROM `note` AS `r` WHERE `r`.`id` = `t`.`note_id` LIMIT 1) AS `note`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'description', `r`.`description`) FROM `user_group` AS `r` WHERE `r`.`id` = `t`.`user_group_id` LIMIT 1) AS `user_group`
FROM `note_share` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `payment_view`;
--> statement-breakpoint
CREATE VIEW `payment_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`amount` AS `amount`,
  `t`.`currency` AS `currency`
FROM `payment` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `schema_view`;
--> statement-breakpoint
CREATE VIEW `schema_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`table_name` AS `table_name`,
  `t`.`jsonschema` AS `jsonschema`
FROM `schema` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `tag_view`;
--> statement-breakpoint
CREATE VIEW `tag_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`name` AS `name`,
  `t`.`kind` AS `kind`
FROM `tag` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_view`;
--> statement-breakpoint
CREATE VIEW `user_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`username` AS `username`,
  `t`.`email` AS `email`,
  `t`.`display_name` AS `display_name`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'description', `r`.`description`)), json('[]')) FROM `user_group` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_group_id` = `r`.`id` WHERE `j`.`user_id` = `t`.`id` ORDER BY `r`.`id`) AS `groups`
FROM `user` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_view`;
--> statement-breakpoint
CREATE VIEW `user_group_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  `t`.`name` AS `name`,
  `t`.`description` AS `description`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`)), json('[]')) FROM `user` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_id` = `r`.`id` WHERE `j`.`user_group_id` = `t`.`id` ORDER BY `r`.`id`) AS `users`
FROM `user_group` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_membership_view`;
--> statement-breakpoint
CREATE VIEW `user_group_membership_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`visibility` AS `visibility`,
  (CASE WHEN `t`.`user_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) END) AS `user_id`,
  (CASE WHEN `t`.`user_group_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_group_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_group_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 11, 6)))) END) AS `user_group_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'visibility', `r`.`visibility`, 'name', `r`.`name`, 'description', `r`.`description`) FROM `user_group` AS `r` WHERE `r`.`id` = `t`.`user_group_id` LIMIT 1) AS `user_group`
FROM `user_group_membership` AS `t`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `article_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `article_updated`
AFTER UPDATE ON `article`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `article`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `article_tag_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `article_tag_updated`
AFTER UPDATE ON `article_tag`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `article_tag`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `schema_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `schema_updated`
AFTER UPDATE ON `schema`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `schema`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `tag_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tag_updated`
AFTER UPDATE ON `tag`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `tag`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `user_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_updated`
AFTER UPDATE ON `user`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `user`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `user_group_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_group_updated`
AFTER UPDATE ON `user_group`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `user_group`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `user_group_membership_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_group_membership_updated`
AFTER UPDATE ON `user_group_membership`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `user_group_membership`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
