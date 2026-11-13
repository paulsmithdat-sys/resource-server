import type { BuiltSchema, TableDef } from '../db/schema-types.ts'

export type RelationshipMeta =
  { label: string
  , cardinality: 'one' | 'many'
  , table: string
  , type: string
  , linkAny: boolean
  }

export type ResourceMeta =
  { type: string
  , table: string
  , view: string
  , // False for an authored view, which the API never writes
    readOnly: boolean
  , definition: TableDef
  , access: TableDef['access']
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
    const exposedTables =
      new Set(
        built.orderedTables.filter(x => x.exposed).map(x => x.tableName))

    /** Add a resource backed by one row of `table`, exposed through `view`. */
    const register =
      (table: TableDef, view: string, readOnly: boolean) => {
        const relationEntries =
          Object.entries(table.relations)
            .filter(
              ([, relation]) =>
                relation.exposed !== false
                && exposedTables.has(relation.table))
        const relationLabels =
          new Set(relationEntries.map(([label]) => label))
        const relationshipForeignKeys =
          new Set(
            relationEntries.flatMap(
              ([, relation]) =>
                relation.cardinality === 'one' && relation.foreignKey
                  ? [relation.foreignKey]
                  : []))
        const hiddenRelationForeignKeys =
          new Set(
            Object.values(table.relations).flatMap(
              relation =>
                relation.cardinality === 'one'
                && relation.foreignKey
                && relation.exposed === false
                  ? [relation.foreignKey]
                  : []))

        const columns =
          table.columns
            .filter(
              column =>
                column.exposed
                && !hiddenRelationForeignKeys.has(column.columnName))
            .map(column => column.columnName)
        const attributes =
          columns.filter(
            x =>
              x !== 'id'
              && !relationLabels.has(x)
              && !relationshipForeignKeys.has(x))

        const relationships: Record<string, RelationshipMeta> =
          Object.fromEntries(
            relationEntries.map(([label, relation]) => (
              [ label
              , { label
                , cardinality: relation.cardinality
                , table: relation.table
                , type: relation.table
                , linkAny: relation['x-link-any'] === true
                }
              ])))

        resources.set(
          table.tableName
          , { type: table.tableName
            , table: table.tableName
            , view
            , readOnly
            , definition: table
            , access: table.access
            , columns
            , attributes
            , foreignKeyColumns:
                [...new Set(table.foreignKeys.flatMap(x => x.columns))]
            , relationships
            }
          )
      }

    for (const table of built.orderedTables) {
      if (table.exposed)
        register(table, `${table.tableName}_view`, false)
    }

    for (const view of Object.values(built.authoredViews)) {
      if (view.exposed) register(view, view.tableName, true)
    }

    return (
      { resources
      , get: type => resources.get(type)
      })
  }
