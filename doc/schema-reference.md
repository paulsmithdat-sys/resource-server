# Schema reference

A schema module exports a JSON Schema object. User schemas live in `src/schema/`
and system schemas in `src/schema/system/`. The loader validates each module and
the builder derives tables, relations, views, and API resources.

## Supported keywords

| Keyword | Effect |
| --- | --- |
| `title` | Table name after snake_case conversion; also drives the export name |
| `description` | Documentation only |
| `type` | Base SQLite type; must be `object` for a table |
| `properties` | Columns |
| `required` | `NOT NULL` constraints (default columns are always required) |
| `default` | Column default |
| `format` | Specialized type mapping (`uuid`, `date-time`, `byte`, `email`) |
| `enum` | Text column with enum typing |
| `minLength`, `maxLength` | Validation metadata |
| `x-unique` | Unique constraint |
| `x-primary` | Custom primary key marker |
| `x-system` | Always-loaded system schema |
| `x-exposed` | `false` hides the table, property, or relation |
| `x-relations` | Relation metadata |
| `x-unique-constraints` | Table-level unique constraints over column groups |

`additionalProperties: false` is conventional in this repository but is not the
only accepted value.

## Type mapping

| JSON Schema | SQLite / Drizzle |
| --- | --- |
| `string` | `text` |
| `string` with `format: uuid` | `blob`, default `uuid7()` when used as an ID |
| `string` with `format: date-time` | `integer` timestamp |
| `string` with `format: byte` | `blob` |
| `integer` | `integer` |
| `number` | `real` |
| `boolean` | `integer` boolean |
| `object` | `text` JSON |
| `array` | `text` JSON |
| string `enum` | `text` with enum typing |

Column names are snake_cased. API attribute names are the snake_case column
names.

## Default columns

The builder injects these columns into every table when they are not declared:

- `id` — UUID primary key;
- `updated_at` — timestamp;
- `owner` — nullable UUID foreign key to `user.id`.

See [data-model.md](./data-model.md) for their semantics. A schema may declare
`id`, `updated_at`, or `owner` explicitly; the builder preserves the declared
position and type rules. `owner` must remain a UUID column.

## `x-exposed`

`x-exposed` defaults to `true`. Setting it to `false` removes the declaration
from the public surface.

### Tables

```json
{
  "title": "Key",
  "type": "object",
  "x-exposed": false,
  "properties": { "...": "..." }
}
```

A hidden table:

- has no registry resource or catalog entry;
- has no generated public view;
- cannot be read, created, updated, or deleted through `/:type` routes;
- is omitted from the relations of other resources.

The table and its data still exist. An application service, such as the auth
service, can access it directly.

### Properties

```json
{
  "properties": {
    "internal_note": {
      "type": "string",
      "x-exposed": false
    }
  }
}
```

A hidden property is omitted from generated views, serializers, query fields,
and write validation. It is still present in the table and can be read or written
by trusted server code.

### Relations

```json
{
  "x-relations": {
    "audit": {
      "table": "audit_log",
      "column": "id",
      "cardinality": "many",
      "x-exposed": false
    }
  }
}
```

A hidden relation is omitted from the registry, serializers, and `include`
validation. Relations that target a hidden table are hidden automatically. A
derived join table is hidden when either endpoint or the relation is hidden.

### Validation

`x-exposed` must be a boolean on tables, properties, and relations. Any other
value fails schema building.

## Relations

Relations are declared under `x-relations`.

```json
{
  "x-relations": {
    "member": {
      "table": "user",
      "column": "id",
      "cardinality": "one",
      "foreignKey": "member_id",
      "onDelete": "set null"
    },
    "groups": {
      "table": "user_group",
      "column": "id",
      "cardinality": "many",
      "through": "user_group_membership",
      "onDelete": "cascade"
    }
  }
}
```

### Relation fields

| Field | Meaning |
| --- | --- |
| `table` | Target table |
| `column` | Target column, default `id` |
| `cardinality` | `one` or `many` |
| `foreignKey` | Optional foreign-key column override for `one` |
| `through` | Optional join-table name override for `many` |
| `required` | Whether a derived `one` foreign key is `NOT NULL` |
| `onDelete` | Foreign-key delete action |
| `onUpdate` | Foreign-key update action |
| `x-exposed` | `false` hides the relation |

### `one` relation

A `one` relation adds a foreign-key column when it does not exist:

- the default column name is `<table>_id`, or `foreignKey` when provided;
- the column type follows the target key type (UUID by default);
- the column is indexed;
- `required: true` makes it `NOT NULL`;
- the target must exist and the target column must exist;
- the target must be a key column.

`onDelete` and `onUpdate` are passed through to the generated foreign key.
`owner` is added separately and always references `user.id` with
`ON DELETE SET NULL`.

### `many` relation

A `many` relation without `through` produces a derived join table named after the
sorted endpoint pair, for example `article_tag`. The join table has:

- `id`, `updated_at`, and `owner`;
- both endpoint foreign keys, `NOT NULL`;
- a unique constraint on the endpoint pair;
- a trigger and a view.

A `many` relation with `through` uses the named join table instead of deriving a
new one. Self-referential many-to-many relations require an explicit `through`
name.

### Deduplication

The builder deduplicates join tables by endpoint pair. If two schemas declare the
same many-to-many relation, only one join table is generated. Conflicting
`through` names for the same pair fail the build.

## Complete example

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
    "tag": {
      "table": "tag",
      "column": "id",
      "cardinality": "many",
      "x-exposed": true
    }
  }
}
```

This produces:

- the `article` table with `id`, `updated_at`, `owner`, and the declared columns;
- the `article_tag` join table;
- `article_view` with a `tag` JSON array;
- `article_tag_view`;
- the `/article` JSON:API resource with a `tag` relationship;
- an `owner` attribute on `/article`.

## Validation rules

Schema building fails when:

- a title is missing or duplicate;
- a table name is duplicate;
- two columns normalize to the same name;
- more than one primary key is declared;
- `owner` is declared with a non-UUID format;
- a `one` relation targets a missing table or column;
- a relation foreign-key column does not exist;
- a `many` relation is self-referential without `through`;
- two join tables conflict;
- a unique constraint references an unknown column;
- `x-exposed` is not a boolean;
- `x-unique` or `x-primary` markers conflict with the generated defaults.

Failures happen before any SQL is generated or executed.
