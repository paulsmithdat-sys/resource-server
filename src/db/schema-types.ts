export type Cardinality = 'one' | 'many'

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
  , exposed?: boolean
  }

export type JSONSchemaProperty =
  { type?: string
  , format?: string
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
  , [key: string]: unknown
  }

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
  , 'x-exposed'?: boolean
  , 'x-relations'?: Record<string, RelationConfig>
  , 'x-unique-constraints'?: string[][]
  , [key: string]: unknown
  }

export type LoadedSchema =
  { schema: JSONSchema
  , source: string
  , importPath: string
  , exportName: string
  }

export type ColumnDef =
  { key: string
  , columnName: string
  , schema: JSONSchemaProperty
  , drizzle: any
  , required: boolean
  , injected: boolean
  , exposed: boolean
  }

export type ForeignKeyDef =
  { columns: string[]
  , foreignTable: string
  , foreignColumns: string[]
  , onDelete?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  , onUpdate?: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
  }

export type TableDef =
  { key: string
  , tableName: string
  , drizzleSchema: any
  , schema: JSONSchema
  , columns: ColumnDef[]
  , isSystem: boolean
  , derived: boolean
  , exposed: boolean
  , relations: Record<string, RelationConfig>
  , foreignKeys: ForeignKeyDef[]
  , uniqueConstraints: string[][]
  , indexes: string[]
  , trigger: string
  }

export type ViewDef =
  { name: string
  , sql: string
  , dropSql: string
  }

export type BuiltSchema =
  { tables: Record<string, TableDef>
  , orderedTables: TableDef[]
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
