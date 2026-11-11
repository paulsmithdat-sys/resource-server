# Data model

Every table in Serber is generated from a JSON Schema. The generator injects
the default columns, derives relations and join tables, and creates one view per
table. System schemas define users, groups, the hidden key store, roles, audit
entries, request nonces, login limits, and the stored schema catalog.

## Default columns

Every table, including derived join tables, receives:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `blob` primary key | Defaults to `uuid7()`; exposed as a canonical UUID string |
| `updated_at` | `integer` timestamp | Defaults to the current time; refreshed by a trigger |
| `owner` | `blob`, nullable | Foreign key to `user.id`, indexed, `ON DELETE SET NULL` |

Every exposed table also receives `visibility`, a text column with the values
allowed by its `x-access.visibility` and a SQL CHECK constraint. Hidden tables do
not get it. See [access-control.md](./access-control.md).

### `id`

UUIDv7 is stored as a 16-byte blob. Views format it as a canonical lowercase UUID
string, and the API uses that string in documents and path parameters. A client
may supply its own canonical UUID on create.

### `updated_at`

`updated_at` is stored as Unix milliseconds. A per-table trigger sets it to the
current time on every update. `created_at` is omitted because UUIDv7 already
contains a timestamp.

### `owner`

`owner` records which user owns a row. It is:

- nullable, so rows can exist before authentication or without an owner;
- a UUID foreign key to `user.id` only, never to `user_group.id`;
- indexed on every table;
- declared with `ON DELETE SET NULL`, so deleting a user preserves the row;
- exposed as a normal JSON:API attribute, not as a relation.

Because `user` is itself a table, `user.owner` is a self-referencing foreign key
to `user.id`. This allows one user row to point at another without a special
case in the generator.

The `owner` attribute is read-only. The server sets it to the signed-in creator;
a value sent by a client is ignored. A row created anonymously has no owner.

Authorization is owner-based, with per-row visibility, shares, roles, and
inheritance. See [access-control.md](./access-control.md).

## System schemas

System schemas are always loaded, even when application schemas change.

### `user`

| Column | Type | Notes |
| --- | --- | --- |
| `username` | text | Unique, 1–100 characters |
| `email` | text | Optional, freeform, up to 255 characters (not used for registration, not unique, not verified) |
| `display_name` | text | Optional, up to 100 characters |
| `owner` | blob | Injected self-reference to `user.id` |

Relations:

- `groups` — many-to-many through `user_group_membership`;
- `keys` — one-to-many, but effectively hidden because the `key` table is hidden.

Registration creates the user row with the pre-generated UUID used as the OPAQUE
`userIdentifier`, and sets `owner` to that same id.

### `user_group`

| Column | Type | Notes |
| --- | --- | --- |
| `name` | text | Unique, 1–100 characters |
| `description` | text | Optional, up to 500 characters |

Groups have many users through the derived `user_group_membership` join table.
Groups can receive shares on shareable resources. Membership never confers a
role: roles come from `user_role` and are managed by admins. Sharing and roles
are described in [access-control.md](./access-control.md).

### `key`

The `key` table is the persistent store for all authentication state. It is
marked `"x-exposed": false`, so it has no generic JSON:API resource, no public
view, and no catalog entry. Auth routes are the only access path.

Columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | blob | Key row UUID |
| `updated_at` | integer | Last update timestamp |
| `owner` | blob | Owning user, when known |
| `type` | text | `jwk`, `opaque_registration`, `opaque_login_state`, or `session` |
| `jwk` | text JSON | Server-side JWK or client public JWK, depending on type |
| `client_jwk` | text JSON | Client public JWK for login and session rows |
| `material` | text | OPAQUE registration record, login state, or session key |
| `expires_at` | integer | Expiry for temporary state |
| `consumed_at` | integer | When one-time state was consumed |
| `user_id` | blob | Foreign key to `user.id` |

Relations:

- `user` — `one`, foreign key `user_id`, `ON DELETE RESTRICT`.

The `user` relation is `RESTRICT` rather than `SET NULL` because key history must
remain attributable. Deleting a user with key rows therefore fails until those
rows are removed. This is deliberate for non-repudiation.

#### Key row types

| Type | Lifetime | `material` | `jwk` | `client_jwk` |
| --- | --- | --- | --- | --- |
| `opaque_registration` (pending) | 10 minutes | Pending user metadata JSON | Client public JWK | — |
| `opaque_registration` (finished) | Permanent record | OPAQUE registration record | Client public JWK | — |
| `opaque_login_state` | 10 minutes | OPAQUE `serverLoginState` | Server private JWK | Client public JWK |
| `session` | 24 hours | Raw OPAQUE `sessionKey` | Server private JWK | Client public JWK |

Pending and finished registration rows both use `type = 'opaque_registration'`.
They are distinguished by `consumed_at` and `expires_at`:

- pending: `consumed_at` is `NULL`, `expires_at` is set;
- finished: `consumed_at` is set, `expires_at` is `NULL`, `user_id` is set.

Login state rows are one-time values. Successfully finishing a login sets
`consumed_at` and creates a new `session` row in the same transaction.

### `schema`

| Column | Type | Notes |
| --- | --- | --- |
| `table_name` | text | Unique, 1–100 characters |
| `jsonschema` | text JSON | The stored schema document |

This table is available for a schema catalog used by the API and the AI
workflow. It is not yet populated automatically.

### `user_role`

| Column | Type | Notes |
| --- | --- | --- |
| `role` | text | Role name as used in `x-access.roles` |
| `user_id` | blob | Foreign key to `user.id`, required, `ON DELETE CASCADE` |

The pair `(user_id, role)` is unique. Only admins can create, read, or delete
rows. Usernames in `SERBER_ADMINS` always hold `admin`.

### `audit_log`

| Column | Type | Notes |
| --- | --- | --- |
| `actor` | blob | User who performed the action, when signed in |
| `action` | text | `create`, `update`, `delete`, `login`, or `login_failed` |
| `resource` | text | Resource type acted on |
| `resource_id` | blob | Id of the row acted on |
| `signature` | text | Request signature, when the request was signed |

Written by the server inside the same transaction as the audited change.
Append-only, readable by admins.

### `request_nonce`

Hidden table of nonces used by signed requests, with a unique
`(session_id, nonce)` pair and an expiry. See
[access-control.md](./access-control.md#signed-requests).

### `auth_limit`

Hidden table of login rate-limit counters and lockouts, keyed by a string such
as `user:alice`, so every server process shares the same limits.

## Derived join tables

A many-to-many relation without an inverse `one` produces a join table. For
example:

```json
{
  "x-relations": {
    "tag": { "table": "tag", "column": "id", "cardinality": "many" }
  }
}
```

produces `article_tag`:

- `id`, `updated_at`, and `owner`;
- `article_id` and `tag_id`, both `NOT NULL`;
- foreign keys to the two endpoints;
- a unique constraint on the pair;
- its own trigger and view.

Join-table names are derived from the two endpoints unless `through` overrides
the name. Duplicate join tables are deduplicated. If an endpoint table or the
relation itself is hidden, the join table is hidden too.

## Views

Every exposed table gets a `<table>_view` view. Views:

- expose `id` and `updated_at`;
- expose normal columns, including `owner`;
- format UUID blobs as canonical UUID strings;
- format JSON columns as JSON values;
- embed `one` relations as nested JSON objects;
- embed `many` relations as JSON arrays;
- include `null` for missing nullable UUIDs;
- omit hidden columns and hidden relations.

The API reads views, never the base tables, for GET requests.

## Foreign keys and deletion

SQLite foreign-key enforcement is enabled with `PRAGMA foreign_keys = ON` when
the application opens its database and in the test harness. Without this pragma,
SQLite would silently skip foreign-key checks.

Deletion behavior:

- `owner` references use `ON DELETE SET NULL`;
- the `key.user` relation uses `ON DELETE RESTRICT`;
- derived join-table rows are removed by the write layer when a resource is
  deleted, and their endpoint foreign keys are enforced.

## Hidden resources

`"x-exposed": false` hides a table from:

- the resource registry and catalog;
- generated views and queries;
- generic read, write, and delete endpoints;
- relations in other resources that target the hidden table.

The `key` table is the built-in example. It still exists in the database, but it
is reachable only through the auth service and `/key` routes. See
[auth.md](./auth.md).
