# Development

## Requirements

- Bun 1.4 or newer;
- a writable directory for the SQLite/Turso database;
- an OPAQUE server setup value.

## Install

```bash
bun install
```

## Environment

Create `.env` in the project root:

```bash
DB_PATH=.db
PORT=5734
OPAQUE_SERVER_SETUP=...
```

Optional:

```bash
SCHEMA_DIR=./schemas      # directory of .json or .yaml schema files
SERBER_ADMINS=alice,bob   # usernames that always hold the admin role
MIGRATE_ON_START=true     # set to false to apply migrations yourself
```

`.env` is gitignored. Never commit server secrets.

Generate a server setup once:

```bash
bunx @serenity-kit/opaque create-server-setup
```

`OPAQUE_SERVER_SETUP` is required by `src/server/index.ts`. The server throws at
startup if it is missing.

## Commands

When Serber is installed as a library in another project:

```bash
# generate migrations from a schema folder or files
bun resource-server init schemas

# apply migrations and start the server
bun resource-server serve
```

`init` writes `.resource-server/migrations/`, `.resource-server/config.json`,
and generated working files. `serve` refuses to start when the schemas no longer
match the recorded fingerprint, so run `init` again after a schema change.

For developing the library itself:

```bash
# write a migration for any schema change
bun run db:generate

# apply migrations
bun run db:migrate

# reset the development database and migration baseline
bun run db:reset

# run all tests (`bun run test` generates the migrations first; plain `bun test`
# needs `bun run db:generate` once, because .migrations is git-ignored)
bun test

# type-check
bunx tsc --noEmit

# run the API server with watch mode
bun run dev

# run the API server once
bun run start
```

## Database and migrations

The database file is `DB_PATH` (default `.db`). `bun run db:generate` writes a
migration into `.migrations/<timestamp>_<name>/migration.sql` and records what
the database now contains in `.migrations/schema-state.json`. Applied migrations
are immutable. Do not edit the generated files by hand.

`bun run db:generate`:

1. loads and builds the schema;
2. compares the tables, triggers and views with the recorded state;
3. writes a migration with the difference, or nothing if there is none:
   new tables are created, a changed table is rebuilt keeping the rows of the
   columns it still has, and removed tables are dropped;
4. drops and recreates views and triggers around any table change, because
   SQLite checks them when a table is renamed;
5. updates the recorded state.

`bun run db:migrate` applies the migrations not yet recorded in the `__migrations`
table. Each runs in one transaction with foreign keys off, so rebuilding a
table does not cascade deletes into its children.

Running it twice with unchanged schemas must not create a second migration.

`bun run db:migrate` applies pending migrations. Running it twice must succeed.

`bun run db:reset` removes the development database and migration baseline. Use
it only when you intentionally want to rebuild from scratch.

### Foreign keys

SQLite disables foreign-key enforcement unless it is enabled per connection.
The application enables it in `src/helper/loadDb.ts`:

```sql
PRAGMA foreign_keys = ON
```

The test harness does the same after connecting. Without it, `ON DELETE SET
NULL`, `ON DELETE RESTRICT`, and owner-to-user checks would not run.

## Tests

```bash
bun test
```

The suite includes:

- schema building, relation derivation, views, custom DDL, and migrations;
- idempotent generation and migration application;
- `x-exposed` behavior for tables, columns, relations, and join tables;
- owner column injection, user foreign key, index, validation, and
  `ON DELETE SET NULL`;
- JSON:API documents, queries, writes, `HEAD`, and `OPTIONS`;
- OPAQUE registration, login, sessions, unknown users, expiry, replay, and
  keypair freshness;
- auth route validation and hidden key status;
- access control: visibility, sharing, roles, inheritance, audit, and signing;
- the browser-safe client: auto-login, storage, expiry, signed requests, and
  portability.

Most `spec/` tests create an in-memory Turso database, apply every migration in
sorted order, build the schema, and call the Hono app through
`app.request(...)`. `spec/helpers/test-server.ts` provides the harness;
`spec/helpers/auth-client.ts` provides OPAQUE client helpers.

Tests do not use the development `.db` file, so they can run while the dev
server is open.

### Adding auth coverage

Use the helpers instead of reimplementing OPAQUE:

```ts
import { login, register } from './helpers/auth-client.ts'

const { userId } = await register(app, {
  username: 'alice',
  // email is optional and not part of registration
  password: 'correct horse battery staple',
})

const { sessionKey, finish } = await login(app, {
  username: 'alice',
  password: 'correct horse battery staple',
})
```

For expiry and purge tests, update `key.expires_at` directly through the test
row database.

## Adding a schema

1. Add `src/schema/<name>.yaml` holding a JSON Schema object.
2. Use a unique `title`; it becomes the snake_case table name.
3. Declare relations under `x-relations`.
4. Run `bun run db:generate`.
5. Inspect the generated migration.
6. Run `bun run db:migrate`.
7. Add seed and API tests if the resource should be user-visible.

The generator injects `id`, `updated_at`, and `owner`, so do not add them unless
you need explicit control.

### Hiding a resource or field

Set `"x-exposed": false` on the table, property, or relation. Hidden targets
automatically hide relations that point at them. Hidden resources are absent
from the catalog, views, queries, mutations, and generic routes.

The `key` table is hidden this way. If you add another hidden table, expose it
through a dedicated service and route in `src/server/app.ts`, before the generic
`/:type` routes.

## Server startup

`src/server/index.ts`:

1. loads `.env`;
2. requires `OPAQUE_SERVER_SETUP`;
3. builds the schema from all system and user schemas;
4. opens the Turso database with foreign keys enabled;
5. creates the Hono app with the built schema, row database, and OPAQUE setup;
6. serves it on `PORT` (default `5734`).

`createApp` accepts an optional `opaqueServerSetup`. Without it, auth routes are
not registered, which keeps auth-free unit tests simple.

## Conventions

- JSON Schema is the source of truth.
- Table and column names are snake_case.
- IDs are UUIDv7 blobs, exposed as canonical strings.
- Every table has `id`, `updated_at`, and `owner`.
- Generated files are not edited by hand.
- Applied migrations are immutable.
- Auth state is persisted in the key table; no in-memory sessions.
- Auth success bodies are plain JSON; errors use JSON:API.
- Owner references must be users, never groups.
- `key.user` uses `RESTRICT` to preserve key attribution.
- `owner` uses `SET NULL` to preserve rows when a user is deleted.

## Troubleshooting

### `OPAQUE_SERVER_SETUP is required`

Add the variable to `.env` and restart the server.

### Database is locked

The dev server holds the development `.db` file. Tests use `:memory:` and do
not touch it. If you run migration commands while the dev server is open, stop
the server first.

### A migration did not change

Custom DDL only generates a migration when its hash changes. Confirm that the
generated SQL actually differs. Applied migrations are never rewritten.

### Foreign keys are not enforced

Check that the connection executed `PRAGMA foreign_keys = ON`. The app does this
in `loadDb.ts`; custom connections must do it themselves.

### Login always returns 401

Check that:

- the registration flow finished successfully;
- the key row still exists and has not expired;
- the client uses the same password and OPAQUE state;
- `OPAQUE_SERVER_SETUP` did not change between registration and login.

Changing the server setup invalidates existing registration records.
