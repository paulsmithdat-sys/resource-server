/**
 * JSON Schema in, JSON:API server out.
 *
 * Takes JSON Schema files, builds the SQLite (Turso) tables, views and
 * migrations from them, and serves the result as JSON:API with OPAQUE
 * authentication and per-row access control.
 *
 * @packageDocumentation
 */
export { init, serve } from './commands.ts'
export { createApp, type AppOptions } from './server/app/index.ts'
export { loadSchemas } from './db/load-schemas.ts'
export { buildSchema } from './db/build-schema.ts'
export type
  { BuiltSchema
  , JSONSchema
  , JSONSchemaProperty
  , LoadedSchema
  , AccessConfig
  , Cardinality
  , ColumnBuilder
  , Operation
  , Visibility
  , ColumnDef
  , ForeignKeyDef
  , RelationConfig
  , TableDef
  , ViewDef
  } from './db/schema-types.ts'
export type { Row, RowDatabase, RunResult } from './server/database.ts'
