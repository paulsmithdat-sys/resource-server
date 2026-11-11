# Security model

This document covers the cross-cutting security model: how keys are owned, what
a signature proves, and which threats the system mitigates. The OPAQUE flows,
session lifecycle, and key rows are documented in [auth.md](./auth.md); row-level
rules are in [access-control.md](./access-control.md).

## OPAQUE

OPAQUE is used so that a password is never transmitted to the server.

1. **Registration:** the client starts OPAQUE registration; `POST /key` creates a
   pending key row and returns the registration response; `PATCH /key/:id`
   consumes the pending row, inserts the user, and stores the registration
   record.
2. **Login:** `POST /key` creates a pending login row and returns the login
   response; `PATCH /key/:id` consumes the login state, verifies the exchange,
   and creates a session row.
3. **Session:** the raw OPAQUE session key is stored in the session key row.
   Sessions expire after 24 hours and there is no refresh flow.

All temporary state is persisted in the hidden `key` table. Unknown usernames
receive the same login-start response shape as known ones and fail with `401` at
finish. Expired rows are purged automatically.

See [auth.md](./auth.md) for the complete route bodies and lifecycle.

## tweetnacl and JWK

Tweetnacl provides the Ed25519 keypair operations used by the auth flow.

- A user owns one or more keys.
- Each key is stored as a JWK.
- JWK keypairs are generated on both sides for every registration and login.
- The registration server private key is ephemeral and discarded.
- The login server private key and client public key are copied into the session
  row.
- Login and session keypairs are discarded when the session row expires or is
  deleted.
- Keys can be long-term or session-scoped.

Keys are owned by users, never by groups. This preserves the link between a
signature and the identity that owned the key.

## Request signing

Request signing is opt-in per resource through `x-access.signed`. A signed
request proves possession of the session's client private key and covers the
method, path, body, session, timestamp, and a single-use nonce. Sent signatures
are always verified; used nonces are stored until they expire. See
[access-control.md](./access-control.md#signed-requests).

## Non-repudiation

Non-repudiation requires that:

- a key remains attributable to its owner;
- deleting a user does not silently erase key history;
- signatures can be verified later;
- key rotation is explicit and auditable.

This is why the default `Key.user` foreign key uses `onDelete: "restrict"`
rather than cascade. Soft-deletion and key revocation APIs remain future work.

## Authorization and sharing

Authorization is owner-based with per-row visibility and optional sharing to
users and groups. Roles grant operations across rows, inheritance follows a
to-one parent for reads, and audited writes append to `audit_log` in the same
transaction. See [access-control.md](./access-control.md).

## Threat model

| Threat | Mitigation | Status |
| --- | --- | --- |
| Plaintext password theft | OPAQUE; passwords never sent | Implemented |
| Replay attacks | One-time consume, OPAQUE exchange, short-lived pending state | Implemented |
| Session key theft | 24-hour sessions, hashed tokens, delete endpoint, automatic purge | Implemented |
| Forged or replayed signed requests | Ed25519 signatures with timestamp and single-use nonce, per resource | Implemented (opt-in) |
| Privilege escalation | Centralized owner, visibility, role, and share checks | Implemented |
| SQL injection | Parameterized queries, no raw user SQL | Implemented |
| Schema injection | AJV validation and an allowlisted keyword set | Phase 7 |
| Migration corruption | Immutable applied migrations, custom-DDL hashes | Implemented |
| Credential stuffing | Per-user and per-client login rate limiting with lockout | Implemented |
| Data loss | Backups, WAL, migration tests | Phase 8 |
| Token or cost blowup | Schema-only authoring and generated code | Phase 7 |

## Known gaps

- No key rotation or revocation API.
- No multi-device session management or refresh tokens.
- The audit trail is append-only through the API but is not protected by
  database triggers.
- A parent's owner cannot moderate inherited child rows they do not own.
