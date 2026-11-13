# Authored views: implementation notes

This document records the design, process, and current state of authored
read-only views (`x-view`). It is a working note for reviewers; the user-facing
reference is in [schema-reference.md](schema-reference.md).

## Goal

Let a schema file declare a read-only resource that projects fields and
relations from any table, without writing SQL in YAML or JSON, and without
being mistaken for a table resource.

## Declarations

A view is a normal schema document with:

- `x-view: true` at the top level.
- `x-source: "<base>"` naming the table it reads.
- One property per output field, each with `x-source: "<base>.<path>"`.

Paths follow relations, so `article.author.name` reads a column on a related
row and `article.tag` exposes a to-many relation. A relation-valued property
becomes a JSON:API relationship; a column-valued property becomes an attribute.

Every view must expose `id`, `owner`, and `visibility` directly from its base
row. `id` and `owner` use `format: uuid`. Row scoping therefore keeps working
unchanged: the API still reads owner and visibility from the projected row.

Example:

```json
{
  "title": "Article Card",
  "type": "object",
  "x-view": true,
  "x-source": "article",
  "properties": {
    "id": { "type": "string", "format": "uuid", "x-source": "article.id" },
    "owner": {
      "type": "string",
      "format": "uuid",
      "x-source": "article.owner"
    },
    "visibility": { "type": "string", "x-source": "article.visibility" },
    "heading": { "type": "string", "x-source": "article.heading" },
    "author": { "type": "object", "x-source": "article.author" },
    "tags": { "type": "array", "x-source": "article.tag" }
  }
}
```

## Build process

1. `buildSchema` rejects a non-boolean `x-view`.
2. View schemas are split out before `deriveSchemas`, so they create no table,
   trigger, join table, or share table.
3. Table schemas are derived and built as before. Generated `<table>_view`
   objects are built next.
4. `buildAuthoredViews` runs last with the base tables and the reserved names
   (tables plus generated views).
5. Each view becomes both:
   - a `ViewDef` in `built.views`, so migrations create and drop it; and
   - a synthetic `TableDef` in `built.authoredViews`, carrying `sourceTable`,
     projected columns, and relationship metadata for the API.
6. `buildRegistry` registers authored views with `readOnly: true`.

The generated SQL has one `SELECT` expression per property:

```sql
CREATE VIEW `article_card` AS
SELECT
  (CASE WHEN `t`.`id` IS NULL THEN NULL ELSE (...) END) AS `id`,
  ...
  (SELECT json_object(...)
   FROM `author` AS `r0`
   WHERE `r0`.`id` = `t`.`author_id` LIMIT 1) AS `author`,
  (SELECT coalesce(json_group_array(json_object(...)), json('[]'))
   FROM `tag` AS `r0`
   JOIN `article_tag` AS `j0` ON ...
   WHERE ...) AS `tags`
FROM `article` AS `t`
```

Only the view object is new in the database; the base tables are untouched.

## Validation

Schema building fails when:

- `x-view` is not a boolean.
- A view has no `x-source`, or a property has no `x-source` path.
- A path does not start with `<base>.`, or names an unknown column or relation.
- A path names a hidden table, column, relation, or join table.
- A relation-valued property uses `type: array` for a to-one relation, or a
  non-array type for a to-many relation.
- `id`, `owner`, or `visibility` is missing, hidden, sourced from another path,
  or not a uuid where required.
- The view sets `x-relations`, rather than declaring relations as properties.
- `x-access.shareable` or `x-access.inherit` is set, or `x-access.create` is
  anything other than `none`.
- The view name collides with a table, a generated `<table>_view`, or another
  authored view.

## API behavior

- Catalog entries include `readOnly`, so clients can tell authored views from
  tables and generated table views.
- Reads use `SELECT * FROM <view>`; the view already contains embedded
  relationship JSON, so no extra joins are needed for the resource itself.
- Related filtering traverses the view's base table. `sourceTable` records it.
- Writes to a view are rejected in the request guard with `405`.
- `OPTIONS` advertises only `GET, HEAD, OPTIONS` for authored views.
- Relationship targets and generated table relations are unchanged.

## Files

- `src/db/build/view.ts`: authored-view builder, path resolution, SQL, metadata.
- `src/db/build-schema.ts`: split views from tables, reserve names, wire output.
- `src/db/schema-types.ts`: `x-view`, `x-source`, `sourceTable`, `authoredViews`.
- `src/db/views.ts`: exports shared SQL helpers; `relationJoin` accepts the
  base table used for authored-view traversal.
- `src/server/registry.ts`: registers views with `readOnly`.
- `src/server/read.ts`: reads authored views directly and filters through their
  base tables.
- `src/server/app/guard.ts`: central `405` for writes to read-only resources.
- `src/server/app/index.ts`: per-resource `OPTIONS`.
- `src/server/app/relationships.ts`: catalog `readOnly` flag.
- `src/server/errors.ts`: `methodNotAllowed`.
- `spec/unit/db/authored-views.test.ts`: build, SQL, registry, read, write, and
  validation coverage.
- `README.md`, `doc/schema-reference.md`: user documentation.

## Status and follow-ups

- The implementation and tests are committed together.
- PR: <https://github.com/consoleillusion/resource-server/pull/2>
- `bun test` and `bunx tsc --noEmit` could not be run in the authoring
  environment: no Bun, Node, or `node_modules` was available. Run both before
  merging.
- No shipped example view was added under `src/schema/`, to avoid changing the
  generated migrations and catalog fixtures. Add one when a stable demonstration
  resource is wanted.
- Nested `include` through an authored view behaves like a generated table view:
  direct relations are embedded in the view, and deeper includes are expanded
  by the normal serializer path.
