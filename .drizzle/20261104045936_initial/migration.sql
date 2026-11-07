CREATE TABLE `article` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`heading` text,
	`subheading` text,
	`content` text
);
--> statement-breakpoint
CREATE TABLE `key` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`user_id` text,
	`key_data` text,
	`longevity` text,
	`purpose` text
);
--> statement-breakpoint
CREATE TABLE `schema` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`table_name` text,
	`jsonschema` blob
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`name` text,
	`kind` text
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`username` text,
	`email` text
);
--> statement-breakpoint
CREATE TABLE `user_group` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`username` text,
	`email` text
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tag_updated
AFTER UPDATE ON tag
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE tag
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS article_updated
AFTER UPDATE ON article
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE article
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS key_updated
AFTER UPDATE ON key
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE key
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS schema_updated
AFTER UPDATE ON schema
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE schema
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS user_updated
AFTER UPDATE ON user
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE user
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS user_group_updated
AFTER UPDATE ON user_group
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE user_group
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;