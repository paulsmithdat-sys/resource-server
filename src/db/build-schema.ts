import { buildViews } from './views.ts'
import { buildAuthoredViews } from './build/view.ts'
import { deriveSchemas } from './derive-schemas.ts'
import { type BuiltSchema, type JSONSchema, type LoadedSchema, type TableDef } from './schema-types.ts'
import { buildTablePlan } from './build/plan.ts'
import { createIndexSql, createTableSql, sortPlansByDependencies } from './build/ddl.ts'

export { createUpdatedTrigger } from './build/columns.ts'

/** Turn a list of JSON Schemas into tables, views and triggers, with the tables ordered so each comes after the ones it references. */
export const buildSchema =
  (base: LoadedSchema[]): BuiltSchema => {
    for (const entry of base) {
      if (entry.schema['x-view'] !== undefined
          && typeof entry.schema['x-view'] !== 'boolean')
        throw new Error(`${entry.schema.title}: x-view must be a boolean`)
    }

    const schemas = deriveSchemas(base.filter(x => x.schema['x-view'] !== true))
    const viewEntries = base.filter(x => x.schema['x-view'] === true)
    const plans = schemas.map(buildTablePlan)
    const plansByName = new Map(plans.map(x => [x.tableName, x]))

    for (const plan of plans) {
      const owner = plan.columns.find(x => x.columnName === 'owner')
      if (owner && owner.schema.format !== 'uuid')
        throw new Error(`${plan.tableName}: owner must be a uuid column`)
    }

    if (plansByName.has('user')) {
      for (const plan of plans) {
        if (plan.foreignKeys.some(x => x.columns.includes('owner'))) continue
        plan.foreignKeys.push(
          { columns: ['owner']
          , foreignTable: 'user'
          , foreignColumns: ['id']
          , onDelete: 'set null'
          })
        if (!plan.indexes.includes('owner')) plan.indexes.push('owner')
      }
    }

    for (const plan of plans) {
      for (const relation of Object.values(plan.relations)) {
        const target = plansByName.get(relation.table)
        relation.exposed =
          plan.exposed
          && relation['x-exposed'] !== false
          && (target?.exposed ?? true)
      }
    }

    for (const plan of plans) {
      if (!plan.derived) continue

      const endpointHidden =
        plan.foreignKeys.some(
          x => plansByName.get(x.foreignTable)?.exposed === false)
      const relationHidden =
        plans.some(
          other => Object.values(other.relations)
            .some(x => x.through === plan.tableName && x.exposed === false))

      if (endpointHidden || relationHidden) plan.exposed = false
    }

    for (const plan of plans)
      for (const relation of Object.values(plan.relations))
        if (relation.through
            && plansByName.get(relation.through)?.exposed === false)
          relation.exposed = false

    const tables: Record<string, TableDef> = {}
    const tableNames = new Set<string>()
    for (const plan of plans) {
      if (tables[plan.key])
        throw new Error(`Duplicate table export "${plan.key}"`)
      if (tableNames.has(plan.tableName))
        throw new Error(`Duplicate table name "${plan.tableName}"`)
      tables[plan.key] = plan as TableDef
      tableNames.add(plan.tableName)
    }

    const builtByName = new Map<string, TableDef>()

    for (const plan of sortPlansByDependencies(plans)) {
      const table: TableDef =
        { ...plan
        , createSql: createTableSql(plan)
        , indexSql: createIndexSql(plan)
        }
      builtByName.set(plan.tableName, table)
      tables[plan.key] = table
    }

    const orderedTables =
      [...builtByName.values()].sort(
        (a, b) => a.tableName.localeCompare(b.tableName))

    const built: BuiltSchema =
      { tables
      , orderedTables
      , authoredViews: {}
      , triggers:
          Object.fromEntries(
            orderedTables.map(x => [x.tableName, x.trigger]))
      , views: {}
      }

    const generated = buildViews(built)
    const reserved =
      new Set(
        [ ...orderedTables.map(x => x.tableName)
        , ...Object.keys(generated)
        ])
    const authored = buildAuthoredViews(viewEntries, builtByName, reserved)

    return (
      { ...built
      , authoredViews: authored.authoredViews
      , views: { ...generated, ...authored.views }
      })
  }

export type { JSONSchema }
