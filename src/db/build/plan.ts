import { DERIVED_SOURCE } from '../derive/helpers.ts'
import { pascalCase, snakeCase, type ColumnDef, type ForeignKeyDef, type JSONSchemaProperty, type LoadedSchema, type TableDef } from '../schema-types.ts'
import { normalizeAccess } from '../access.ts'
import { createUpdatedTrigger, validateExposure, buildColumn } from './columns.ts'
import { validateRelation, foreignKeyColumnOf, buildUniqueConstraints } from './relations.ts'


const SYSTEM_SCHEMA_DIR = 'src/schema/system/'

export type TablePlan = Omit<TableDef, 'createSql' | 'indexSql'>

export const buildTablePlan =
  (loaded: LoadedSchema): TablePlan => {
    const schema = loaded.schema
    const declared = Object.entries(schema.properties ?? {})

    const access = normalizeAccess(schema)

    const systemColumns: [string, JSONSchemaProperty][] =
      [ ['id', { type: 'string', format: 'uuid', 'x-primary': true }]
      , ['updated_at', { type: 'string', format: 'date-time' }]
      , [ 'owner'
        , { type: 'string', format: 'uuid', description: 'Owner user id' }
        ]
      , ...(schema['x-exposed'] === false
          ? []
          : [ [ 'visibility'
              , { type: 'string'
                , enum: access.visibility
                , default: access.defaultVisibility
                , description: 'Who can read the row; only the owner can write it'
                }
              ] as [string, JSONSchemaProperty]
            ])
      ]
    const isSystemKey =
      (key: string) => systemColumns.some(([name]) => snakeCase(key) === name)

    // System columns come first, taken from the schema when it declares them.
    const orderedEntries =
      [ ...systemColumns.map(
          ([name, fallback]) =>
            declared.find(([key]) => snakeCase(key) === name) ?? [name, fallback])
      , ...declared.filter(([key]) => !isSystemKey(key))
      ] as [string, JSONSchemaProperty][]
    const injected =
      new Set(
        systemColumns
          .map(([name]) => name)
          .filter(name => !declared.some(([key]) => snakeCase(key) === name)))

    validateExposure(schema.title, schema['x-exposed'], 'table')

    const requiredNames = new Set((schema.required ?? []).map(snakeCase))
    const columns: ColumnDef[] =
      orderedEntries.map(([key, property]) => {
        const columnName = snakeCase(key)
        validateExposure(schema.title, property['x-exposed'], `property "${key}"`)
        const isRequired =
          requiredNames.has(columnName)
          || columnName === 'id'
          || columnName === 'updated_at'
          || columnName === 'visibility'
        return (
          { key
          , columnName
          , schema: property
          , sql: buildColumn(key, property, isRequired)
          , required: isRequired
          , injected: injected.has(columnName)
          , exposed: property['x-exposed'] !== false
          })
      })

    const columnNames = new Set<string>()
    for (const column of columns) {
      if (columnNames.has(column.columnName))
        throw new Error(`${schema.title}: duplicate column "${column.columnName}"`)
      columnNames.add(column.columnName)
    }

    const primaryKeys = columns.filter(x => x.schema['x-primary'] || x.columnName === 'id')
    if (primaryKeys.length > 1)
      throw new Error(
        `${schema.title}: multiple primary keys: ${primaryKeys.map(x => x.columnName).join(', ')}`)

    const relations = schema['x-relations'] ?? {}
    for (const [label, relation] of Object.entries(relations))
      validateRelation(schema.title, label, relation)

    if (access.inherit && relations[access.inherit]?.cardinality !== 'one')
      throw new Error(
        `${schema.title}: x-access inherit "${access.inherit}" must name a to-one relation`)

    const foreignKeys: ForeignKeyDef[] = []
    for (const [label, relation] of Object.entries(relations)) {
      if (relation.cardinality !== 'one') continue

      const foreignKeyColumn = foreignKeyColumnOf(relation)
      if (!columnNames.has(foreignKeyColumn))
        throw new Error(
          `${schema.title}: relation "${label}" foreign key column "${foreignKeyColumn}" does not exist`)

      foreignKeys.push(
        { columns: [foreignKeyColumn]
        , foreignTable: relation.table
        , foreignColumns: [relation.column ?? 'id']
        , ...(relation.onDelete ? { onDelete: relation.onDelete } : {})
        , ...(relation.onUpdate ? { onUpdate: relation.onUpdate } : {})
        })
    }

    const uniqueConstraints =
      buildUniqueConstraints(schema, columnNames)

    const indexes =
      [...new Set([...foreignKeys.flatMap(x => x.columns), 'owner'])]

    const tableName = snakeCase(schema.title)

    return (
      { key: pascalCase(schema.title)
      , tableName
      , schema
      , columns
      , isSystem:
          schema['x-system'] === true
          || (loaded.source !== DERIVED_SOURCE
              && loaded.importPath.startsWith(SYSTEM_SCHEMA_DIR))
      , derived: loaded.source === DERIVED_SOURCE
      , exposed: schema['x-exposed'] !== false
      , access
      , relations
      , foreignKeys
      , uniqueConstraints
      , indexes
      , trigger: createUpdatedTrigger(tableName)
      })
  }
