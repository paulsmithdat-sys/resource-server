import type { BuiltSchema, TableDef } from '../db/schema-types.ts'

export type RelationshipMeta =
  { label: string
  , cardinality: 'one' | 'many'
  , table: string
  , type: string
  }

export type ResourceMeta =
  { type: string
  , table: string
  , view: string
  , definition: TableDef
  , columns: string[]
  , attributes: string[]
  , foreignKeyColumns: string[]
  , relationships: Record<string, RelationshipMeta>
  }

export type Registry =
  { resources: Map<string, ResourceMeta>
  , get: (type: string) => ResourceMeta | undefined
  }

export const buildRegistry =
  (built: BuiltSchema): Registry => {
    const resources = new Map<string, ResourceMeta>()

    for (const table of built.orderedTables) {
      const relationLabels = new Set(Object.keys(table.relations))
      const foreignKeyColumns =
        [...new Set(table.foreignKeys.flatMap(x => x.columns))]
      const foreignKeySet = new Set(foreignKeyColumns)

      const columns = table.columns.map(x => x.columnName)
      const attributes =
        columns.filter(
          x =>
            x !== 'id'
            && !relationLabels.has(x)
            && !foreignKeySet.has(x))

      const relationships: Record<string, RelationshipMeta> =
        Object.fromEntries(
          Object.entries(table.relations).map(([label, relation]) => (
            [ label
            , { label
              , cardinality: relation.cardinality
              , table: relation.table
              , type: relation.table
              }
            ])))

      resources.set(
        table.tableName
        , { type: table.tableName
          , table: table.tableName
          , view: `${table.tableName}_view`
          , definition: table
          , columns
          , attributes
          , foreignKeyColumns
          , relationships
          }
        )
    }

    return (
      { resources
      , get: type => resources.get(type)
      })
  }
