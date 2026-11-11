# Client

`resource-server/client` is a small client library for Serber. It performs the
OPAQUE registration and login exchange, keeps the resulting session, adds the
bearer header, and signs requests when a resource requires it. It runs in
browsers, Bun, and Node without server code or Node built-ins.

```ts
import { createResourceServerClient } from 'resource-server/client'

const client = createResourceServerClient({ baseUrl: 'https://api.example.com' })
```

The package entry (`resource-server`) also re-exports
`createResourceServerClient`, `ResourceServerError`, and the public types, but
`resource-server/client` is the browser-safe entry point.

## Creating a client

```ts
createResourceServerClient({
  baseUrl: 'https://api.example.com', // optional; defaults to the current origin
  fetch: customFetch,                 // optional; defaults to globalThis.fetch
  storage: localStorage,              // optional; defaults to localStorage when present
  autoSign: false,                    // optional; sign every request when a session exists
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | current origin | Absolute origin of the server. A path prefix is allowed, e.g. `https://example.com/api`. |
| `fetch` | `globalThis.fetch` | Fetch implementation. Useful for tests, proxies, or custom transports. |
| `storage` | `localStorage` when available | Where the session is persisted. Pass `null` to disable persistence, or a custom adapter. |
| `autoSign` | `false` | Sign every request automatically while signed in. |

## Register and log in

`register()` automatically logs in and stores the new session. The server
creates the user during registration, then the client starts a normal login:

```ts
const { userId, session } = await client.register({
  username: 'alice',
  displayName: 'Alice', // optional
  password: 'correct horse battery staple',
  displayName: 'Alice', // optional
})

client.isSignedIn // true
```

Registration without a session is available for flows that deliberately defer
login:

```ts
const { userId, session } = await client.register(input, { signIn: false })
// session === null
```

Login uses the username and password:

```ts
const session = await client.login({ username: 'alice', password })
```

`login()` and a successful `register()` save the session. A later client created
with the same `storage` restores it:

```ts
const restored = client.restore() // ResourceServerSession | null
```

`restore()` also runs when `session` or `isSignedIn` is read. Expired, malformed,
or incomplete stored sessions are removed and treated as signed out.

### Sessions

```ts
type ResourceServerSession = {
  sessionId: string
  userId: string
  expiresAt: string
  clientPublicKey: PublicJwk
  serverPublicKey: PublicJwk
  secretKey: string
}
```

- `sessionId` is the bearer token. It expires after 24 hours and there is no
  refresh flow.
- `secretKey` is the base64url Ed25519 private key used for request signing.
  It is persisted with the rest of the session so signing survives a reload.
- Persisting `secretKey` means a successful XSS attack can read it, just as it
  could read the session id. Use `storage: null` or a custom adapter when that
  trade-off is not acceptable.

### Storage adapters

The storage option accepts any object shaped like `localStorage`:

```ts
type SessionStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}
```

`memoryStorage()` is exported for tests and non-persistent clients. The key used
in storage is `SESSION_STORAGE_KEY` (`'resource-server.session'`).

```ts
import { createResourceServerClient, memoryStorage } from 'resource-server/client'

const client = createResourceServerClient({ storage: memoryStorage() })
```

## Log out

```ts
await client.logout()
```

`logout()` clears the local session first, then calls `DELETE /key/:id`. A `404`
from the server is treated as success, so logging out an already-expired session
is harmless.

## Requests

The client exposes a thin JSON:API helper. Methods return parsed JSON and throw
`ResourceServerError` for non-2xx responses:

```ts
const articles = await client.get('/article?sort=-updated_at')
const created = await client.post('/article', {
  data: { type: 'article', attributes: { heading: 'Hello' } },
})
await client.patch(`/article/${id}`, { data: { type: 'article', id, attributes: { heading: 'Hi' } } })
await client.delete(`/article/${id}`)
```

| Method | Returns |
| --- | --- |
| `get<T>(path, init?)` | Parsed JSON, or `undefined` for `204` |
| `post<T>(path, body, init?)` | Parsed JSON, or `undefined` for `204` |
| `patch<T>(path, body, init?)` | Parsed JSON, or `undefined` for `204` |
| `put<T>(path, body, init?)` | Parsed JSON, or `undefined` for `204` |
| `delete(path, init?)` | `undefined`; throws on non-2xx |
| `request(path, init?)` | The raw `Response`, without throwing |

The helpers set `Accept: application/vnd.api+json` and, when they send a body,
`Content-Type: application/vnd.api+json`. They accept the usual `RequestInit`
fields, plus `signed`.

`request()` is the low-level escape hatch. It adds the bearer header when there
is a session and returns the response as-is, which is useful for custom content
types, streaming, or handling status codes yourself.

### Signed requests

Resources can require signed requests per operation, for example
`payment` writes. Pass `signed: true` per call:

```ts
await client.post('/payment', paymentDocument, { signed: true })
```

Or sign every request from this client:

```ts
const client = createResourceServerClient({ autoSign: true })
```

A signed request adds `X-Serber-Timestamp`, `X-Serber-Nonce`, and
`X-Serber-Signature`. The signature covers the method, path with query, session
id, timestamp, nonce, and the SHA-256 of the body. Signing needs a session and
throws a `401 ResourceServerError` otherwise. The client uses Web Crypto for the
digest, so the runtime must provide `crypto.subtle`.

Unsigned requests still carry the bearer token. A request is never retried
automatically; if a nonce or timestamp is rejected, the caller decides what to
do next.

### Key status

```ts
const status = await client.status(session.sessionId)
// { id, type, expiresAt, consumedAt, userId }
```

This calls `GET /key/:id` and never returns key material.

## Errors

Resource helpers throw `ResourceServerError`:

```ts
import { ResourceServerError } from 'resource-server/client'

try {
  await client.post('/article', document)
} catch (error) {
  if (error instanceof ResourceServerError) {
    error.status   // 400, 401, 404, 409, ...
    error.title    // JSON:API error title
    error.detail   // human-readable detail
    error.parameter // source.parameter, when present
    error.document // the full JSON:API error document
  }
}
```

The error message is the JSON:API `detail` when one is available. `request()`
does not throw for HTTP errors; it returns the `Response`.

## TypeScript

The client entry exports its types:

```ts
import type {
  FetchLike,
  LoginInput,
  RegisterInput,
  RegisterResult,
  ResourceServerClient,
  ResourceServerClientOptions,
  ResourceServerSession,
  SessionStorage,
} from 'resource-server/client'
```

## Portability

`resource-server/client` avoids `Buffer`, `Bun.*`, and imports from `src/server`.
It uses `tweetnacl`, Web Crypto, and standard fetch types, so the same code runs
in a browser and on a Bun or Node server. The one server-only piece is OPAQUE,
which `@serenity-kit/opaque` provides in both environments.

The client currently targets the Serber auth and JSON:API surface only. It does
not cache resources, retry requests, or refresh sessions.
