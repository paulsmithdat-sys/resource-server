# Authentication

Serber uses OPAQUE for password-authenticated key exchange and Ed25519 JWKs
from tweetnacl for authentication keypairs. The application is stateless: every
temporary value lives in the hidden `key` table, not in process memory.

There is no `/auth` namespace. Authentication uses `/key`, because the
persisted state is a key row and the REST paths map directly to that table.

Applications normally use the browser-safe client rather than calling these
routes directly. See [client.md](./client.md) for `register()`, `login()`, and
session storage.

## Goals and non-goals

Implemented:

- OPAQUE registration and login;
- a single `/key` surface for both flows;
- server-side OPAQUE setup from the environment;
- registration records, login state, and sessions persisted in the key table;
- one-time consumption of registration and login state;
- 24-hour sessions with no refresh flow;
- Ed25519 keypairs generated for every flow;
- automatic purging of expired rows;
- per-user and per-client login rate limiting with temporary lockout;
- request signing with the session's client key;
- owner-based authorization.

Not implemented yet:

- refresh tokens;
- multi-device session management;
- key rotation and revocation APIs.

## Key row lifecycle

The `key` table stores four kinds of rows. See
[data-model.md](./data-model.md#key) for the columns.

### Pending registration

Created by `POST /key` with `"type": "opaque_registration"`.

| Field | Value |
| --- | --- |
| `type` | `opaque_registration` |
| `jwk` | Client public JWK |
| `material` | Pending username, display name, and future user id |
| `expires_at` | Now + 10 minutes |
| `consumed_at` | `NULL` |
| `user_id` | `NULL` |
| `owner` | `NULL` |

The response includes the OPAQUE `registrationResponse` and the server's
ephemeral public JWK.

### Finished registration

The same row after `PATCH /key/:id` with `registrationRecord`.

| Field | Value |
| --- | --- |
| `type` | `opaque_registration` |
| `jwk` | Client public JWK |
| `material` | OPAQUE registration record |
| `expires_at` | `NULL` |
| `consumed_at` | Finish time |
| `user_id` | New user id |
| `owner` | New user id |

Finishing atomically:

1. consumes the pending row with `UPDATE ... RETURNING`;
2. inserts the user with the pre-generated UUID;
3. stores the registration record and links the key row to the user.

The registration server keypair is ephemeral. Its private key is discarded; only
the public key is returned to the client.

### Pending login

Created by `POST /key` with `"type": "opaque_login_state"`.

| Field | Value |
| --- | --- |
| `type` | `opaque_login_state` |
| `jwk` | Server private JWK |
| `client_jwk` | Client public JWK |
| `material` | OPAQUE `serverLoginState` |
| `expires_at` | Now + 10 minutes |
| `consumed_at` | `NULL` |
| `user_id` | User id, or `NULL` for an unknown username |
| `owner` | User id, or `NULL` for an unknown username |

### Session

Created by a successful `PATCH /key/:id` with `finishLoginRequest`.

| Field | Value |
| --- | --- |
| `type` | `session` |
| `jwk` | Server private JWK copied from the login state |
| `client_jwk` | Client public JWK copied from the login state |
| `material` | Raw OPAQUE `sessionKey` |
| `expires_at` | Now + 24 hours |
| `consumed_at` | `NULL` |
| `user_id` | Authenticated user id |
| `owner` | Authenticated user id |

The session response includes the server public JWK, the user id, and expiry.
The client keeps its `sessionKey` and its own private key locally. Applications
typically store the session key in `localStorage`; the provided client does this
automatically.

There is no refresh flow. When the session expires, a new login is required.

## Registration flow

```text
client                                      server
  |                                            |
  | opaque.client.startRegistration(password)   |
  |------------------------------------------->|
  | POST /key                                  |
  | { type: "opaque_registration",             |
  |   username, displayName,                   |
  |   registrationRequest, clientPublicKey }   |
  |                                            | validate fields
  |                                            | check unique username
  |                                            | create pending key row
  |                                            | create user id (UUIDv7)
  |                                            | OPAQUE registration response
  |                                            | generate ephemeral server JWK
  |<-------------------------------------------|
  | 201 { id, type, expiresAt,                 |
  |       registrationResponse, serverPublicKey}
  |                                            |
  | opaque.client.finishRegistration(...)      |
  |------------------------------------------->|
  | PATCH /key/:id                             |
  | { registrationRecord }                     |
  |                                            | consume pending row
  |                                            | insert user
  |                                            | store registration record
  |<-------------------------------------------|
  | 200 { id, type, userId, consumedAt }       |
```

### Start registration

```http
POST /key
Content-Type: application/json

{
  "type": "opaque_registration",
  "username": "alice",
  "displayName": "Alice",
  "registrationRequest": "...",
  "clientPublicKey": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "..."
  }
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /key/0190c9d2-...
Content-Type: application/json

{
  "id": "0190c9d2-...",
  "type": "opaque_registration",
  "expiresAt": "2026-11-08T12:40:00.000Z",
  "registrationResponse": "...",
  "serverPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." }
}
```

Validation:

- `username`: 1–100 characters;
- `displayName`: optional, up to 100 characters;
- `registrationRequest`: non-empty string;
- `clientPublicKey`: Ed25519 public JWK without private material.

`email` is not part of registration. Duplicate username returns `409`. Email, if used, is an optional, freeform, unverified profile field that can be set later via the normal user resource and is never used to prove identity.

### Finish registration

```http
PATCH /key/0190c9d2-...
Content-Type: application/json

{ "registrationRecord": "..." }
```

Response:

```json
{
  "id": "0190c9d2-...",
  "type": "opaque_registration",
  "userId": "0190c9d2-...",
  "consumedAt": "2026-11-08T12:31:00.000Z"
}
```

A missing, expired, or already consumed row returns `401`. A duplicate username discovered during finish returns `409`.

The finished registration record is retained indefinitely and is used by later
logins. It is never returned by `GET /key/:id`.

## Login flow

```text
client                                      server
  |                                            |
  | opaque.client.startLogin(password)         |
  |------------------------------------------->|
  | POST /key                                  |
  | { type: "opaque_login_state",              |
  |   username, startLoginRequest,             |
  |   clientPublicKey }                        |
  |                                            | look up user
  |                                            | load registration record
  |                                            |   (or null for unknown user)
  |                                            | OPAQUE login response
  |                                            | generate server JWK
  |                                            | create pending login row
  |<-------------------------------------------|
  | 201 { id, type, expiresAt,                 |
  |       loginResponse, serverPublicKey }     |
  |                                            |
  | opaque.client.finishLogin(...)             |
  |------------------------------------------->|
  | PATCH /key/:id                             |
  | { finishLoginRequest }                     |
  |                                            | consume login row
  |                                            | verify OPAQUE exchange
  |                                            | create session row
  |<-------------------------------------------|
  | 200 { sessionId, userId, type,             |
  |       expiresAt, serverPublicKey }         |
```

### Start login

```http
POST /key
Content-Type: application/json

{
  "type": "opaque_login_state",
  "username": "alice",
  "startLoginRequest": "...",
  "clientPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." }
}
```

Response:

```json
{
  "id": "0190c9d2-...",
  "type": "opaque_login_state",
  "expiresAt": "2026-11-08T12:40:00.000Z",
  "loginResponse": "...",
  "serverPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." }
}
```

### Unknown usernames

An unknown username must not be distinguishable from a known one at login start.
The server:

1. looks up the user;
2. loads the registration record when found;
3. otherwise calls OPAQUE with a null registration record and a dummy UUID;
4. stores a login row with `user_id = NULL`;
5. returns the same response shape and status.

At finish, a login row with no `user_id`, or a failed OPAQUE exchange, returns
`401` with `Invalid username or password`. The start response shape, status, and
field names are identical for known and unknown users.

### Finish login

```http
PATCH /key/0190c9d2-...
Content-Type: application/json

{ "finishLoginRequest": "..." }
```

Response:

```json
{
  "sessionId": "0190c9d2-...",
  "userId": "0190c9d2-...",
  "type": "session",
  "expiresAt": "2026-11-09T12:31:00.000Z",
  "serverPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." }
}
```

The server never returns the OPAQUE `sessionKey` in the HTTP response. The
client obtains it directly from `opaque.client.finishLogin`. The session row
stores that raw value; request signatures are verified with the client public
key sent at login, not with the session key.

A login row can be consumed once. Replaying a successful finish returns `401`.

## Key status and deletion

### Status

```http
GET /key/0190c9d2-...
```

Response:

```json
{
  "id": "0190c9d2-...",
  "type": "session",
  "expiresAt": "2026-11-09T12:31:00.000Z",
  "consumedAt": null,
  "userId": "0190c9d2-..."
}
```

The response contains safe metadata only. It never includes `jwk`,
`client_jwk`, `material`, registration records, login state, or session keys.
`HEAD /key/:id` returns the same headers without a body.

Expired rows are purged before lookup. An expired or deleted key returns `404`.
A malformed UUID returns `400`.

### Delete

```http
DELETE /key/0190c9d2-...
```

Returns `204`. This deletes a session for logout, or aborts a pending
registration/login flow. Deleting a missing key returns `404`.

## Rate limiting

Login starts are limited per username and per client: more than 30 starts in a
minute returns `429`. A failed finish counts against the username; five failures
lock it for 15 minutes. Successful logins clear the failure count.

Counters live in the system `auth_limit` table, so they survive restarts and are
shared by every server process. A lock applies to login starts only; existing
sessions keep working.

## TTLs and purging

| State | TTL |
| --- | --- |
| Pending registration | 10 minutes |
| Pending login state | 10 minutes |
| Session | 24 hours |
| Finished registration record | No expiry |

Purging runs when a registration starts, a login starts, or key status is read:

```sql
DELETE FROM key
WHERE expires_at IS NOT NULL
  AND expires_at <= now
```

The session TTL is also the lifetime of the server-side session keypair and the
stored client public key. When the session row is purged or deleted, both are
discarded.

## Keypairs

Every registration and login creates fresh keypairs on both sides.

| Flow | Client keypair | Server keypair | Client private key | Server private key |
| --- | --- | --- | --- | --- |
| Registration | Generated for the request | Generated for the response | Client-managed | Discarded after response |
| Login | Generated for the request | Generated for the response | Client-managed | Copied into the session row |
| Session | Existing login client key | Existing login server key | Client-managed | Stored until expiry or deletion |

The server stores only public client keys and its own private key. Losing or
expiring the session row invalidates the server half of the pair.

## Storage mapping

Auth REST paths map to the key table, not to a hand-written auth namespace:

| Request | Database effect |
| --- | --- |
| `POST /key` + `opaque_registration` | Insert a pending registration key row |
| `POST /key` + `opaque_login_state` | Insert a pending login key row |
| `GET /key/:id` | Read safe metadata from a key row |
| `PATCH /key/:id` + `registrationRecord` | Consume registration state, insert user |
| `PATCH /key/:id` + `finishLoginRequest` | Consume login state, insert session |
| `DELETE /key/:id` | Delete a key row |

Because `key` is hidden, generic JSON:API routes cannot read or mutate key rows.

## Error responses

Auth errors use the standard JSON:API error document:

```json
{
  "errors": [
    {
      "status": "401",
      "title": "Unauthorized",
      "detail": "Login state is invalid, expired, or already used"
    }
  ]
}
```

| Condition | Status |
| --- | --- |
| Malformed body, field, UUID, or JWK | `400` |
| Missing, expired, consumed, or invalid auth state | `401` |
| Missing key row | `404` |
| Duplicate username | `409` |
| Too many login starts or failed logins | `429` |
| Unknown `type` in `POST /key` | `400` |
| Both finish fields or neither | `400` |

## Environment

`OPAQUE_SERVER_SETUP` is required at server startup. Generate it once and keep it
secret:

```bash
bunx @serenity-kit/opaque create-server-setup
```

The server fails fast if the variable is missing. Never commit the value.

## Security properties

Implemented:

- passwords never cross the network;
- OPAQUE `serverLoginState`, registration records, and session keys are stored
  server-side rather than in client-visible tokens;
- one-time registration and login state;
- short-lived pending state;
- automatic expiry;
- safe status responses that never leak key material;
- unknown usernames produce the same start response shape;
- no plaintext password or session key is logged or returned;
- login rate limiting and temporary lockout;
- owner-based row authorization and sharing;
- opt-in request signing with single-use nonces.

Deferred:

- key rotation and revocation APIs;
- multi-device session management;
- refresh tokens.
