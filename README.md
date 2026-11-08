# Serber

> A secure, declarative backend for vibe-coded applications.

Serber is a schema-first resource server. You describe your domain in JSON Schema, and Serber generates the database schema, relations, views, migrations, and JSON:API endpoints. The frontend team can focus on the frontend, and an AI model can build a complete backend by writing a small, auditable set of schema files instead of thousands of lines of server code.

The project is built on:

- **Turso / SQLite** for an embedded, local-first database.
- **Drizzle ORM** for typed queries and migrations.
- **Hono** for the HTTP layer.
- **JSON:API** as the API contract.
- **OPAQUE** and **tweetnacl** for authentication and session keypairs.
- **AJV** and JSON Schema for validation.

---

## Table of contents

- [Goals](#goals)
- [Non-goals](#non-goals)
- [The core idea](#the-core-idea)
- [Architecture](#architecture)
- [Data model](#data-model)
- [JSON Schema reference](#json-schema-reference)
- [Relations](#relations)
- [Views](#views)
- [API](#api)
- [Documentation](#documentation)
- [Security model](#security-model)
- [Idempotency and migrations](#idempotency-and-migrations)
- [Roadmap](#roadmap)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Design invariants](#design-invariants)
- [Current status](#current-status)
- [Glossary](#glossary)

---

## Goals

### 1. A declarative backend

JSON Schema is the single source of truth.

A schema file should be enough to define:

- the table name, derived from the JSON Schema title;
- columns and their SQLite types;
- nullability, defaults, uniqueness, and primary keys;
- one-to-one, one-to-many, and many-to-many relations;
- join tables;
- views that resolve foreign keys into actual data;
- the JSON:API resource and its relationships.

The generator derives the rest:

- Drizzle table definitions;
- Drizzle Kit migrations;
- `updated_at` triggers;
- join tables;
- views;
- typed runtime exports;
- API resources.

No hand-written CRUD backend should be required for a normal resource.

### 2. A safe backend for AI-generated applications

Vibe-coded applications often have a strong frontend and an improvised backend. That is where security, data integrity, and maintenance problems appear.

Serber is designed so that the AI model writes **only** JSON Schema files. Those files are:

- small;
- declarative;
- easy to review;
- validated before anything touches the database;
- deterministic in what they generate.

The backend itself is generated from a small number of trusted, tested rules. The model does not write SQL, migrations, authentication code, or authorization checks.

### 3. Security by default

The backend should be safe without requiring every frontend developer to become a security specialist.

The implemented security baseline includes:

- **OPAQUE** for password-authenticated key exchange, so passwords are never sent to the server;
- **tweetnacl** Ed25519 keypairs for registration and login flows;
- **user-owned keys**, stored as JWK representations;
- short-lived login state and 24-hour sessions with automatic purge;
- group-based sharing built on multiple independently authorized keys;
- centralized authorization checks rather than per-endpoint ad hoc logic.

Phase 5 implements OPAQUE registration, login, and session records. Request
signing, owner-based authorization, and group sharing are planned for Phase 6.
The data model already reserves the tables and columns they need.

### 4. Token-efficient generation

A model should not have to emit a full backend to add a resource.

The intended workflow is:

1. The model writes or edits a JSON Schema file.
2. The generator validates it.
3. The generator produces the table, relations, join tables, views, migration, and API resource.
4. The frontend consumes the JSON:API contract.

This makes AI-assisted backend development dramatically cheaper: the model writes tens of lines of schema instead of hundreds or thousands of lines of imperative code.

### 5. Correct by construction

The project should make invalid states difficult to represent.

- Types flow from JSON Schema to Drizzle to the API.
- Relations are explicit and validated against existing tables and columns.
- Foreign keys are declared consistently.
- Join tables are deduplicated.
- Views are generated from the same relation metadata as the tables.
- Migrations are deterministic and never silently rewritten after being applied.

### 6. Operationally simple

Serber should be easy to run locally and easy to deploy.

- Turso/SQLite means no separate database server.
- Drizzle Kit manages migrations.
- Hono provides a small, portable HTTP layer.
- The generated schema export can live in the repository or in a temporary directory.
- The database file and migration history are ordinary files.

### 7. Frontend-first API

The frontend should not need to understand the database.

The API should expose:

- stable resource types;
- JSON:API-compliant documents;
- relationships and included resources;
- pagination, sorting, filtering, and sparse fieldsets;
- predictable error objects.

A schema catalog endpoint should let a client discover the available resources and their relationships.

---

## Non-goals

For the current roadmap, Serber is **not**:

- a general-purpose application server for arbitrary business logic;
- a replacement for a frontend framework;
- a cryptography library — it uses OPAQUE and tweetnacl rather than implementing primitives;
- a multi-tenant platform by default;
- a system where groups own keys — keys are owned by users for non-repudiation;
- an early implementation of registration, login, key generation, or authorization;
- a UI builder.

Those may become later layers, but they are not part of the first milestones.

---

## The core idea

The system is a pipeline:

```text
JSON Schema files
      │
      ▼
schema loader + validator
      │
      ▼
schema builder
      │
      ├── tables
      ├── relations
      ├── join tables
      ├── views
      └── triggers
      │
      ▼
.drizzleExports/index.ts
      │
      ▼
drizzle-kit generate
      │
      ▼
new migration + custom DDL
      │
      ▼
Turso / SQLite
      │
      ▼
Drizzle ORM + Hono + ts-japi
      │
      ▼
JSON:API
```

The important separation is:

- **Schema authoring** is small and declarative.
- **Schema building** is deterministic and tested.
- **Migration generation** is handled by Drizzle Kit.
- **Custom DDL** (triggers and generated views) is post-processed and tracked separately.
- **Runtime queries** use Drizzle.
- **HTTP** uses Hono and JSON:API.

---

## Architecture

### Generation

1. Load every system schema and user schema.
2. Validate each schema and resolve relation references.
3. Build the desired table, relation, join-table, view, and trigger metadata.
4. Write a deterministic `.drizzleExports/index.ts`.
5. Run `drizzle-kit generate`.
6. Detect whether a new migration was created.
7. Post-process only the new migration:
   - add `IF NOT EXISTS` guards where appropriate;
   - add or replace triggers;
   - add or replace views;
   - preserve statement breakpoints.
8. Record hashes of custom DDL so unchanged triggers and views do not produce duplicate migrations.
9. Never modify an already-applied migration.

### Runtime

- The application connects to Turso/SQLite through Drizzle.
- Generated tables and views are exported from a single schema module.
- Hono exposes JSON:API resources.
- `ts-japi` serializes documents and relationships.
- AJV validates request bodies against the corresponding JSON Schema.

### Generated files

- `.drizzleExports/index.ts` — generated Drizzle schema exports.
- `.drizzle/` — generated migrations.
- `.drizzle/custom-ddl-state.json` — hashes for triggers and views.
- The database file is configured through `DB_PATH`.

Generated files should not be edited by hand.

---

## Data model

### Default columns

Every table, including join tables, receives:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `blob` | Primary key, default `uuid7()` |
| `updated_at` | `integer` timestamp | Defaults to the current time |
| `owner` | `blob`, nullable | FK to `user.id`, indexed, `ON DELETE SET NULL` |

`created_at` is intentionally omitted: a UUIDv7 already carries a timestamp.

`owner` records which user owns a row. It is exposed as a normal JSON:API
attribute, not as a relationship. It is always a foreign key to `user.id`, never
to `user_group.id`. Writes reject group ids, unknown user ids, and malformed
values. Deleting a user sets the row's owner to `null`. Because `user` is a
table too, `user.owner` is a self-referencing foreign key.

Authorization is not based on `owner` yet; owner-versus-other-user checks are
deferred to Phase 6.

### System schemas

System schemas are always loaded, even when user schemas change.

#### `user`

- `username` — unique text
- `email` — unique text, email format
- `display_name` — optional text

Relations:

- `keys` — one user has many keys, hidden because `key` itself is hidden
- `groups` — many-to-many membership

#### `user_group`

- `name` — unique text
- `description` — optional text

A group has many users through the derived `user_group_membership` join table. Groups are the future container for roles and shares. Membership metadata, roles, and share grants are deferred.

#### `key`

The `key` table is the persistence layer for authentication. It is marked
`"x-exposed": false`, so it has no generic JSON:API resource, no public view,
and no catalog entry. The `/key` auth routes are the only access path.

Columns:

- `type` — `jwk`, `opaque_registration`, `opaque_login_state`, or `session`;
- `jwk` — server-side JWK or client public JWK, depending on the row type;
- `client_jwk` — client public JWK for login and session rows;
- `material` — registration record, OPAQUE login state, or raw session key;
- `expires_at` — expiry for temporary state;
- `consumed_at` — when one-time state was consumed;
- `user_id` — FK to `user.id`.

Keys are owned by users, never by groups. This is required for non-repudiation:
a key belongs to the identity that created it. Group sharing will later be
implemented by distributing multiple keys, each with its own authorization. The
`key.user` relation uses `ON DELETE RESTRICT` so key history remains
attributable.

See [doc/auth.md](doc/auth.md) and [doc/data-model.md](doc/data-model.md) for the
full row lifecycle.

#### `schema`

- `table_name` — unique text
- `jsonschema` — JSON object

This table can store the schema catalog used by the API and the AI workflow.

### User schemas

User schemas live alongside system schemas and define the application-specific resources. Examples in the repository:

- `Article`
- `Tag`

A schema title becomes the snake_case table name:

```text
"Article"      -> article
"Blog Post"    -> blog_post
"User Group"   -> user_group
```

---

## JSON Schema reference

### Supported keywords

| Keyword | Effect |
| --- | --- |
| `title` | Table name after snake_case conversion |
| `type` | Base SQLite type |
| `properties` | Columns |
| `required` | `NOT NULL` constraints |
| `default` | Column default |
| `format` | Specialized type mapping |
| `enum` | Text column with enum typing |
| `x-unique` | Unique constraint |
| `x-primary` | Custom primary key |
| `x-system` | Always-loaded system schema |
| `x-exposed` | `false` hides a table, property, or relation |
| `x-relations` | Relation metadata |
| `x-unique-constraints` | Table-level unique constraints over column groups |

### Type mapping

| JSON Schema | SQLite / Drizzle |
| --- | --- |
| `string` | `text` |
| `string` with `format: uuid` | `blob`, default `uuid7()` when used as an ID |
| `string` with `format: date-time` | `integer` timestamp |
| `string` with `format: byte` | `blob` |
| `integer` | `integer` |
| `number` | `real` |
| `boolean` | `integer` boolean |
| `object` | `text` JSON |
| `array` | `text` JSON |
| string `enum` | `text` with enum typing |

Column names are snake_cased. API attribute names may remain as declared in the schema.

### `x-exposed`

`x-exposed` defaults to `true`. Setting it to `false` removes a table, property,
or relation from the public surface:

- a hidden table has no registry resource, no public view, no catalog entry, and
  no generic `/:type` routes;
- a hidden property is omitted from views, serializers, query fields, and write
  validation;
- a hidden relation is omitted from the registry and `include` validation;
- relations that target a hidden table are hidden automatically;
- a derived join table is hidden when either endpoint or the relation is hidden.

The `key` table uses this to keep authentication state reachable only through
`/key`. Hidden data still exists in the database and remains accessible to
trusted server code. The value must be a boolean.

### Example

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Article",
  "type": "object",
  "additionalProperties": false,
  "description": "A blog article",
  "properties": {
    "heading": { "type": "string", "minLength": 2, "maxLength": 100 },
    "subheading": { "type": "string", "minLength": 1, "maxLength": 100 },
    "content": { "type": "string" }
  },
  "x-relations": {
    "tag": {
      "table": "tag",
      "column": "id",
      "cardinality": "many"
    }
  }
}
```

This produces:

- the `article` table;
- the `article_tag` join table;
- `article_view` with a `tag` JSON array, plus `article_tag_view`;
- the `/article` JSON:API resource.

---

## Relations

Relations are declared under `x-relations`.

```json
{
  "x-relations": {
    "user": {
      "table": "user",
      "column": "id",
      "cardinality": "one",
      "foreignKey": "user_id",
      "onDelete": "restrict"
    },
    "groups": {
      "table": "user_group",
      "column": "id",
      "cardinality": "many",
      "through": "user_group_membership",
      "onDelete": "cascade"
    }
  }
}
```

### Fields

| Field | Meaning |
| --- | --- |
| `table` | Target table |
| `column` | Target column, default `id` |
| `cardinality` | `one` or `many` |
| `foreignKey` | Optional FK column name override |
| `through` | Optional join table name override |
| `required` | Whether a derived `one` FK column is `NOT NULL` |
| `onDelete` | FK delete behavior |
| `onUpdate` | FK update behavior |
| `x-exposed` | `false` hides the relation |

### `one`

The source table gets a foreign-key column.

Default name:

```text
<target_table>_<target_column>
```

For `Key.user`:

```text
key.user_id -> user.id
```

`onDelete: "restrict"` is recommended for user-owned keys, so deleting a user does not destroy key history.

### `many` with an inverse `one`

This is a one-to-many relation.

Example:

- `User.keys` is `many`.
- `Key.user` is `one`.

Only the `one` side creates storage: `key.user_id`. No join table is created.

### `many` without an inverse `one`

This is a many-to-many relation.

A join table is created with:

- default columns `id` and `updated_at`;
- `<source>_id`;
- `<target>_id`;
- `NOT NULL` foreign keys;
- a unique constraint on the pair;
- indexes on both FK columns;
- the `updated_at` trigger.

Default join table name:

```text
<source_table>_<target_table>
```

The pair is sorted before naming, so declaring the relation from either side produces the same join table. Explicit `through` names are supported.

Examples:

- `Article` ↔ `Tag` → `article_tag`
- `User` ↔ `User Group` → `user_group_membership` (explicit `through`)

### Deduplication

If both sides declare the same many-to-many relation, only one join table is generated. Explicit `through` names win. Conflicting explicit names are an error. Self-referential many-to-many relations and cyclic foreign keys are rejected with a clear error until they are implemented.

---

## Views

Views resolve foreign keys into the actual referenced data.

There is exactly one view per table, named `<table>_view`. A view returns one row per table row, so the table's own columns stay columns and relations become JSON values in the same row.

### Base columns

Every view exposes the table's columns. UUID columns are formatted as canonical lowercase UUID strings, so they can be used directly in later queries or JSON:API documents. Integer timestamps stay integers and JSON columns stay JSON.

### `one` relations

Each `one` relation becomes a JSON object column named after the relation label:

```json
{
  "id": "019...",
  "updated_at": 1760000000000,
  "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "user": {
    "id": "019...",
    "username": "alice",
    "email": "alice@example.com"
  }
}
```

If the FK is null, the relation column is `null`, not an object full of nulls.

### `many` relations

Each `many` relation becomes a JSON array column named after the relation label.

- One-to-many relations aggregate the targets whose FK points back to the source row.
- Many-to-many relations join through the derived join table.
- An empty relation is `[]`, never `null`.

Example `article_view`:

```json
{
  "id": "019...",
  "heading": "Hello",
  "tag": [
    { "id": "019...", "name": "sql", "kind": "topic" }
  ]
}
```

Views are generated as custom DDL and tracked by hash in `.drizzle/custom-ddl-state.json`. Drizzle Kit does not create or track them. Typed `.existing()` Drizzle view mappings are a later convenience; the database view is the source of truth today.

---

## API

The HTTP layer is JSON:API 1.0 over Hono. It reads the generated `<table>_view` views, so relation values arrive as nested JSON and the API does not join base tables at request time.

### Endpoints

```text
GET, HEAD /              resource catalog
GET, HEAD /:type         collection
POST /:type              create a resource
GET, HEAD /:type/:id     single resource
PUT /:type/:id           replace a resource
PATCH /:type/:id         update a resource
DELETE /:type/:id        delete a resource
OPTIONS /:type           advertised collection methods
OPTIONS /:type/:id       advertised single-resource methods
```

Authentication has its own plain-JSON surface, registered before the generic
resource routes:

```text
POST    /key             start registration or login
GET     /key/:id         safe key status
HEAD    /key/:id         headers for key status
PATCH   /key/:id         finish registration or login
DELETE  /key/:id         delete a session or abort a flow
OPTIONS /key
OPTIONS /key/:id
```

Resource types are the snake_case table names:

```text
/user
/user_group
/schema
/article
/tag
```

`key` is hidden, so `GET /key` falls through to the generic collection handler
and returns `404`. Use the auth routes instead. See [doc/auth.md](doc/auth.md).

The catalog describes each resource without querying any rows:

```json
{
  "meta": {
    "resources": [
      {
        "type": "article",
        "attributes": ["updated_at", "owner", "heading", "subheading", "content"],
        "relationships": ["tag"]
      }
    ]
  }
}
```

### Query parameters

Collections support:

- `page[number]` — 1-based page number, default `1`;
- `page[size]` — rows per page, default `20`, maximum `100`;
- `sort` — comma-separated fields, prefix a field with `-` for descending order;
- `filter[field]` — equality filter, repeatable for multiple `AND` conditions;
- `fields[type]` — comma-separated attributes and relationship labels for sparse fieldsets;
- `include` — comma-separated relationship labels to add to the compound document.

Single-resource requests accept `fields[type]` and `include`. The same parser validates all query parameters, so sorting and pagination parameters are accepted but do not change a single-resource response.

Sorting and filtering only allow base view columns. Relationship labels are not SQL columns and are rejected. Unknown fields or types in `fields[...]`, unknown relationship labels, and out-of-range pagination values return `400` with a JSON:API error whose `source.parameter` identifies the bad parameter.

Relationship loading is deliberately limited for now:

- `include` supports direct relationships of the primary resource;
- nested paths such as `include=tag.articles` are not implemented;
- included resources are serialized without relationships, so their `relationships` object is empty.

### Documents

A collection response looks like this:

```json
{
  "jsonapi": { "version": "1.0" },
  "data": [
    {
      "type": "article",
      "id": "0190c9d2-7c4a-7b3e-9a11-2f7a8f9b1c22",
      "attributes": {
        "updated_at": 1731092400000,
        "heading": "Hello",
        "subheading": null,
        "content": "..."
      },
      "relationships": {
        "tag": {
          "data": [
            { "type": "tag", "id": "0190c9d2-8d5b-7c4f-8b22-3a8b9a0c2d33" }
          ]
        }
      }
    }
  ],
  "included": [],
  "meta": {
    "page": { "number": 1, "size": 20, "total": 1, "pages": 1 }
  }
}
```

A single-resource response has an object in `data` and no pagination `meta`.

Attributes contain every exposed non-relational column except `id`, including `updated_at` and `owner`. Foreign-key columns and relation labels are omitted. Relationships contain resource identifier objects only; relationship links are not generated yet. A `one` relationship serializes as one identifier or `null`, and a `many` relationship serializes as an array.

### Write operations

Write bodies are JSON:API resource objects:

```json
{
  "data": {
    "type": "article",
    "attributes": {
      "heading": "Hello",
      "subheading": "World",
      "content": "..."
    },
    "relationships": {
      "tag": {
        "data": [
          { "type": "tag", "id": "0190c9d2-8d5b-7c4f-8b22-3a8b9a0c2d33" }
        ]
      }
    }
  }
}
```

- `POST /:type` creates a resource and returns `201` with a `Location` header. A client may supply a canonical UUID `data.id`; otherwise the database generates one.
- `PUT /:type/:id` replaces a resource. Omitted optional attributes become `null`, and omitted relationships are cleared.
- `PATCH /:type/:id` updates only the supplied attributes and relationships.
- `DELETE /:type/:id` removes the resource and any derived join-table rows that reference it, then returns `204`.
- `HEAD` returns the same status and headers as `GET` without a body.
- `OPTIONS` returns `204` with an `Allow` header listing the supported methods.

Writes validate the resource type, attribute names, types, enums, string lengths, required fields, and relationship identifier types. A `one` relationship writes its foreign-key column. A `many` relationship through a join table replaces that table's rows for the resource. When `owner` is supplied, it must be a canonical UUID that references an existing user; group ids and unknown users are rejected. Constraint violations return `409 Conflict`.

Mock documents for the user-defined schemas live in `src/seed/`. Tags are listed before articles so articles can reference existing tag IDs.

### IDs

The database stores UUIDv7 values as blobs. Views cast them to canonical UUID strings, and the API uses those strings as JSON:API `id` values and as lookup values in `GET /:type/:id`.

### Errors

Errors use the JSON:API error format:

```json
{
  "errors": [
    {
      "status": "400",
      "title": "Bad Request",
      "detail": "Cannot sort by unknown field \"tag\"",
      "source": { "parameter": "sort" }
    }
  ]
}
```

Invalid queries and malformed write documents return `400`, unknown resource types, IDs, and routes return `404`, invalid or expired auth state returns `401`, constraint violations return `409`, and unexpected failures return `500`. Every JSON:API response, including errors, uses the content type `application/vnd.api+json`. Auth success responses use `application/json`; auth errors use the JSON:API error format.

---

## Documentation

Detailed documentation lives in [`doc/`](doc/README.md):

- [Architecture](doc/architecture.md) — generation pipeline, runtime, routes, and failure behavior.
- [Data model](doc/data-model.md) — default columns, `owner`, system tables, the hidden key store, joins, and views.
- [Schema reference](doc/schema-reference.md) — keywords, `x-exposed`, relations, and validation rules.
- [API](doc/api.md) — endpoints, queries, writes, status codes, and the owner attribute.
- [Authentication](doc/auth.md) — OPAQUE registration/login, key rows, sessions, TTLs, and keypairs.
- [Development](doc/development.md) — setup, commands, migrations, tests, and conventions.

---

## Security model

### OPAQUE

OPAQUE is used so that a password is never transmitted to the server.

Implemented flow:

1. Registration:
   - the client starts OPAQUE registration;
   - `POST /key` creates a pending key row and returns the OPAQUE registration response;
   - `PATCH /key/:id` consumes the pending row, inserts the user, and stores the registration record.
2. Login:
   - `POST /key` creates a pending login row and returns the OPAQUE login response;
   - `PATCH /key/:id` consumes the login state, verifies the OPAQUE exchange, and creates a session row;
   - the server never receives the plaintext password.
3. Session:
   - the raw OPAQUE session key is stored in the session key row;
   - sessions expire after 24 hours;
   - there is no refresh flow.

All temporary state is persisted in the hidden `key` table. Unknown usernames
receive the same login-start response shape as known ones and fail with `401` at
finish. Expired rows are purged automatically. See [doc/auth.md](doc/auth.md).

### tweetnacl and JWK

Tweetnacl provides the Ed25519 keypair operations used by the auth flow.

Implemented model:

- a user owns one or more keys;
- each key is stored as a JWK;
- JWK keypairs are generated on both sides for every registration and login;
- the registration server private key is ephemeral and discarded;
- the login server private key and client public key are copied into the session row;
- login and session keypairs are discarded when the session row expires or is deleted;
- keys can be long-term or session-scoped;
- group sharing will later distribute multiple keys, each with separate authorization.

Keys are owned by users, never by groups. This preserves the link between a signature and the identity that owned the key. Request signing itself is deferred to Phase 6.

### Non-repudiation

Non-repudiation requires that:

- a key remains attributable to its owner;
- deleting a user does not silently erase key history;
- signatures can be verified later;
- key rotation is explicit and auditable.

This is why the default `Key.user` FK uses `onDelete: "restrict"` rather than cascade. Soft-deletion and key revocation APIs are deferred to Phase 6.

### Authorization and sharing

Authorization is deferred. The future model will include:

- groups as containers for roles and shares;
- membership;
- role assignments;
- resource-level and row-level permissions;
- multiple keys per user with independent authorization;
- audit trails for sensitive actions.

The current baseline only contains the structural tables needed for that model.

### Threat model

| Threat | Mitigation | Status |
| --- | --- | --- |
| Plaintext password theft | OPAQUE, passwords never sent | Implemented |
| Replay attacks | one-time consume, OPAQUE exchange, short-lived pending state | Implemented |
| Session key theft | 24-hour sessions, delete endpoint, automatic purge | Implemented |
| Forged signatures | tweetnacl keypairs and user-owned keys | Keypairs implemented; signing deferred |
| Privilege escalation | centralized authorization checks | Phase 6 |
| SQL injection | Drizzle parameterization, no raw user SQL | Implemented |
| Schema injection | AJV validation and an allowlisted keyword set | Phase 7 |
| Migration corruption | immutable applied migrations, custom-DDL hashes | Implemented |
| Data loss | backups, WAL, migration tests | Phase 8 |
| Token/cost blowup | schema-only authoring and generated code | Phase 7 |

---

## Idempotency and migrations

Idempotency is a core requirement.

### Generation

Running the generator twice with unchanged schemas must:

- create no second migration;
- not rewrite the first migration;
- not duplicate triggers or views.

### Migration application

Running the migration command twice must succeed without errors.

Applied migrations are immutable. If a migration has already been recorded in `__drizzle_migrations`, the generator must never append to or rewrite it.

### Custom DDL

Triggers and views are not part of Drizzle’s snapshot. They are generated separately and tracked by hashes in `.drizzle/custom-ddl-state.json`.

Rules:

- new or changed custom DDL goes into a new migration;
- unchanged custom DDL produces no migration;
- trigger changes use `DROP TRIGGER IF EXISTS` followed by `CREATE TRIGGER`;
- view changes use `DROP VIEW IF EXISTS` followed by `CREATE VIEW`;
- table creation uses `CREATE TABLE IF NOT EXISTS` where safe.

### Acceptance criteria

- `db:generate` twice → one migration.
- `db:migrate` twice → no error.
- One `*_updated` trigger per table.
- Migration hashes in `__drizzle_migrations` match the files.
- Builder and integration tests pass.

---

## Roadmap

### Phase 0 — Foundation and deterministic builder

**Goal:** separate schema authoring from generation and remove the current circular dependency.

Deliverables:

- `load-schemas` module for filesystem discovery.
- Pure `build-schema` module producing tables, relations, join tables, views, and triggers.
- System schemas under `src/schema/system/`.
- Deterministic `.drizzleExports/index.ts`.
- Correct type mapping, `required`, defaults, `x-unique`, and JSON columns.
- Remove duplicated helpers and side effects from importable modules.

Exit criteria:

- importing the export module does not run the generator;
- builder unit tests cover all supported keywords;
- generated output is deterministic across runs.

### Phase 1 — Idempotent tables and baseline

**Goal:** create a clean, reproducible baseline and guarantee idempotent generation.

Deliverables:

- reset the development `.drizzle` and `.db` baseline;
- generate `user`, `user_group`, `key`, `schema`, `article`, and `tag`;
- post-process new migrations with `IF NOT EXISTS` guards and triggers;
- custom-DDL state file;
- integration tests against a temporary database.

Exit criteria:

- generate twice → one migration;
- migrate twice → no errors;
- exactly one trigger per table;
- migration hashes match;
- baseline tables match the documented model.

### Phase 2 — Relations

**Goal:** generate foreign keys and join tables from `x-relations`.

Status: complete.

Deliverables:

- derived relation schemas for `one` FK columns and many-to-many join tables;
- `one` relations with nullable FK columns by default, `required` support, and `onDelete`/`onUpdate`;
- inverse-aware one-to-many detection;
- many-to-many join tables with default columns, `NOT NULL` FKs, unique pair, indexes, and trigger;
- unordered pair deduplication, explicit `through`, and conflict detection;
- table-level `x-unique-constraints`;
- topological table creation order with clear errors for cycles and self-references;
- system relations: `key.user`, `user.keys`, `user.groups`, `user_group.users`.

Exit criteria:

- one-to-many creates no join table;
- many-to-many creates exactly one join table;
- invalid targets, columns, and duplicate relations fail with clear errors;
- FK enforcement is tested.

### Phase 3 — Views

**Goal:** resolve foreign keys into actual data.

Status: complete.

Deliverables:

- one `<table>_view` per table with one row per table row;
- `one` relations as nested JSON objects or `null`;
- `many` relations as JSON arrays, including empty arrays;
- canonical lowercase UUID strings in views;
- custom-DDL integration for view creation and replacement;
- view hashes in `.drizzle/custom-ddl-state.json`.

Exit criteria:

- views are created in migrations;
- null FKs produce `null`, not partial objects;
- many relations return JSON arrays;
- re-running generation does not duplicate views;
- queries against views return canonical UUID strings.

Typed Drizzle view mappings and JSON:API `include` were delivered in Phase 4.

### Phase 4 — JSON:API

**Goal:** serve generated resources over Hono.

Status: complete.

Deliverables:

- Hono application and resource registry built from `BuiltSchema`;
- `ts-japi` serializers and relators created per request;
- resource catalog at `GET /`;
- collection and single-resource endpoints backed by `<table>_view`;
- pagination, sorting, filtering, sparse fieldsets, and direct `include`;
- write endpoints for create, replace, update, and delete;
- `HEAD` and `OPTIONS` support with advertised methods;
- JSON:API error responses and write validation;
- canonical string UUIDs in documents and lookups;
- seed documents for user-defined schemas;
- contract tests with an in-memory row database and end-to-end specs against migrated in-memory databases.

Exit criteria:

- `GET /article` and `GET /article/:id` return valid JSON:API documents;
- `POST`, `PUT`, `PATCH`, and `DELETE` mutate generated tables and join tables correctly;
- `include` resolves direct relationships from embedded view JSON;
- invalid requests return JSON:API errors with parameter sources;
- content type is `application/vnd.api+json`;
- server code consumes the same generated schema as migrations.

Nested include paths, relationship links, and typed Drizzle view mappings remain future work.

### Phase 5 — Authentication

**Goal:** add OPAQUE registration/login and session keypairs.

Status: complete.

Deliverables:

- `/key` routes for registration, login, status, and deletion;
- server-side OPAQUE setup from the environment;
- stateless auth state persisted in the hidden `key` table;
- user records created from pending registration state;
- OPAQUE registration records, login state, and raw session keys stored in key rows;
- tweetnacl Ed25519 keypairs generated for every flow;
- JWK storage for server private keys and client public keys;
- 24-hour sessions with automatic purge and a delete endpoint;
- a hidden `key` resource and hidden `user.keys` relation through `x-exposed`;
- auth, exposure, and owner integration tests.

Exit criteria met:

- no plaintext password crosses the network;
- registration and login tests pass, including duplicate, expiry, unknown-user, and replay cases;
- session keypairs are fresh on every login and stored until expiry;
- expired and deleted sessions fail closed;
- key status never exposes key material.

Request signing and owner-based authorization remain in Phase 6.

### Phase 6 — Authorization and sharing

**Goal:** enforce access control and group-based sharing.

Deliverables:

- group membership, roles, and shares;
- authorization checks for resource and row access;
- multiple keys per user with independent authorization;
- key rotation and revocation;
- audit trails for sensitive actions.

Exit criteria:

- an access matrix test suite passes;
- group sharing works only through explicitly authorized keys;
- unauthorized access is denied consistently;
- key history remains attributable.

### Phase 7 — AI schema workflow

**Goal:** make schema authoring cheap and reliable for AI models.

Deliverables:

- AJV validation with actionable error messages;
- JSON Schema to TypeScript type generation;
- schema catalog endpoint;
- schema versioning and migration guidance;
- examples and templates for common resource patterns.

Exit criteria:

- a model can add a resource by writing one schema file;
- invalid schemas fail before touching the database;
- generated errors identify the exact schema path;
- a new resource is queryable through the API without handwritten backend code.

### Phase 8 — Operations and hardening

**Goal:** make the system safe to operate.

Deliverables:

- backup and restore workflow;
- WAL and migration checks in CI;
- structured logging and metrics;
- rate limiting;
- CORS and CSRF policy;
- deployment documentation;
- security review.

Exit criteria:

- a fresh deployment can be bootstrapped from migrations;
- a backup can be restored and verified;
- CI rejects non-idempotent or non-deterministic generation;
- security checklist is complete.

---

## Repository layout

```text
src/
  auth/
    service.ts       OPAQUE registration/login/session lifecycle
    routes.ts        /key HTTP surface
    keys.ts          Ed25519 JWK helpers
  schema/
    system/
      user.ts
      user_group.ts
      key.ts
      schema.ts
    article.ts
    tag.ts
  db/
    load-schemas.ts
    derive-schemas.ts
    build-schema.ts
    views.ts
    generate-exports.ts
    custom-ddl.ts
    postprocess-migration.ts
    generate-migration.ts
    reset.ts
    *.test.ts
  seed/
    article.ts
    tag.ts
    index.ts
  server/
    app.ts
    registry.ts
    query.ts
    serialize.ts
    mutations.ts
    errors.ts
    database.ts
    uuid.ts
    index.ts
    app.test.ts
  helper/
    loadDb.ts
doc/
  README.md
  architecture.md
  data-model.md
  schema-reference.md
  api.md
  auth.md
  development.md
spec/
  helpers/
    test-server.ts
    auth-client.ts
  get.test.ts
  post.test.ts
  put.test.ts
  patch.test.ts
  delete.test.ts
  head.test.ts
  options.test.ts
  auth.test.ts
  owner.test.ts
.drizzle/                 generated migrations and custom-ddl-state.json
.drizzleExports/          generated Drizzle schema
```

---

## Development

### Commands

```bash
bun install

# generate the dynamic export and a migration
bun run db:generate

# apply migrations
bun run db:migrate

# reset the development database and migration baseline
bun run db:reset

# run tests
bun test

# run the API server
bun run dev

# run the API server once
bun run start
```

### Environment

```bash
DB_PATH=.db
ELYSIA_PORT=5734
OPAQUE_SERVER_SETUP=...
```

`.env` is gitignored. Never commit server secrets.

### Testing

The test suite should cover:

- schema loading and validation;
- table, relation, join-table, and view construction;
- `x-exposed` on tables, columns, relations, and derived join tables;
- the injected `owner` column, its user foreign key, index, validation, and `ON DELETE SET NULL`;
- deterministic export generation;
- migration idempotency;
- trigger and view replacement;
- FK enforcement;
- JSON:API documents and errors;
- `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS` against seeded documents;
- OPAQUE registration, login, sessions, expiry, replay, unknown users, and keypair freshness.

Idempotency tests are mandatory: generation and migration must be safe to re-run.

---

## Design invariants

1. JSON Schema is the source of truth.
2. Generated files are not edited by hand.
3. Every table has `id`, `updated_at`, and a nullable `owner`.
4. IDs are UUIDv7 blobs.
5. Table and column names are snake_case.
6. `owner` references `user.id` only, is indexed, and uses `ON DELETE SET NULL`.
7. Keys are owned by users, never groups.
8. Authentication state is persisted in the hidden `key` table.
9. `x-exposed: false` removes a table, property, or relation from every public surface.
10. Applied migrations are immutable.
11. Triggers and views are managed through custom-DDL state.
12. Relation declarations are validated before generation.
13. The API is JSON:API; auth success bodies are plain JSON.
14. No raw user SQL is executed.
15. Generation is deterministic.
16. A schema change is the only normal reason to add a migration.

---

## Current status

Serber is in early development.

Phases 0–5 are complete:

- the generator is split into schema loading, relation derivation, deterministic building, view generation, export generation, migration post-processing, custom-DDL state, and reset modules;
- system schemas for `user`, `user_group`, `key`, and `schema` are loaded alongside user schemas;
- every table receives a nullable, indexed `owner` foreign key to `user.id` with `ON DELETE SET NULL`;
- `one` relations become foreign keys with indexes, defaults, nullability, and delete/update actions;
- many-to-many relations become deduplicated derived join tables with `NOT NULL` FKs and unique pair constraints;
- derived join tables receive their own `id`, `updated_at`, `owner`, trigger, and view;
- each table has a `<table>_view` with nested `one` objects and `many` arrays;
- UUIDs are exposed as canonical strings in views;
- `x-exposed: false` hides tables, columns, relations, and their derived join tables from the catalog, queries, and mutations;
- the development baseline was regenerated from scratch;
- generation is idempotent: running it twice produces one migration;
- migration application is idempotent: running it twice succeeds;
- the baseline has exactly one `updated_at` trigger per table and one view per table;
- builder, derivation, view, post-processing, export, idempotency, and exposure tests pass;
- a Hono application serves the generated views as JSON:API collections and single resources;
- the API supports pagination, sorting, equality filters, sparse fieldsets, and direct `include`;
- create, replace, update, and delete endpoints write to generated tables and derived join tables;
- writes validate attributes, required fields, relationship identifiers, owner references, and constraint failures;
- `HEAD` and `OPTIONS` are supported with advertised methods;
- OPAQUE registration and login are implemented through `/key`;
- all temporary auth state lives in the hidden `key` table;
- registration and login state expire after 10 minutes, sessions after 24 hours, and expired rows are purged automatically;
- registration and login create fresh Ed25519 keypairs on both sides;
- session status never exposes key material, and sessions can be deleted;
- unknown usernames receive the same login-start response shape and fail with `401` at finish;
- mock documents for user-defined schemas live in `src/seed/`;
- invalid requests return JSON:API errors; JSON:API responses use `application/vnd.api+json` and auth success responses use `application/json`;
- API and auth tests run against in-memory Turso databases created from all migrations.

The next milestone is Phase 6: request signing, owner-based authorization, and group sharing.

---

## Glossary

| Term | Meaning |
| --- | --- |
| JSON Schema | The declarative resource definition format |
| Drizzle ORM | Typed SQLite query layer |
| Drizzle Kit | Migration generator and runner |
| Turso | SQLite-compatible embedded database |
| System schema | A schema that is always loaded |
| Join table | A table linking two resources in a many-to-many relation |
| View | A derived table that resolves foreign keys into data |
| Custom DDL | Triggers and views not tracked by Drizzle’s snapshot |
| Idempotent | Safe to run repeatedly with the same result |
| Owner | Nullable user foreign key injected into every table |
| x-exposed | JSON Schema keyword that hides a table, property, or relation |
| OPAQUE | Password-authenticated key exchange |
| Session | A 24-hour key row created by a successful login |
| tweetnacl | Cryptographic primitives for Ed25519 keypairs |
| JWK | JSON Web Key |
| JSON:API | The HTTP API specification used by the server |
| Vibe-coded | An application built primarily through AI-assisted iteration |
