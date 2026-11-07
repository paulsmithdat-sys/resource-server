# Serber

> A secure, declarative backend for vibe-coded applications.

Serber is a schema-first resource server. You describe your domain in JSON Schema, and Serber generates the database schema, relations, views, migrations, and JSON:API endpoints. The frontend team can focus on the frontend, and an AI model can build a complete backend by writing a small, auditable set of schema files instead of thousands of lines of server code.

The project is built on:

- **Turso / SQLite** for an embedded, local-first database.
- **Drizzle ORM** for typed queries and migrations.
- **Hono** for the HTTP layer.
- **JSON:API** as the API contract.
- **OPAQUE** and **tweetnacl** for authentication and session signing.
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

The intended security model includes:

- **OPAQUE** for password-authenticated key exchange, so passwords are never sent to the server;
- **tweetnacl** session signing keys for authenticity and non-repudiation;
- **user-owned keys**, stored as JWK representations;
- short-lived session keys and long-term keys with separate authorization;
- group-based sharing built on multiple independently authorized keys;
- centralized authorization checks rather than per-endpoint ad hoc logic.

The cryptography is not implemented in the early phases. The data model reserves the necessary tables and columns so the security layer can be added without redesigning the schema.

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

`created_at` is intentionally omitted: a UUIDv7 already carries a timestamp.

### System schemas

System schemas are always loaded, even when user schemas change.

#### `user`

- `username` — unique text
- `email` — unique text, email format
- `display_name` — optional text

Relations:

- `keys` — one user has many keys
- `groups` — many-to-many membership

#### `group`

- `name` — unique text
- `description` — optional text

Groups are the future container for roles and shares. Membership metadata, roles, and share grants are deferred.

#### `key`

- `jwk` — JSON Web Key representation, stored as JSON text
- `user_id` — FK to `user.id`

Keys are owned by users, never by groups. This is required for non-repudiation: a key belongs to the identity that created it. Group sharing will later be implemented by distributing multiple keys, each with its own authorization.

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
| `x-relations` | Relation metadata |

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
- the `article_tag_view` relation view;
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
      "table": "group",
      "column": "id",
      "cardinality": "many",
      "through": "user_group",
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
| `onDelete` | FK delete behavior |
| `onUpdate` | FK update behavior |

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
- foreign keys;
- a unique constraint on the pair;
- the `updated_at` trigger.

Default join table name:

```text
<source_table>_<target_table>
```

Explicit `through` names are supported.

Examples:

- `Article` ↔ `Tag` → `article_tag`
- `User` ↔ `Group` → `user_group`

### Deduplication

If both sides declare the same many-to-many relation, only one join table is generated. Explicit `through` names win. Conflicting explicit names are an error.

---

## Views

Views resolve foreign keys into the actual referenced data.

### One-to-one / many-to-one

For each table with `one` relations, generate:

```text
<table>_view
```

It contains the base columns and one JSON object column per `one` relation.

Example `key_view`:

```json
{
  "id": "...",
  "updated_at": 1760000000000,
  "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "user": {
    "id": "...",
    "username": "alice",
    "email": "alice@example.com"
  }
}
```

If the FK is null, the JSON column is `null`, not an object full of nulls.

### One-to-many and many-to-many

For each `many` relation, generate:

```text
<source>_<label>_view
```

Examples:

- `user_key_view`
- `user_group_view`
- `article_tag_view`

Each row joins the source, the join table, and the target, and exposes the resolved target as a JSON object.

Views are exported to Drizzle using `sqliteView(name, columns).existing()`, so the ORM can query them with typed columns. The migration post-processor owns the `DROP VIEW IF EXISTS` and `CREATE VIEW` statements.

---

## API

The HTTP layer is JSON:API over Hono.

### Resources

Resource types are the snake_case table names:

```text
/user
/group
/key
/article
/tag
```

### Collection endpoints

```text
GET /:type
GET /:type/:id
```

Planned query support:

- `page[number]`
- `page[size]`
- `sort`
- `filter[field]`
- `fields[type]`
- `include`

### Documents

```json
{
  "data": {
    "type": "article",
    "id": "019...",
    "attributes": {
      "heading": "Hello",
      "subheading": "World",
      "content": "..."
    },
    "relationships": {
      "tag": {
        "links": {
          "related": "/article/019.../tag"
        }
      }
    }
  }
}
```

### IDs

The database uses UUIDv7 blobs. JSON:API requires string IDs, so the API layer converts blob IDs to canonical UUID strings.

### Errors

Errors use the JSON:API error format:

```json
{
  "errors": [
    {
      "status": "422",
      "title": "Validation failed",
      "detail": "heading must be at least 2 characters",
      "source": { "pointer": "/data/attributes/heading" }
    }
  ]
}
```

The content type is `application/vnd.api+json`.

---

## Security model

### OPAQUE

OPAQUE is used so that a password is never transmitted to the server.

The intended flow:

1. Registration:
   - the client performs OPAQUE registration;
   - the server stores the registration record;
   - the server setup remains in the server environment.
2. Login:
   - the client and server perform the OPAQUE key exchange;
   - the server never receives the plaintext password.
3. Session establishment:
   - the result is used to establish an authenticated session;
   - session keys are issued with short lifetimes.

The database reserves a user registration record field for this flow. The crypto implementation is deferred to a later phase.

### tweetnacl and JWK

Tweetnacl provides signing and encryption primitives.

The intended model:

- a user owns one or more keys;
- each key is stored as a JWK;
- signing keys are used for non-repudiation;
- session signing keys are exchanged during the authenticated session;
- keys can be long-term or session-scoped;
- group sharing is implemented later by distributing multiple keys, each with separate authorization.

Keys are owned by users, never by groups. This preserves the link between a signature and the identity that owned the key.

### Non-repudiation

Non-repudiation requires that:

- a key remains attributable to its owner;
- deleting a user does not silently erase key history;
- signatures can be verified later;
- key rotation is explicit and auditable.

This is why the default `Key.user` FK uses `onDelete: "restrict"` rather than cascade. Soft-deletion and key revocation will be added with the auth layer.

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

| Threat | Mitigation | Phase |
| --- | --- | --- |
| Plaintext password theft | OPAQUE, passwords never sent | 5 |
| Replay attacks | OPAQUE session exchange, nonces, short-lived sessions | 5 |
| Session key theft | short lifetimes, revocation, rotation | 5–6 |
| Forged signatures | tweetnacl verification and user-owned keys | 5 |
| Privilege escalation | centralized authorization checks | 6 |
| SQL injection | Drizzle parameterization, no raw user SQL | 0–4 |
| Schema injection | AJV validation and an allowlisted keyword set | 7 |
| Migration corruption | immutable applied migrations, custom-DDL hashes | 1 |
| Data loss | backups, WAL, migration tests | 8 |
| Token/cost blowup | schema-only authoring and generated code | 7 |

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
- generate `user`, `group`, `key`, `schema`, `article`, and `tag`;
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

Deliverables:

- `one` relations with FK columns and `onDelete`/`onUpdate`;
- inverse-aware one-to-many;
- many-to-many join tables with default columns, FKs, unique pair, and trigger;
- deduplication and validation;
- system relations: `key.user`, `user.keys`, `user.groups`, `group.users`.

Exit criteria:

- one-to-many creates no join table;
- many-to-many creates exactly one join table;
- invalid targets, columns, and duplicate relations fail with clear errors;
- FK enforcement is tested.

### Phase 3 — Views

**Goal:** resolve foreign keys into actual data.

Deliverables:

- `<table>_view` with JSON objects for `one` relations;
- `<source>_<label>_view` for `many` relations;
- null-safe JSON construction;
- typed Drizzle view exports;
- custom-DDL integration for view creation and replacement.

Exit criteria:

- views are created in migrations;
- null FKs produce `null`, not partial objects;
- many-relation views return one row per link;
- typed Drizzle queries work against views.

### Phase 4 — JSON:API

**Goal:** serve generated resources over Hono.

Deliverables:

- Hono application and resource registry;
- `ts-japi` serializers;
- collection and single-resource endpoints;
- pagination, sorting, filtering, sparse fieldsets, and `include`;
- JSON:API error responses;
- blob UUID to string conversion;
- contract tests.

Exit criteria:

- `GET /article` and `GET /article/:id` return valid JSON:API documents;
- `include` resolves relationships;
- invalid requests return JSON:API errors;
- content type is `application/vnd.api+json`.

### Phase 5 — Authentication

**Goal:** add OPAQUE registration/login and session signing keys.

Deliverables:

- registration and login endpoints;
- server-side OPAQUE setup from the environment;
- user registration record storage;
- tweetnacl session signing key exchange;
- JWK key storage;
- session lifecycle and revocation.

Exit criteria:

- no plaintext password crosses the network;
- registration and login tests pass;
- session signatures verify;
- revoked sessions fail closed.

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
  schema/
    system/
      user.ts
      group.ts
      key.ts
      schema.ts
    article.ts
    tag.ts
  db/
    load-schemas.ts
    build-schema.ts
    table-builder.ts
    generate-exports.ts
    custom-ddl.ts
    postprocess-migration.ts
    generate-migration.ts
    reset.ts
  server/
    app.ts
    resources/
    serializers/
  helper/
    loadDb.ts
.drizzle/                 generated migrations
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
```

Some scripts are planned for the phases above and will be added as those phases land.

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
- deterministic export generation;
- migration idempotency;
- trigger and view replacement;
- FK enforcement;
- JSON:API documents and errors;
- OPAQUE and tweetnacl flows when implemented.

Idempotency tests are mandatory: generation and migration must be safe to re-run.

---

## Design invariants

1. JSON Schema is the source of truth.
2. Generated files are not edited by hand.
3. Every table has `id` and `updated_at`.
4. IDs are UUIDv7 blobs.
5. Table and column names are snake_case.
6. Keys are owned by users, never groups.
7. Applied migrations are immutable.
8. Triggers and views are managed through custom-DDL state.
9. Relation declarations are validated before generation.
10. The API is JSON:API.
11. No raw user SQL is executed.
12. Generation is deterministic.
13. A schema change is the only normal reason to add a migration.

---

## Current status

Serber is in early development.

The repository currently contains a prototype generator and an initial migration. The next milestone is Phase 0–1: refactor the generator, add the system schemas, reset the development baseline, and prove idempotent table generation.

Later milestones add relations, views, the JSON:API layer, authentication, authorization, and the AI schema workflow.

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
| OPAQUE | Password-authenticated key exchange |
| tweetnacl | Cryptographic primitives for signing and encryption |
| JWK | JSON Web Key |
| JSON:API | The HTTP API specification used by the server |
| Vibe-coded | An application built primarily through AI-assisted iteration |
