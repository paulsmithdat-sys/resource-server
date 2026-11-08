# Architecture

Serber is a schema-first resource server. JSON Schema files are the source of
truth; the generator derives Drizzle table definitions, SQLite migrations,
views, custom DDL, typed exports, and a JSON:API registry from them.

## Generation pipeline

```text
src/schema/**/*.ts
        |
        v
   loadSchemas()          discover and validate schema modules
        |
        v
   deriveSchemas()        derive join tables and inverse relations
        |
        v
   buildSchema()          build table plans, columns, FKs, indexes, triggers
        |
        +--> writeExports()          .drizzleExports/index.ts
        +--> buildViews()            views in built schema
        +--> buildCustomDdl()        trigger/view hashes
        +--> drizzle-kit generate    .drizzle/<timestamp>/migration.sql
        +--> postprocessMigration()  IF NOT EXISTS, trigger/view replacement
```

The build is deterministic. Given the same schema inputs, it produces the same
tables in the same order and the same generated export. Running the generator
again with unchanged inputs produces no new migration.

### Loaded schemas

`loadSchemas()` loads user schemas and always-loaded system schemas from
`src/schema/` and `src/schema/system/`. Each schema is imported, validated, and
carried with its source path, import path, and export name.

### Derived schemas

`deriveSchemas()` turns relation declarations into concrete table plans:

- a `one` relation derives a foreign-key column when needed;
- a `many` relation backed by `through` derives a join table;
- inverse relations are added where the model can infer them;
- duplicate join tables are deduplicated by table and column pair.

### Built schema

`buildSchema()` produces `BuiltSchema`: ordered table definitions, view
definitions, triggers, and lookup maps. Each table definition contains:

- declared and injected columns;
- Drizzle table metadata;
- foreign keys with delete/update actions;
- indexes;
- normalized relation metadata with an effective `exposed` flag;
- a trigger that refreshes `updated_at`.

The same built schema is consumed by migration generation and by the runtime
application, so the database and API cannot drift.

### Migrations and custom DDL

Drizzle Kit tracks tables, columns, indexes, and foreign keys. Triggers and views
are not part of its snapshot, so Serber manages them separately:

- `.drizzle/custom-ddl-state.json` stores hashes of the current trigger and view
  SQL;
- changed or new custom DDL is appended to the next migration;
- removed views and triggers are dropped in the next migration;
- triggers are replaced with `DROP TRIGGER IF EXISTS` plus `CREATE TRIGGER`;
- views are replaced with `DROP VIEW IF EXISTS` plus `CREATE VIEW`;
- applied migrations are immutable.

See [development.md](./development.md) for the exact commands.

## Runtime architecture

```text
Browser / client
      |
      v
 Hono app (src/server/app.ts)
      |
      +-- auth routes (/key)            src/auth/routes.ts
      |        |
      |        v
      |   AuthService                  src/auth/service.ts
      |        |
      |        v
      |   key table + user table
      |
      +-- JSON:API routes (/:type)
               |
               +-- Registry            exposed resources only
               +-- Query parser        pagination, sort, filter, include
               +-- Serializers         ts-japi documents
               +-- Mutations           validated writes + owner checks
               |
               v
          <table>_view + base tables
```

### Route precedence

Authentication routes are registered before generic resource routes. This is
required because `key` is a hidden database table but `/key` is a public
authentication surface:

```text
POST   /key
GET    /key/:id
HEAD   /key/:id
PATCH  /key/:id
DELETE /key/:id
OPTIONS /key
OPTIONS /key/:id
```

Because `key` has `"x-exposed": false`, it is absent from the generated
resource registry. `GET /key` therefore falls through to the generic
collection handler and returns `404`. The auth routes are the only way to reach
key rows.

### Reads

Collections and single resources are read from generated `<table>_view` views.
The views embed `one` relations as JSON objects and `many` relations as JSON
arrays. The API therefore does not join base tables at request time.

Only exposed resources, columns, and relations are present in the registry,
views, queries, and serializers. Hiding is enforced at build time, not by an
ad-hoc check in each handler.

### Writes

Write handlers validate the JSON:API document against the resource metadata.
They map attributes to exposed columns, resolve `one` relationships to foreign
keys, replace `many` join-table rows, and validate `owner` references before
writing. Constraint failures become `409 Conflict`.

Every table has a nullable `owner` column that references `user.id` with
`ON DELETE SET NULL`. It is a normal exposed attribute, not a JSON:API
relationship. See [data-model.md](./data-model.md).

### Authentication state

The authentication service is stateless at the application level. It keeps no
in-memory sessions or pending flows. Every temporary value is stored in the
hidden `key` table:

- pending registration metadata and OPAQUE registration records;
- pending login state;
- server and client JWKs;
- session records and the raw OPAQUE session key;
- expiry and consumption timestamps.

Expired rows are purged whenever a new auth flow starts or a key status is read.
See [auth.md](./auth.md) for the complete flows.

## Failure behavior

- Invalid JSON, attributes, queries, and write documents return `400`.
- Unknown resource types, IDs, and routes return `404`.
- Auth state that is missing, expired, consumed, or invalid returns `401`.
- Unique and foreign-key violations return `409`.
- Unexpected failures return `500` and are logged.

Auth success responses are plain JSON. Errors, including auth errors, use the
project's JSON:API error serializer.

## Source layout

```text
src/
  auth/          OPAQUE service, routes, and Ed25519 JWK helpers
  db/            schema loading, derivation, building, views, migrations
  helper/        database connection
  schema/        user and system JSON Schema modules
  seed/          sample JSON:API documents
  server/        Hono app, registry, queries, serializers, mutations
spec/            end-to-end API and auth tests
doc/             detailed documentation
.drizzle/        generated migrations and custom-DDL state
.drizzleExports/ generated Drizzle schema exports
```
