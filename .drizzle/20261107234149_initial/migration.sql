CREATE TABLE IF NOT EXISTS `article` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`heading` text,
	`subheading` text,
	`content` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `article_tag` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`article_id` blob NOT NULL,
	`tag_id` blob NOT NULL,
	CONSTRAINT `article_tag_article_id_fk` FOREIGN KEY (`article_id`) REFERENCES `article`(`id`),
	CONSTRAINT `article_tag_tag_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`),
	CONSTRAINT `article_tag_article_id_tag_id_unique` UNIQUE(`article_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `key` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`jwk` text,
	`user_id` blob,
	CONSTRAINT `key_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schema` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`table_name` text UNIQUE,
	`jsonschema` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tag` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`name` text,
	`kind` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`username` text UNIQUE,
	`email` text UNIQUE,
	`display_name` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_group` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`name` text UNIQUE,
	`description` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_group_membership` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`user_id` blob NOT NULL,
	`user_group_id` blob NOT NULL,
	CONSTRAINT `user_group_membership_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `user_group_membership_user_group_id_fk` FOREIGN KEY (`user_group_id`) REFERENCES `user_group`(`id`),
	CONSTRAINT `user_group_membership_user_id_user_group_id_unique` UNIQUE(`user_id`,`user_group_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_article_id_index` ON `article_tag` (`article_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_tag_id_index` ON `article_tag` (`tag_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `key_user_id_index` ON `key` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_user_id_index` ON `user_group_membership` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_user_group_id_index` ON `user_group_membership` (`user_group_id`);
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
DROP TRIGGER IF EXISTS `key_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `key_updated`
AFTER UPDATE ON `key`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `key`
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
--> statement-breakpoint
DROP VIEW IF EXISTS `article_view`;
--> statement-breakpoint
CREATE VIEW `article_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`heading` AS `heading`,
  `t`.`subheading` AS `subheading`,
  `t`.`content` AS `content`,
  (SELECT coalesce(json_group_array(json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'name', `r`.`name`, 'kind', `r`.`kind`)), json('[]')) FROM `tag` AS `r` JOIN `article_tag` AS `j` ON `j`.`tag_id` = `r`.`id` WHERE `j`.`article_id` = `t`.`id` ORDER BY `r`.`id`) AS `tag`
FROM `article` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `article_tag_view`;
--> statement-breakpoint
CREATE VIEW `article_tag_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (lower(hex(substr(`t`.`article_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`article_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 11, 6)))) AS `article_id`,
  (lower(hex(substr(`t`.`tag_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`tag_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 11, 6)))) AS `tag_id`,
  (SELECT json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'heading', `r`.`heading`, 'subheading', `r`.`subheading`, 'content', `r`.`content`) FROM `article` AS `r` WHERE `r`.`id` = `t`.`article_id` LIMIT 1) AS `article`,
  (SELECT json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'name', `r`.`name`, 'kind', `r`.`kind`) FROM `tag` AS `r` WHERE `r`.`id` = `t`.`tag_id` LIMIT 1) AS `tag`
FROM `article_tag` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `key_view`;
--> statement-breakpoint
CREATE VIEW `key_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`jwk` AS `jwk`,
  (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) AS `user_id`,
  (SELECT json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`
FROM `key` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `schema_view`;
--> statement-breakpoint
CREATE VIEW `schema_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`table_name` AS `table_name`,
  `t`.`jsonschema` AS `jsonschema`
FROM `schema` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `tag_view`;
--> statement-breakpoint
CREATE VIEW `tag_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`name` AS `name`,
  `t`.`kind` AS `kind`
FROM `tag` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_view`;
--> statement-breakpoint
CREATE VIEW `user_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`username` AS `username`,
  `t`.`email` AS `email`,
  `t`.`display_name` AS `display_name`,
  (SELECT coalesce(json_group_array(json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'name', `r`.`name`, 'description', `r`.`description`)), json('[]')) FROM `user_group` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_group_id` = `r`.`id` WHERE `j`.`user_id` = `t`.`id` ORDER BY `r`.`id`) AS `groups`,
  (SELECT coalesce(json_group_array(json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'jwk', json(`r`.`jwk`), 'user_id', (lower(hex(substr(`r`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`r`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`r`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`r`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`r`.`user_id`, 11, 6)))))), json('[]')) FROM `key` AS `r` WHERE `r`.`user_id` = `t`.`id` ORDER BY `r`.`id`) AS `keys`
FROM `user` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_view`;
--> statement-breakpoint
CREATE VIEW `user_group_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  `t`.`name` AS `name`,
  `t`.`description` AS `description`,
  (SELECT coalesce(json_group_array(json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`)), json('[]')) FROM `user` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_id` = `r`.`id` WHERE `j`.`user_group_id` = `t`.`id` ORDER BY `r`.`id`) AS `users`
FROM `user_group` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_membership_view`;
--> statement-breakpoint
CREATE VIEW `user_group_membership_view` AS
SELECT
  (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) AS `user_id`,
  (lower(hex(substr(`t`.`user_group_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_group_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 11, 6)))) AS `user_group_id`,
  (SELECT json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`,
  (SELECT json_object('id', (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))), 'updated_at', `r`.`updated_at`, 'name', `r`.`name`, 'description', `r`.`description`) FROM `user_group` AS `r` WHERE `r`.`id` = `t`.`user_group_id` LIMIT 1) AS `user_group`
FROM `user_group_membership` AS `t`;
