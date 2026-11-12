# API

Serber exposes a JSON:API 1.0 layer over Hono. Generic resource routes are
generated from the exposed tables in the built schema. Authentication uses a
small plain-JSON surface under `/key`.

## Resource endpoints

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
OPTIONS on every path    advertised methods
```

Requests with a body must send `Content-Type: application/vnd.api+json`
(otherwise `415`). An `Accept` header that only allows JSON:API with media type
parameters gets `406`. Every document carries `jsonapi.version`, a top-level
`links.self`, a `links.self` per resource, and `self` and `related` links per
relationship. Collections add `first`, `last`, `prev`, and `next` links.

Resource types are snake_case table names. The built-in exposed resources are:

```text
/user
/user_group
/user_role
/schema
/audit_log
/article
/chat
/feedback
/message
/note
/payment
/tag
```

`key` is deliberately absent. It is a hidden table with its own auth routes:

```text
POST    /key             start registration or login
GET     /key/:id         safe key status
HEAD    /key/:id         headers for key status
PATCH   /key/:id         finish registration or login
DELETE  /key/:id         delete a session or abort a flow
OPTIONS /key
OPTIONS /key/:id
```

See [auth.md](./auth.md) for bodies, status codes, and flows.

## Content types

Generic JSON:API responses use:

```text
application/vnd.api+json
```

Auth success responses use plain JSON:

```text
application/json
```

Auth errors still use the JSON:API error format. Every error response, generic
or auth, uses `application/vnd.api+json`.

## Catalog

`GET /` describes every exposed resource without querying rows:

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

Hidden tables, hidden columns, and hidden relations never appear in the catalog.
When the server enforces sessions the catalog needs one too.
The `owner` attribute appears on every exposed resource.

## Query parameters

Collections support:

- `page[number]` — 1-based page number, default `1`;
- `page[size]` — rows per page, default `20`, maximum `100`;
- `sort` — comma-separated fields; prefix a field with `-` for descending;
- `filter[field]=value` — equality filter; repeatable as `AND` conditions;
- `filter[field][operator]=value` — `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `in` and
  `nin` (comma-separated values), `contains`, `starts`, `ends`, and `null`
  (`true` or `false`). Values are converted to the column type and always passed
  as SQL parameters. JSON:API reserves `filter` but does not define operators, so
  this operator syntax is Serber's own convention;
- `fields[type]` — comma-separated attributes and relationship labels;
- `include` — comma-separated relationship paths for a compound document. A path
  such as `article.tag` includes each article and then each article's tags.

Single-resource requests accept `fields[type]` and `include`. Pagination and
sorting parameters are accepted but do not affect a single-resource response.

A filter field may follow relationships: `filter[tag.name]=news` keeps articles
with at least one tag named `news`, and `filter[article.tag.name][starts]=n`
follows two steps (at most three). Every operator works the same way on a
related field. Only related rows the viewer may read are considered, so a filter
can never reveal whether an unreadable row exists.

Sorting only allows exposed base view columns; filtering allows them and
related fields as above. Relationship labels
are not SQL columns and are rejected. Unknown fields or resource types in
`fields[...]`, unknown relationship labels, and out-of-range pagination values
return `400` with a JSON:API error whose `source.parameter` names the bad
parameter.

Include paths follow the JSON:API rules:

- `include=tag` includes direct relationships, and `include=article.tag` follows
  a path of up to three relationships;
- every resource on a path is included too, so `article.tag` includes the
  articles as well as their tags;
- a resource appears once in `included`, and never when it is already primary
  data;
- an included resource has relationship linkage only for the labels that
  continue a path through it;
- each step applies the viewer's read access, so an unreadable row is absent at
  any depth, and its id is not leaked in linkage.

Hidden relations cannot be requested, and relations to hidden tables are hidden
automatically.

## Documents

A collection response:

```json
{
  "jsonapi": { "version": "1.0" },
  "data": [
    {
      "type": "article",
      "id": "0190c9d2-7c4a-7b3e-9a11-2f7a8f9b1c22",
      "attributes": {
        "updated_at": 1731092400000,
        "owner": null,
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

Attributes contain every exposed non-relational column except `id`, including
`updated_at` and `owner`. Foreign-key columns and relation labels are omitted.
Relationships contain resource identifier objects only; relationship links are
not generated yet. A `one` relationship is one identifier or `null`; a `many`
relationship is an array.

## Write operations

Write bodies are JSON:API resource objects:

```json
{
  "data": {
    "type": "article",
    "attributes": {
      "heading": "Hello",
      "subheading": "World",
      "content": "...",
      "owner": "0190c9d2-7c4a-7b3e-9a11-2f7a8f9b1c22"
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

Behavior:

- `POST /:type` creates a resource and returns `201` with a `Location` header.
  A client may supply a canonical UUID `data.id`; otherwise the database
  generates one.
- `PUT /:type/:id` replaces a resource. Omitted optional attributes become
  `null`, and omitted relationships are cleared.
- `PATCH /:type/:id` updates only the supplied attributes and relationships.
- `DELETE /:type/:id` removes the resource and derived join-table rows, then
  returns `204`.
- `HEAD` returns the same status and headers as `GET` without a body.
- `OPTIONS` returns `204` with an `Allow` header.

Writes validate:

- the resource type and JSON:API document shape;
- attribute names against exposed attributes;
- every validation keyword in each attribute's JSON Schema, including types,
  enums, patterns, numeric ranges, string lengths, and nested objects or arrays;
- required attributes for the request mode (`create`/`PUT` enforce them,
  `PATCH` may omit them);
- relationship labels and identifier types;
- `owner`, when present: it must be a canonical UUID and must reference an
  existing user row.

A `one` relationship writes its foreign-key column. A `many` relationship through
a join table replaces that table's rows for the resource. Constraint violations
return `409 Conflict`.

## IDs

The database stores UUIDv7 values as blobs. Views format them as canonical
lowercase UUID strings. The API uses those strings as JSON:API `id` values and as
lookup values in `GET /:type/:id`.

## Errors

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

Status codes:

| Status | Meaning |
| --- | --- |
| `200` | Successful read, update, or auth finish |
| `201` | Resource or auth flow created |
| `204` | Delete, `HEAD`, or `OPTIONS` with no body |
| `400` | Invalid query, document, attribute, key id, or auth body |
| `401` | Invalid, expired, consumed, or unknown auth state |
| `404` | Unknown resource, id, key, or route |
| `409` | Unique or foreign-key constraint violation |
| `500` | Unexpected server failure |

## Owner attribute

`owner` is a normal attribute on every exposed resource and is read-only. It is a
nullable UUID foreign key to `user.id` with `ON DELETE SET NULL`.

- the server sets it to the signed-in creator;
- a value sent by a client is ignored;
- a row created anonymously has no owner;
- deleting the user sets the row's `owner` to `null`.

Read and write access follow the rules in
[access-control.md](./access-control.md).
