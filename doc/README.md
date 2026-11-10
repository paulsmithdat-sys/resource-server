# Serber documentation

This directory contains the detailed documentation for Serber's generated data
model, HTTP API, and authentication layer. The root [README](../README.md) is
the project overview and quick start.

## Reading order

1. [Architecture](./architecture.md) — how schemas become tables, views,
   migrations, and HTTP routes.
2. [Data model](./data-model.md) — injected columns, system tables, relations,
   and the hidden key store.
3. [Schema reference](./schema-reference.md) — every supported JSON Schema
   keyword, including `x-exposed`.
4. [API](./api.md) — JSON:API endpoints, queries, writes, errors, and status
   codes.
5. [Authentication](./auth.md) — the OPAQUE registration/login flows, session
   lifecycle, keypairs, TTLs, and response shapes.
6. [Development](./development.md) — setup, commands, migrations, tests, and
   conventions.

## Current status

Phases 0–5 are complete. The server generates tables, relations, join tables,
views, migrations, and JSON:API endpoints from JSON Schema. It also implements
stateless OPAQUE registration and login, with all temporary authentication state
stored in the hidden `key` table.

Authentication currently answers "who is this user?". Authorization, request
signing, and owner-based row access are intentionally deferred to Phase 6.
