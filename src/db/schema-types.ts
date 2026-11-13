/** How a column is declared in SQLite. `default` is a SQL expression. */
export type ColumnSql =
  { type: 'text' | 'integer' | 'real' | 'blob'
  , notNull: boolean
  , unique: boolean
  , primaryKey: boolean
  , default?: string
  }

/** Whether a relation links to one row or to many. */
export type Cardinality = 'one' | 'many'

/** Who can see a row: only its owner, people it is shared with, any signed-in user, or everyone. */
export type Visibility = 'private' | 'shared' | 'authenticated' | 'public'

/** An action on a row that access control decides. */
export type Operation = 'read' | 'create' | 'update' | 'delete'

/**
 * Normalized x-access. read/create 'public' allow requests without a session.
 */
export type AccessConfig =
  { read: 'session' | 'public'
  // 'role': only holders of a role that grants create may create rows
  , create: 'session' | 'public' | 'role' | 'none'
  , visibility: Visibility[]
  , defaultVisibility: Visibility
  , shareable: boolean
  , signed: Operation[]
  // role name -> operations its holders may perform on every row
  , roles: Record<string, Operation[]>
  // label of a to-one relation; whoever can read that parent can read the row
  , inherit?: string
  // operations recorded in audit_log
  , audited: Operation[]
  }

/** A relation declared with `x-relations` in a schema. */
export type RelationConfig =
  { table: string
  , column?: string
  , cardinality: Cardinality
  , foreignKey?: string
  , through?: string
  , required?: boolean
  , onDelete?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  , onUpdate?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  , 'x-exposed'?: boolean
  // Allows linking to any existing row, not just rows the writer owns
  , 'x-link-any'?: boolean
  , exposed?: boolean
  }

/** A property of a JSON Schema: its type, format, limits and the `x-` extensions that apply to columns. */
export type JSONSchemaProperty =
  // A union with "null" such as [string, 'null'] is normalized to its
  // non-null member before schema building; nullability comes from `required`.
  { type?: string | string[]
  , format?: string
  // Standard JSON Schema: clients may read the attribute but never write it
  , readOnly?: boolean
  , description?: string
  , enum?: readonly unknown[]
  , default?: unknown
  , minLength?: number
  , maxLength?: number
  , properties?: Record<string, JSONSchemaProperty>
  , items?: JSONSchemaProperty
  , required?: string[]
  , 'x-unique'?: boolean
  , 'x-primary'?: boolean
  , 'x-exposed'?: boolean
  // For view properties: where the value comes from, such as "article.heading"
  , 'x-source'?: string
  , [key: string]: unknown
  }

/** A JSON Schema document with the `x-` extensions this library understands. */
export type JSONSchema =
  { $schema?: string
  , title: string
  , type?: string
  , description?: string
  , additionalProperties?: boolean
  , properties?: Record<string, JSONSchemaProperty>
  , required?: string[]
  , default?: unknown
  , 'x-system'?: boolean
  // A read-only resource built from an authored SELECT over other tables
  , 'x-view'?: boolean
  // The base table an authored view selects from
  , 'x-source'?: string
  , 'x-exposed'?: boolean
  , 'x-access'?: Record<string, unknown>
  , 'x-relations'?: Record<string, RelationConfig>
  , 'x-unique-constraints'?: string[][]
  // Raw SQL CHECK expressions; used by derived tables
  , 'x-checks'?: string[]
  , [key: string]: unknown
  }

/** A schema read from a file, with where it came from and the export name used for it. */
export type LoadedSchema =
  { schema: JSONSchema
  , source: string
  , importPath: string
  }

/** A column built from a schema property. */
export type ColumnDef =
  { key: string
  , columnName: string
  , schema: JSONSchemaProperty
  , sql: ColumnSql
  , required: boolean
  , injected: boolean
  , exposed: boolean
  }

/** A foreign key from columns of one table to columns of another. */
export type ForeignKeyDef =
  { columns: string[]
  , foreignTable: string
  , foreignColumns: string[]
  , onDelete?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  , onUpdate?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  }

/** A table built from a schema, with its columns, relations and access settings. */
export type TableDef =
  { key: string
  , tableName: string
  , createSql: string
  , indexSql: string[]
  , schema: JSONSchema
  , columns: ColumnDef[]
  , isSystem: boolean
  , derived: boolean
  , exposed: boolean
  , access: AccessConfig
  , relations: Record<string, RelationConfig>
  , foreignKeys: ForeignKeyDef[]
  , uniqueConstraints: string[][]
  , indexes: string[]
  , trigger: string
  // For an authored view, the base table its columns and relations come from
  , sourceTable?: string
  }

/** A view built for a table, with its SQL. */
export type ViewDef =
  { name: string
  , sql: string
  , dropSql: string
  }

/** The result of building schemas: tables, authored views, triggers and generated views. */
export type BuiltSchema =
  { tables: Record<string, TableDef>
  , orderedTables: TableDef[]
  // Read-only resources declared with `x-view`, keyed by their view name
  , authoredViews: Record<string, TableDef>
  , triggers: Record<string, string>
  , views: Record<string, ViewDef>
  }

const splitWords =
  (value: string) =>
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)

export const snakeCase =
  (value: string) => splitWords(value).map(x => x.toLowerCase()).join('_')

export const pascalCase =
  (value: string) => splitWords(value).map(x => x[0]!.toUpperCase() + x.slice(1)).join('')

export const isSchemaObject =
  (value: unknown): value is JSONSchema =>
    typeof value === 'object'
    && value !== null
    && typeof (value as JSONSchema).title === 'string'
    && (value as JSONSchema).title.length > 0
    && (typeof (value as JSONSchema).properties === 'object'
        || (value as JSONSchema).type === 'object')
