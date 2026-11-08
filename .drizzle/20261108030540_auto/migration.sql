ALTER TABLE `article` ADD `owner` blob CONSTRAINT `article_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `article_tag` ADD `owner` blob CONSTRAINT `article_tag_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `key` ADD `owner` blob CONSTRAINT `key_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `key` ADD `type` text DEFAULT 'jwk';--> statement-breakpoint
ALTER TABLE `key` ADD `client_jwk` text;--> statement-breakpoint
ALTER TABLE `key` ADD `material` text;--> statement-breakpoint
ALTER TABLE `key` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `key` ADD `consumed_at` integer;--> statement-breakpoint
ALTER TABLE `schema` ADD `owner` blob CONSTRAINT `schema_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tag` ADD `owner` blob CONSTRAINT `tag_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `owner` blob CONSTRAINT `user_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `user_group` ADD `owner` blob CONSTRAINT `user_group_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `user_group_membership` ADD `owner` blob CONSTRAINT `user_group_membership_owner_fk` REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_owner_index` ON `article` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_tag_owner_index` ON `article_tag` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `key_owner_index` ON `key` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schema_owner_index` ON `schema` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tag_owner_index` ON `tag` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_owner_index` ON `user` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_owner_index` ON `user_group` (`owner`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_group_membership_owner_index` ON `user_group_membership` (`owner`);
--> statement-breakpoint
DROP VIEW IF EXISTS `article_view`;
--> statement-breakpoint
CREATE VIEW `article_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`heading` AS `heading`,
  `t`.`subheading` AS `subheading`,
  `t`.`content` AS `content`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'name', `r`.`name`, 'kind', `r`.`kind`)), json('[]')) FROM `tag` AS `r` JOIN `article_tag` AS `j` ON `j`.`tag_id` = `r`.`id` WHERE `j`.`article_id` = `t`.`id` ORDER BY `r`.`id`) AS `tag`
FROM `article` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `article_tag_view`;
--> statement-breakpoint
CREATE VIEW `article_tag_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  (CASE WHEN `t`.`article_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`article_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`article_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`article_id`, 11, 6)))) END) AS `article_id`,
  (CASE WHEN `t`.`tag_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`tag_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`tag_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`tag_id`, 11, 6)))) END) AS `tag_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'heading', `r`.`heading`, 'subheading', `r`.`subheading`, 'content', `r`.`content`) FROM `article` AS `r` WHERE `r`.`id` = `t`.`article_id` LIMIT 1) AS `article`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'name', `r`.`name`, 'kind', `r`.`kind`) FROM `tag` AS `r` WHERE `r`.`id` = `t`.`tag_id` LIMIT 1) AS `tag`
FROM `article_tag` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `schema_view`;
--> statement-breakpoint
CREATE VIEW `schema_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
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
  `t`.`username` AS `username`,
  `t`.`email` AS `email`,
  `t`.`display_name` AS `display_name`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'name', `r`.`name`, 'description', `r`.`description`)), json('[]')) FROM `user_group` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_group_id` = `r`.`id` WHERE `j`.`user_id` = `t`.`id` ORDER BY `r`.`id`) AS `groups`
FROM `user` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_view`;
--> statement-breakpoint
CREATE VIEW `user_group_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  `t`.`name` AS `name`,
  `t`.`description` AS `description`,
  (SELECT coalesce(json_group_array(json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`)), json('[]')) FROM `user` AS `r` JOIN `user_group_membership` AS `j` ON `j`.`user_id` = `r`.`id` WHERE `j`.`user_group_id` = `t`.`id` ORDER BY `r`.`id`) AS `users`
FROM `user_group` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `user_group_membership_view`;
--> statement-breakpoint
CREATE VIEW `user_group_membership_view` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`id`, 1, 4))) || '-' || lower(hex(substr(`t`.`id`, 5, 2))) || '-' || lower(hex(substr(`t`.`id`, 7, 2))) || '-' || lower(hex(substr(`t`.`id`, 9, 2))) || '-' || lower(hex(substr(`t`.`id`, 11, 6)))) END) AS `id`,
  `t`.`updated_at` AS `updated_at`,
  (CASE WHEN `t`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`owner`, 1, 4))) || '-' || lower(hex(substr(`t`.`owner`, 5, 2))) || '-' || lower(hex(substr(`t`.`owner`, 7, 2))) || '-' || lower(hex(substr(`t`.`owner`, 9, 2))) || '-' || lower(hex(substr(`t`.`owner`, 11, 6)))) END) AS `owner`,
  (CASE WHEN `t`.`user_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_id`, 11, 6)))) END) AS `user_id`,
  (CASE WHEN `t`.`user_group_id` IS NULL THEN NULL ELSE (lower(hex(substr(`t`.`user_group_id`, 1, 4))) || '-' || lower(hex(substr(`t`.`user_group_id`, 5, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 7, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 9, 2))) || '-' || lower(hex(substr(`t`.`user_group_id`, 11, 6)))) END) AS `user_group_id`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'username', `r`.`username`, 'email', `r`.`email`, 'display_name', `r`.`display_name`) FROM `user` AS `r` WHERE `r`.`id` = `t`.`user_id` LIMIT 1) AS `user`,
  (SELECT json_object('id', (CASE WHEN `r`.`id` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`id`, 1, 4))) || '-' || lower(hex(substr(`r`.`id`, 5, 2))) || '-' || lower(hex(substr(`r`.`id`, 7, 2))) || '-' || lower(hex(substr(`r`.`id`, 9, 2))) || '-' || lower(hex(substr(`r`.`id`, 11, 6)))) END), 'updated_at', `r`.`updated_at`, 'owner', (CASE WHEN `r`.`owner` IS NULL THEN NULL ELSE (lower(hex(substr(`r`.`owner`, 1, 4))) || '-' || lower(hex(substr(`r`.`owner`, 5, 2))) || '-' || lower(hex(substr(`r`.`owner`, 7, 2))) || '-' || lower(hex(substr(`r`.`owner`, 9, 2))) || '-' || lower(hex(substr(`r`.`owner`, 11, 6)))) END), 'name', `r`.`name`, 'description', `r`.`description`) FROM `user_group` AS `r` WHERE `r`.`id` = `t`.`user_group_id` LIMIT 1) AS `user_group`
FROM `user_group_membership` AS `t`;
--> statement-breakpoint
DROP VIEW IF EXISTS `key_view`;
