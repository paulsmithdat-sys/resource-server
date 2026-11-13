# Schema Resource Server

> A secure, declarative backend.

Serber is a schema-first resource server. You describe your domain in JSON Schema, and Serber generates the database schema, relations, views, migrations, and JSON:API endpoints. Applications write schema files instead of CRUD handlers, migrations, authentication, and authorization code.

It is built on **Turso / SQLite**, **Hono**, **JSON:API**, **OPAQUE**, and **AJV**.

## What you get

- **Tables, relations, and views** derived from JSON Schema. No hand-written SQL.
- **Migrations** that are deterministic and idempotent. Running the generator twice creates one migration.
- **A JSON:API 1.0 server** with filtering, sorting, sparse fieldsets, `include`, pagination, and standard errors.
- **OPAQUE authentication**: registration and login, with the password never leaving the client.
- **Owner-based authorization** with per-row visibility, sharing, roles, inherited access, and audit trails.
- **Opt-in request signing** for operations that need stronger proof than a session.
- **A browser-safe client** for browsers, Bun, and Node at `resource-server/client`.

## Quick start

```bash
bun add github:<your-user>/resource-server

# 1. Generate migrations for your schemas.
bun resource-server init schemas

# 2. Add the printed OPAQUE_SERVER_SETUP line to .env.
# 3. Apply migrations and start the server.
bun resource-server serve
```

`init` writes into `.resource-server/` by default:

- `migrations/` — generated SQL and `schema-state.json`, which records what exists so the next `init` writes only the difference. **Commit it.**
- `config.json` — the schema paths and their fingerprint. **Commit it.**

It also prints the environment settings. `OPAQUE_SERVER_SETUP` is created only when none is set, and is never replaced, because replacing it would lock out every registered user.

`serve` applies pending migrations and starts the server. It refuses to start if the schemas no longer match what `init` recorded, so **after any schema change or package upgrade, run `init` again**.

| Setting | Default | Meaning |
| --- | --- | --- |
| `DB_PATH` | `.db` | Database file |
| `PORT` | `5734` | HTTP port |
| `SCHEMA_DIR` | `./schemas` | Schema folder |
| `SERBER_ADMINS` | — | Usernames that always hold the admin role |
| `MIGRATE_ON_START` | `true` | Set to `false` to apply migrations yourself |

## A schema

A schema is a JSON Schema object. The `title` becomes the snake_case table name.

Schemas are written as `.json`, `.yaml`, or `.yml` files:

- `.json` files hold exactly one schema object.
- `.yaml`/`.yml` files may hold several schemas, one per `---` document; each document is named by its `title`, not by the file name.
- A schema folder is read one level deep (subfolders are not loaded), and file names never affect table names.
- `$ref` to another file (`$ref: email.yaml`) or to `$defs` (`$ref: "#/$defs/count"`) is resolved when the schema is loaded. Circular references fail.
- `*.test.json`/`*.test.yaml` files, dotfiles, `README*`, and `LICENSE*` are skipped.
- Anything else in a schema folder fails loudly, as does a JSON or YAML file whose top level is not a schema object. Missing schema files were the reason `init` once reported fewer tables than you wrote.

A nullable property is written with `required` — not with a union — because a union-typed column still needs one SQLite type. `type: ["integer", "null"]` collapses to `integer`, `["null", "string"]` to `string`, in properties, nested `properties`, and `items` alike. Unions with two or more non-null types, or with only `"null"`, fail loudly.

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
    "tag": { "table": "tag", "column": "id", "cardinality": "many" }
  },
  "x-access": {
    "read": "public",
    "defaultVisibility": "public"
  }
}
```

This produces:

- the `article` table, with `id`, `updated_at`, and `owner` injected;
- the `article_tag` join table, with its own columns, trigger, and view;
- `article_view`, which embeds related rows as JSON;
- the `/article` JSON:API resource, with a `tag` relationship.

Every table gets three columns you do not declare:

| Column | Meaning |
| --- | --- |
| `id` | UUIDv7 primary key, exposed as a canonical string |
| `updated_at` | Unix milliseconds, refreshed by a trigger |
| `owner` | Nullable user foreign key, set by the server |

## Special keywords

Plain JSON Schema describes data. Serber adds a small set of `x-` keywords for everything a database and API need to know.

| Keyword | Effect |
| --- | --- |
| `title` | Table name after snake_case conversion |
| `type` | Base SQLite type; must be `object` for a table |
| `properties` | Columns |
| `required` | `NOT NULL` constraints |
| `default` | Column default |
| `format` | Specialized type: `uuid`, `date-time`, `byte`, `email` |
| `enum` | Text column with an allowed-value set |
| `x-unique` | Unique constraint |
| `x-primary` | Custom primary key |
| `x-unique-constraints` | Unique constraints over column groups |
| `x-relations` | Relations; see below |
| `x-view` / `x-source` | Authored read-only view; see below |
| `x-access` | Reads, creates, visibility, sharing, signing, roles, audit |
| `x-exposed` | `false` hides a table, column, or relation |
| `x-system` | Marks a schema that is always loaded |

Type mapping:

| JSON Schema | SQLite |
| --- | --- |
| `string` | `text` |
| `string`, `format: uuid` | `blob`, default `uuid7()` |
| `string`, `format: date-time` | `integer` timestamp |
| `string`, `format: byte` | `blob` |
| `integer` | `integer` |
| `number` | `real` |
| `boolean` | `integer` |
| `object`, `array` | `text` JSON |
| `enum` of strings | `text` with enum typing |
| `[T, "null"]` | collapses to `T`; nullability comes from `required` |

The keyword set is allowlisted. Unknown keywords, duplicate titles, missing relation targets, and conflicting constraints fail before any SQL runs. See [Schema reference](doc/schema-reference.md).

## Relations

Relations live under `x-relations`. A relation is declared from one side; the generator derives the storage.

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
      "through": "user_group_membership"
    }
  }
}
```

- **`one`** adds a foreign-key column named `<target_table>_<target_column>` (`user_id`), indexed and nullable unless `required: true`.
- **`many` with an inverse `one`** is one-to-many. Only the `one` side creates storage; no join table is made.
- **`many` without an inverse `one`** is many-to-many. A join table named after the sorted endpoint pair is derived (`article_tag`), deduplicated when both sides declare the relation.

`through`, `foreignKey`, `onDelete`, and `onUpdate` override the defaults. A self-referential many-to-many relation gets `<table>_<label>` with `related_<table>_id` for the other side. Cyclic foreign keys are rejected.

Each table also gets a `<table>_view`. `one` relations are nested JSON objects or `null`; `many` relations are JSON arrays. The API reads views, so requests do not join base tables.

## Views

A schema with `x-view: true` is an authored, read-only resource over a base table. It selects the fields and relations it needs; the base table stays unchanged.

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

- `title` becomes the view name (`article_card`) and the `/article_card` resource.
- Every property has an `x-source` path from the base table. Paths follow relations: `article.author.name` reads a related column.
- A path ending at a column is an attribute; one ending at a relation is a JSON:API relationship. Relation paths with a `many` step need `type: array`.
- `id`, `owner`, and `visibility` are required and must come straight from the base row, so visibility rules still apply.
- Views are read-only: `GET`, `HEAD`, and `OPTIONS` are served, writes return `405`, and `x-relations`, `shareable`, `inherit`, and `create` are rejected. They cannot read hidden tables, columns, relations, or join tables.

## Access control

Every resource can carry `x-access`. All keys are optional; the defaults are secure.

```json
{
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
}
```

- The **owner** is the signed-in creator. Clients cannot set it.
- **Visibility** is `private` (owner only), `shared` (owner plus grantees), `authenticated` (any signed-in user), or `public`.
- **`shareable: true`** derives a `<table>_share` table so owners can grant read or write access to users and groups.
- **`signed`** requires Ed25519-signed requests for the listed operations, for example payments.
- **`roles`** grants named roles access to operations on every row, whoever owns it.
- **`inherit`** lets readers of a to-one parent read the child row, up to three levels.
- **`audited`** records writes in the admin-only `audit_log` in the same transaction.

Signed requests add `x-serber-timestamp`, `x-serber-nonce`, and `x-serber-signature` headers. The signature covers the method, path, session, timestamp, nonce, and body digest. Sent signatures are always verified; used nonces are stored until they expire.

See [Access control](doc/access-control.md) for the full matrix, roles, inheritance, audit format, and signing message.

## Using the library

The package ships a browser-safe client. It runs the OPAQUE exchange, persists the session, and adds bearer and signature headers.

```ts
import { createResourceServerClient } from 'resource-server/client'

const client = createResourceServerClient({ baseUrl: 'https://api.example.com' })

// Registers and logs in, saving the session.
await client.register({
  username: 'alice',
  password: 'correct horse battery staple',
})

const article = await client.post('/article', {
  data: { type: 'article', attributes: { heading: 'Hello' } },
})

// Resources with x-access.signed require signed writes.
await client.post('/payment', payment, { signed: true })
```

The client works in browsers, Bun, and Node. It persists the session in `localStorage` by default; pass `storage: null` for memory only, or a custom adapter. `register({ signIn: false })` creates the account without logging in. Signing is opt-in per request via `{ signed: true }` or globally via `autoSign`.

See [Client](doc/client.md) for sessions, storage, signing, and errors.

## API at a glance

```text
GET, HEAD /                                resource catalog
GET, HEAD /:type                           collection
POST /:type                                create
GET, HEAD /:type/:id                       single resource
PUT /:type/:id                             replace
PATCH /:type/:id                           update
DELETE /:type/:id                          delete
GET, HEAD /:type/:id/:rel                  related resource or collection
GET, HEAD /:type/:id/relationships/:rel    relationship linkage
PATCH|POST|DELETE /:type/:id/relationships/:rel   change linkage
OPTIONS on every path                      advertised methods
```

Authentication has its own plain-JSON surface under `/key` (`POST`, `GET`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`).

Collections support:

- `page[number]` and `page[size]` (default `20`, maximum `100`);
- `sort=field,-other`;
- `filter[field]=value`, plus `filter[field][operator]=value` with `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in`, `nin`, `contains`, `starts`, `ends`, and `null`;
- `filter[rel.field]=value` on related resources (up to three steps), matching only related rows the viewer may read;
- `fields[type]=a,b` for sparse fieldsets;
- `include=rel` or a nested path such as `include=article.tag` (up to three steps).

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

Invalid requests return `400`, unknown resources return `404`, failed auth returns `401`, and constraint violations return `409`. Every JSON:API response uses `application/vnd.api+json`; auth success bodies use `application/json`.

## Documentation

- [Architecture](doc/architecture.md) — generation pipeline, runtime, routes, and failure behavior.
- [Data model](doc/data-model.md) — injected columns, system tables, relations, views, and the hidden key store.
- [Schema reference](doc/schema-reference.md) — every supported keyword, relations, and validation rules.
- [Access control](doc/access-control.md) — visibility, sharing, roles, inheritance, audit, and signing.
- [API](doc/api.md) — endpoints, queries, writes, status codes, and errors.
- [Authentication](doc/auth.md) — OPAQUE flows, key rows, sessions, and keypairs.
- [Client](doc/client.md) — registration, login, sessions, storage, requests, and signing.
- [Security](doc/security.md) — threat model, non-repudiation, and key handling.
- [Roadmap](doc/roadmap.md) — phases, deliverables, and exit criteria.
- [Development](doc/development.md) — setup, commands, migrations, tests, and conventions.

## Development

```bash
bun install
bun run db:generate   # build the schema and generate a migration
bun run db:migrate    # apply migrations
bun run db:reset      # rebuild the development database
bun test              # run the suite
bunx tsc --noEmit     # type-check
bun run dev           # start with watch mode
```

Tests run against in-memory databases built from every migration, so they do not touch the development `.db`. See [Development](doc/development.md).

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

## Status

Early development. Complete: schema generation, relations, views, migrations, JSON:API, OPAQUE authentication, and owner-based authorization with sharing, roles, inheritance, audit, and signing.

Remaining: key rotation and revocation, moderation of inherited rows by the parent's owner, and operational hardening. See [Roadmap](doc/roadmap.md).
