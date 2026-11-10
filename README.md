# Schema Resource Server

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

Serber is a Bun library and server that turns a folder of JSON Schema files into a complete, secured backend: Turso/SQLite tables, relations and views, registration and login, owner- and share-based authorization, and a JSON:API served by Hono. The aim is a strong, robust, standardized backend for reasonably small projects today, and larger ones later, so that applications built on it need far less backend code and start faster.

### 1. JSON Schema is the only source of truth

Every change to the database is made in JSON Schema, using extensions where plain JSON Schema has no word for it. Nothing is hand-written SQL.

| Extension | What it declares |
| --- | --- |
| `x-relations` | one, one-to-many and many-to-many relations (including self-referential ones); join tables are derived automatically |
| `x-access` | who may read and create, row visibility, sharing, and request signing (see [Access control](#access-control-x-access)) |
| `x-exposed` | tables, columns and relations hidden from the API |
| `x-unique`, `x-unique-constraints`, `x-primary` | keys and uniqueness |

From the schemas the generator derives tables and columns, foreign keys and indexes, join tables, share tables, CHECK constraints, `updated_at` triggers, per-table views with related rows embedded, migrations and API resources.

Initialization is **declarative and idempotent**: generating twice from the same schemas produces identical output and no new migration, and each migration only contains what changed.

### 2. A standard API

Resources are served as **JSON:API** over **Hono**: create, read, update, replace and delete, with filtering, sorting, sparse fieldsets, `include` of related resources, pagination and standard error objects. A client never needs to know the database layout.

### 3. Identity built in

The scaffolding tables provide registration, login and sessions without application code:

- **OPAQUE** password authentication, so the server never sees a password;
- sessions that expire after 24 hours, whose bearer tokens are stored only as hashes;
- case-insensitive usernames and emails;
- login rate limiting and lockout after repeated failures, without revealing which accounts exist.

### 4. Ownership and access by default

- The **owner** of a row is the user who was logged in when it was created. Clients can never set or change it. A row created without logging in has no owner.
- Only the owner can update or delete a row, unless they share write access.
- **Read access is separate from ownership.** Each row has a `visibility`: `private` (owner only, the default), `shared` (owner plus the users and groups it is shared with), `authenticated` (any signed-in user) or `public` (anyone, where the resource allows reads without a session). The owner chooses it on create or on any later update.
- **Sharing**: an owner can grant read access, write access, or both to any user or group. Group members gain access immediately and lose it when removed.
- Each resource declares in its schema whether reads and creates need a login. The default is that both do, and new rows are private: the note-taking model. A social-media style resource can make reads public and new posts public by default.

### 5. Stronger protection where it matters, without burdening every client

Request signing is off by default, because it puts real work on clients. A resource can require it for chosen operations (for example payments). Signed requests are Ed25519 signatures over the method, path, body, session, a timestamp and a nonce, and are protected against tampering and replay. Every other resource stays protected by the OPAQUE session alone.

### 6. Less code and faster starts for other projects

An application built on Serber writes schema files instead of a backend: no CRUD handlers, migrations, authentication or authorization code. The library is tested as a whole (authorization isolation, sharing, signing, concurrency), so applications inherit that protection rather than re-implementing it.

### 7. Auditable and reliable

The code is kept small, dependency-light and covered by tests, so that the security rules every application relies on can be read and verified in one place.

### Where it falls short today

- inherited access follows a to-one parent for reads only: a parent's owner cannot moderate (edit or delete) children they do not own;
- the audit trail is append-only through the API, but not yet protected by database triggers;
- `include` supports direct relationships only, not nested paths such as `include=tag.article`;
- filters apply to a resource's own columns, not to fields of related resources;
- relationship changes on shared rows require the writer to own the rows being linked;
- no key rotation or revocation API.

---

## Non-goals

For the current roadmap, Serber is **not**:

- a general-purpose application server for arbitrary business logic;
- a replacement for a frontend framework;
- a cryptography library — it uses OPAQUE and tweetnacl rather than implementing primitives;
- a multi-tenant platform by default;
- a system where groups own keys — keys are owned by users for non-repudiation;
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

`owner` records which user owns a row. It is exposed as a read-only JSON:API
attribute, not as a relationship. It is always a foreign key to `user.id`, never
to `user_group.id`. The server sets it to the signed-in creator; values sent by
clients are ignored, and rows created without a session have no owner. Deleting
a user sets the row's owner to `null`. Because `user` is a table too,
`user.owner` is a self-referencing foreign key.

`visibility` decides who can read a row; see [Access control](#access-control-x-access).

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

If both sides declare the same many-to-many relation, only one join table is generated. Explicit `through` names win. Conflicting explicit names are an error. A self-referential many-to-many relation (a table related to itself, e.g. `friends` on `person`) gets its own join table named `<table>_<label>` (override with `through`) with columns `<table>_id` (this side) and `related_<table>_id` (the target). It is directed: the relation lists rows where this row is on the `<table>_id` side, so symmetry (A friends B implies B friends A) is not automatic. Cyclic foreign keys are rejected with a clear error until they are implemented.

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
GET, HEAD /:type/:id/:rel                 related resource or collection
GET, HEAD /:type/:id/relationships/:rel   relationship linkage
PATCH /:type/:id/relationships/:rel       replace the relationship
POST /:type/:id/relationships/:rel        add members (to-many)
DELETE /:type/:id/relationships/:rel      remove members (to-many)
OPTIONS on every path                     advertised methods
```

Requests with a body must send `Content-Type: application/vnd.api+json` (otherwise `415`); an `Accept` header that only allows JSON:API with media type parameters gets `406`. Every document carries `jsonapi.version`, a top-level `links.self`, a `links.self` on each resource, `self` and `related` links on each relationship, and `first`, `last`, `prev` and `next` links on collections.

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
- `filter[field]=value` — equality filter, repeatable for multiple `AND` conditions;
- `filter[field][operator]=value` — `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in` and `nin` (comma-separated values), `contains`, `starts`, `ends`, and `null` (`true` or `false`). Values are converted to the column's type and always passed as SQL parameters. JSON:API reserves the `filter` parameter but does not define operators, so this operator syntax is Serber's own convention;
- `fields[type]` — comma-separated attributes and relationship labels for sparse fieldsets;
- `include` — comma-separated relationship labels to add to the compound document.

Single-resource requests accept `fields[type]` and `include`. The same parser validates all query parameters, so sorting and pagination parameters are accepted but do not change a single-resource response.

Sorting and filtering only allow base view columns. Relationship labels are not SQL columns and are rejected. Unknown fields or types in `fields[...]`, unknown relationship labels, and out-of-range pagination values return `400` with a JSON:API error whose `source.parameter` identifies the bad parameter.

Relationship loading is deliberately limited for now:

- `include` supports direct relationships of the primary resource;
- nested paths such as `include=tag.articles` are not implemented (they return `400`, as the specification requires for unsupported paths);
- included resources are serialized without relationships, so their `relationships` object is empty;
- related rows are only loaded in full for `include`d relationships; other relationships load just the ids needed for linkage, and relationships left out by `fields[type]` are not loaded at all.

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

Keys are owned by users, never by groups. This preserves the link between a signature and the identity that owned the key. Request signing is available per resource through `x-access.signed`.

### Non-repudiation

Non-repudiation requires that:

- a key remains attributable to its owner;
- deleting a user does not silently erase key history;
- signatures can be verified later;
- key rotation is explicit and auditable.

This is why the default `Key.user` FK uses `onDelete: "restrict"` rather than cascade. Soft-deletion and key revocation APIs are deferred to Phase 6.

### Authorization and sharing

Authorization is owner-based with per-row visibility and optional sharing to users and groups; see [Access control](#access-control-x-access). Roles, inherited access and audit trails are not implemented yet.

### Threat model

| Threat | Mitigation | Status |
| --- | --- | --- |
| Plaintext password theft | OPAQUE, passwords never sent | Implemented |
| Replay attacks | one-time consume, OPAQUE exchange, short-lived pending state | Implemented |
| Session key theft | 24-hour sessions, tokens stored only as hashes, delete endpoint, automatic purge | Implemented |
| Forged or replayed signed requests | Ed25519 signatures with timestamp and single-use nonce, per resource | Implemented (opt-in) |
| Privilege escalation | centralized owner, visibility and share checks | Implemented |
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

The server applies pending migrations itself when it starts, using the same `__drizzle_migrations` record as `bun run db:migrate`, and refuses to start if one fails. Set `MIGRATE_ON_START=false` to apply migrations yourself. New migrations are only ever generated by `bun run db:generate`.

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

Owner-based authorization, visibility, sharing and opt-in request signing are implemented; see [Access control](#access-control-x-access).

### Phase 6 — Authorization and sharing

**Goal:** enforce access control and group-based sharing.

Done: owner-based authorization, per-row visibility, read/write shares to users
and groups, anonymous creates, and opt-in signed requests with replay protection.

Also done: inherited read access, roles with a configurable admin, and audit trails.

Remaining:

- key rotation and revocation;
- moderation of inherited rows by the parent's owner.

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
PORT=5734
OPAQUE_SERVER_SETUP=...
SERBER_ADMINS=alice,bob   # optional; usernames that always hold the admin role
MIGRATE_ON_START=true     # optional; set to false to apply migrations yourself
SCHEMA_DIR=./schemas   # optional; directory of .json or .ts schema files
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

## Access control (`x-access`)

Every resource can carry an `x-access` object. Every key is optional; leaving it out gives the secure defaults shown.

```json
"x-access": {
  "read": "session",
  "create": "session",
  "visibility": ["private", "authenticated", "public"],
  "defaultVisibility": "private",
  "shareable": false,
  "signed": false,
  "roles": {},
  "audited": false
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `read` | `session` | `public`: requests without a session may read rows whose visibility is `public` |
| `create` | `session` | `public`: requests without a session may create rows; those rows have no owner. `role`: only holders of a role that grants `create` may create rows |
| `visibility` | all values except `shared` (plus `shared` when shareable) | the values the owner may choose; enforced by a CHECK constraint |
| `defaultVisibility` | `private` | the visibility a new row gets |
| `shareable` | `false` | `true` derives a `<table>_share` table so owners can grant access to users and groups |
| `signed` | `false` | `true`, or a list of `read`, `create`, `update`, `delete`, requires signed requests for those operations |
| `roles` | `{}` | role name → operations (`true` for all) its holders may perform on every row, whoever owns it |
| `inherit` | none | label of a to-one relation: whoever can read that parent row can read this row |
| `audited` | `false` | `true`, or a list of operations, records each one in `audit_log` |

What reaches SQL: `owner` and `visibility` columns on every exposed table (with the allowed values as a CHECK constraint and the default as the column DEFAULT), one `<table>_share` table per shareable resource, and one system `request_nonce` table. `read`, `create` and `signed` are applied by the server per request.

**Rules**

- The owner is the signed-in creator and can never be set by a client. Updates need ownership or a write share; deletes, visibility changes and share management need ownership.
- A row is readable by its owner; by anyone if `public`; by any signed-in user if `authenticated`; and, if `shared`, by users and group members holding a read share. Related rows embedded in a response follow the same rule.
- A share row names exactly one user or one group and grants `can_read`, `can_write`, or both. Permissions from several shares combine. Shares only apply while the row's visibility is `shared`. A write-only sharer gets `204` from updates instead of a copy of the row.
- Anonymous creates link only to public rows. A row created anonymously with `private` visibility is effectively write-only.

**Roles.** A user holds a role through a row in the system `user_role` resource, which only admins can create, read or delete. Usernames listed in `SERBER_ADMINS` always hold `admin`, which is how the first admin is set up. Groups never confer roles.

**Inherited access.** With `"inherit": "chat"` on `message`, a message is readable by everyone who can read its chat, with no share per message. To create a row under a parent it inherits from (or move it there), the writer must be able to write to that parent. Updating and deleting the row still need ownership of the row itself. Inheritance is followed for at most three levels.

**Audit trail.** Audited writes insert a row into the system `audit_log` resource (actor, action, resource, row id, time, and the request signature when signed) in the same transaction as the change, so neither happens without the other. Logins and failed logins are always recorded. Only admins can read the log, and nobody can create, change or delete entries through the API.

**Signed requests** add three headers to a session request:

| Header | Value |
| --- | --- |
| `X-Serber-Timestamp` | Unix time in ms, within 60 s of the server clock |
| `X-Serber-Nonce` | 16–128 URL-safe random characters, never reused by a session |
| `X-Serber-Signature` | base64url Ed25519 signature, made with the private key whose public key was sent as `clientPublicKey` at login |

The signed message is these lines joined by `\n`: `serber-signature-v1`, the method, the path with query string, the session id, the timestamp, the nonce, and the base64url SHA-256 of the body. A signature that is sent is always checked, even where signing is not required. Used nonces are stored in `request_nonce` until they expire. `clientPublicKey` is optional at login; a session without one cannot make signed requests.

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

The next milestone finishes Phase 6: inherited access, roles, and audit trails.

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
