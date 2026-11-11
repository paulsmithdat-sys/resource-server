# Access control

Every resource can carry an `x-access` object. All keys are optional; leaving a
key out gives the secure default shown below.

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
| `create` | `session` | `public`: anonymous requests may create rows, which have no owner. `role`: only holders of a role that grants `create` may create rows |
| `visibility` | all values except `shared` (plus `shared` when shareable) | The values an owner may choose, enforced by a CHECK constraint |
| `defaultVisibility` | `private` | The visibility a new row gets |
| `shareable` | `false` | `true` derives a `<table>_share` table so owners can grant access to users and groups |
| `signed` | `false` | `true`, or a list of `read`, `create`, `update`, `delete`, requires signed requests for those operations |
| `roles` | `{}` | Role name → operations (`true` for all); holders may perform them on every row, whoever owns it |
| `inherit` | none | Label of a to-one relation: whoever can read that parent row can read this row |
| `audited` | `false` | `true`, or a list of operations, records each one in `audit_log` |

## What reaches SQL

The generator emits:

- `owner` and `visibility` columns on every exposed table, with the allowed
  values as a CHECK constraint and the default as the column DEFAULT;
- one `<table>_share` table per shareable resource;
- the system `request_nonce` table for signed requests;
- the system `user_role` and `audit_log` tables.

`read`, `create`, and `signed` are applied by the server per request. Share,
role, and audit data are queried at request time.

## Rules

The owner is the signed-in creator and can never be set by a client. Updates
need ownership or a write share; deletes, visibility changes, and share
management need ownership.

A row is readable:

- by its owner;
- by anyone if its visibility is `public`;
- by any signed-in user if its visibility is `authenticated`;
- by users and group members holding a read share if its visibility is `shared`.

Related rows embedded in a response follow the same rule. Inherited reads are
checked through the parent relation.

A share row names exactly one user or one group and grants `can_read`,
`can_write`, or both. Permissions from several shares combine. Shares only apply
while the row's visibility is `shared`. A write-only sharer receives `204` from
updates instead of a copy of the row.

Anonymous creates link only to public rows. A row created anonymously with
`private` visibility is effectively write-only.

## Roles

A user holds a role through a row in the system `user_role` resource, which only
admins can create, read, or delete. Usernames listed in `SERBER_ADMINS` always
hold `admin`, which is how the first admin is set up. Groups never confer roles.

A resource's `roles` map grants named roles operations on every row:

```json
"x-access": {
  "roles": { "admin": true, "moderator": ["read", "update"] }
}
```

## Inherited access

With `"inherit": "chat"` on `message`, a message is readable by everyone who can
read its chat, with no share per message. To create a row under a parent it
inherits from, or to move it there, the writer must be able to write to that
parent. Updating and deleting the row still need ownership of the row itself.
Inheritance is followed for at most three levels.

Inheritance is followed for reads only. A parent's owner cannot moderate
children they do not own; that remains future work.

## Audit trail

Audited writes insert a row into the system `audit_log` resource in the same
transaction as the change, so neither happens without the other. A row records
the actor, action, resource, row id, time, and the request signature when the
request was signed.

Logins and failed logins are always recorded. Only admins can read the log, and
nobody can create, change, or delete entries through the API.

## Signed requests

A resource can require signing per operation:

```json
"x-access": { "signed": ["create", "update", "delete"] }
```

`"signed": true` requires it for every write. Requests that are not signed when
signing is required fail with `401`. A signature that is present is always
checked, even where signing is not required.

Signed requests add three headers to a session request:

| Header | Value |
| --- | --- |
| `x-serber-timestamp` | Unix time in milliseconds, within 60 s of the server clock |
| `x-serber-nonce` | 16–128 URL-safe random characters, never reused by a session |
| `x-serber-signature` | base64url Ed25519 signature, made with the private key whose public key was sent as `clientPublicKey` at login |

The signed message is these lines joined by `\n`:

```text
serber-signature-v1
<METHOD>
<path with query string>
<session id, lowercased>
<timestamp>
<nonce>
<base64url SHA-256 of the body>
```

Used nonces are stored in `request_nonce` until they expire, which blocks
replay. `clientPublicKey` is optional at login; a session without one cannot
make signed requests.

The browser-safe client signs automatically when asked:

```ts
await client.post('/payment', payment, { signed: true })
```

See [client.md](./client.md) for the client-side signing API.

## Failure behavior

| Condition | Response |
| --- | --- |
| No session where one is required | `401` |
| Invalid, expired, or consumed session | `401` |
| Missing or invalid signature when required | `401` |
| Signature timestamp outside the window | `401` |
| Reused nonce | `401` |
| Authenticated but not allowed | `404` for unreadable rows, `403` for a forbidden operation |
| Constraint violation | `409` |
