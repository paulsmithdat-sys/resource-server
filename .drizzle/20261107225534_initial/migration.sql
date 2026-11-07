CREATE TABLE IF NOT EXISTS `article` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`heading` text,
	`subheading` text,
	`content` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `group` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`name` text UNIQUE,
	`description` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `key` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`jwk` text
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
DROP TRIGGER IF EXISTS `group_updated`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `group_updated`
AFTER UPDATE ON `group`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE `group`
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
