PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_user` (
	`id` blob PRIMARY KEY DEFAULT (uuid7()),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`owner` blob,
	`visibility` text DEFAULT 'private' NOT NULL,
	`username` text UNIQUE,
	`email` text,
	`display_name` text,
	CONSTRAINT `user_owner_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "user_visibility_check" CHECK(`visibility` IN ('private', 'authenticated', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `updated_at`, `owner`, `visibility`, `username`, `email`, `display_name`) SELECT `id`, `updated_at`, `owner`, `visibility`, `username`, `email`, `display_name` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_owner_index` ON `user` (`owner`);
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
