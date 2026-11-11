# Serber documentation

This directory contains the detailed documentation for Serber's generated data
model, HTTP API, access control, and authentication layer. The root
[README](../README.md) is the project overview and quick start.

## Reading order

1. [Architecture](./architecture.md) — how schemas become tables, views,
   migrations, and HTTP routes, plus the design invariants.
2. [Data model](./data-model.md) — injected columns, system tables, relations,
   views, and the hidden key store.
3. [Schema reference](./schema-reference.md) — every supported JSON Schema
   keyword, relations, and validation rules.
4. [Access control](./access-control.md) — `x-access`, visibility, sharing,
   roles, inheritance, audit, and signed requests.
5. [API](./api.md) — JSON:API endpoints, queries, writes, errors, and status
   codes.
6. [Authentication](./auth.md) — the OPAQUE registration/login flows, session
   lifecycle, keypairs, TTLs, and response shapes.
7. [Client](./client.md) — the browser-safe client: registration, login,
   sessions, storage, requests, and signing.
8. [Security](./security.md) — key ownership, non-repudiation, threat model, and
   known gaps.
9. [Roadmap](./roadmap.md) — phases, deliverables, exit criteria, and status.
10. [Development](./development.md) — setup, commands, migrations, tests, and
    conventions.

## Current status

Phases 0–6 are complete. The server generates tables, relations, join tables,
views, migrations, and JSON:API endpoints from JSON Schema. It also implements
stateless OPAQUE registration and login, with all temporary authentication state
stored in the hidden `key` table.

Authorization is owner-based, with per-row visibility, sharing, roles, inherited
read access, audit trails, and opt-in request signing. A browser-safe client is
available at `resource-server/client`; it wraps registration, login, sessions,
and JSON:API requests.

Remaining work is key rotation and revocation, moderation of inherited rows, and
the Phase 7–8 items in the [roadmap](./roadmap.md).
