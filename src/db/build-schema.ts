import { sql } from 'drizzle-orm'
import
  { blob
  , check
  , foreignKey
  , index
  , integer
  , real
  , sqliteTable
  , text
  , unique
  } from 'drizzle-orm/sqlite-core'
import { buildViews } from './views.ts'
import
  { DERIVED_SOURCE
  , deriveSchemas
  } from './derive-schemas.ts'
import
  { pascalCase
  , snakeCase
  , type BuiltSchema
  , type ColumnDef
  , type ForeignKeyDef
  , type JSONSchema
  , type JSONSchemaProperty
  , type LoadedSchema
  , type RelationConfig
  , type TableDef
  } from './schema-types.ts'
import { normalizeAccess } from './access.ts'

const SYSTEM_SCHEMA_DIR = 'src/schema/system/'

const uuidDefault =
  () => sql`(uuid7())`

const timestampDefault =
  () => sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`

export const createUpdatedTrigger =
  (tableName: string) => `
CREATE TRIGGER IF NOT EXISTS \`${tableName}_updated\`
AFTER UPDATE ON \`${tableName}\`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE \`${tableName}\`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;`.trim()

const isStringEnum =
  (value: readonly unknown[] | undefined): value is [string, ...string[]] =>
    Array.isArray(value)
    && value.length > 0
    && value.every(x => typeof x === 'string')

const validateExposure =
  (title: string, value: unknown, label: string) => {
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error(`${title}: ${label} x-exposed must be a boolean`)
  }

const applyDefault =
  (builder: any, value: unknown, property: JSONSchemaProperty) => {
    if (value === undefined) return builder
    if (property.type === 'object' || property.type === 'array')
      return builder.default(sql`${JSON.stringify(value)}`)
    if (property.format === 'date-time') {
      const millis = typeof value === 'string' ? Date.parse(value) : NaN
      return Number.isFinite(millis) ? builder.default(sql`${millis}`) : builder
    }
    if (property.type === 'boolean')
      return builder.default(value ? 1 : 0)
    return builder.default(value)
  }

const buildColumn =
  ( key: string
  , property: JSONSchemaProperty
  , required: boolean) => {
    const columnName = snakeCase(key)
    let builder: any

    if (property.format === 'uuid')
      builder = blob(columnName)
    else if (property.format === 'date-time')
      builder = integer(columnName, { mode: 'timestamp' })
    else if (property.format === 'byte')
      builder = blob(columnName)
    else if (property.type === 'string')
      builder = isStringEnum(property.enum)
        ? text(columnName, { enum: property.enum })
        : text(columnName)
    else if (property.type === 'integer')
      builder = integer(columnName)
    else if (property.type === 'number')
      builder = real(columnName)
    else if (property.type === 'boolean')
      builder = integer(columnName, { mode: 'boolean' })
    else if (property.type === 'object' || property.type === 'array')
      builder = text(columnName, { mode: 'json' })
    else
      builder = text(columnName)

    if (property.default !== undefined)
      builder = applyDefault(builder, property.default, property)
    else if (columnName === 'id')
      builder = builder.default(uuidDefault())
    else if (columnName === 'updated_at')
      builder = builder.default(timestampDefault())

    if (required || columnName === 'id' || columnName === 'updated_at')
      builder = builder.notNull()

    if (property['x-unique'])
      builder = builder.unique()

    if (property['x-primary'] || columnName === 'id')
      builder = builder.primaryKey()

    return builder
  }

const relationFieldTypes =
  { column: 'string'
  , foreignKey: 'string'
  , through: 'string'
  , required: 'boolean'
  , 'x-exposed': 'boolean'
  , 'x-link-any': 'boolean'
  } as const

const validateRelation =
  (sourceTitle: string, label: string, relation: RelationConfig) => {
    const fail =
      (message: string) =>
        new Error(`${sourceTitle}: relation "${label}" ${message}`)

    if (!relation || typeof relation !== 'object')
      throw new Error(`${sourceTitle}: relation "${label}" must be an object`)
    if (typeof relation.table !== 'string' || relation.table.length === 0)
      throw fail('needs a table')
    if (relation.cardinality !== 'one' && relation.cardinality !== 'many')
      throw fail('cardinality must be "one" or "many"')

    for (const [field, type] of Object.entries(relationFieldTypes))
      if ((relation as any)[field] !== undefined
          && typeof (relation as any)[field] !== type)
        throw fail(`${field} must be a ${type}`)
  }

type TablePlan = Omit<TableDef, 'drizzleSchema'>

const foreignKeyColumnOf =
  (relation: RelationConfig) =>
    snakeCase(relation.foreignKey ?? `${relation.table}_${relation.column ?? 'id'}`)

const buildUniqueConstraints =
  (schema: JSONSchema, columnNames: Set<string>) => {
    const raw = schema['x-unique-constraints']
    if (raw === undefined) return []

    if (!Array.isArray(raw))
      throw new Error(`${schema.title}: x-unique-constraints must be an array`)

    const result: string[][] = []
    const seen = new Set<string>()

    raw.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length === 0
          || !entry.every(x => typeof x === 'string'))
        throw new Error(
          `${schema.title}: x-unique-constraints[${index}] must be a non-empty array of column names`)

      const columns = entry.map(snakeCase)
      for (const column of columns)
        if (!columnNames.has(column))
          throw new Error(
            `${schema.title}: unique constraint references unknown column "${column}"`)

      const signature = columns.join('::')
      if (seen.has(signature)) return
      seen.add(signature)
      result.push(columns)
    })

    return result
  }

const buildTablePlan =
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
          , drizzle: buildColumn(key, property, isRequired)
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

const sortPlansByDependencies =
  (plans: TablePlan[]) => {
    const byName = new Map(plans.map(x => [x.tableName, x]))
    const state = new Map<string, 'visiting' | 'done'>()
    const sorted: TablePlan[] = []

    const visit =
      (plan: TablePlan) => {
        const current = state.get(plan.tableName)
        if (current === 'done') return
        if (current === 'visiting')
          throw new Error(
            `Cyclic foreign key dependency involving "${plan.tableName}" is not supported yet`)

        state.set(plan.tableName, 'visiting')

        for (const foreignKeyDef of plan.foreignKeys) {
          if (foreignKeyDef.foreignTable === plan.tableName) continue

          const target = byName.get(foreignKeyDef.foreignTable)
          if (!target)
            throw new Error(
              `${plan.tableName}: foreign key references unknown table "${foreignKeyDef.foreignTable}"`)

          visit(target)
        }

        state.set(plan.tableName, 'done')
        sorted.push(plan)
      }

    for (const plan of [...plans].sort(
      (a, b) => a.tableName.localeCompare(b.tableName)))
      visit(plan)

    return sorted
  }

const columnKeyFor =
  (plan: TablePlan, columnName: string) => {
    const column = plan.columns.find(x => x.columnName === columnName)
    if (!column)
      throw new Error(
        `${plan.tableName}: column "${columnName}" does not exist`)
    return column.key
  }

const createDrizzleTable =
  ( plan: TablePlan
  , plansByName: Map<string, TablePlan>
  , tablesByName: Map<string, any>) => {
    const columns =
      Object.fromEntries(plan.columns.map(x => [x.key, x.drizzle]))

    return sqliteTable(plan.tableName, columns, self => {
      const extras: any[] = []

      for (const foreignKeyDef of plan.foreignKeys) {
        const selfReference =
          foreignKeyDef.foreignTable === plan.tableName
        const targetPlan =
          selfReference ? plan : plansByName.get(foreignKeyDef.foreignTable)
        const targetTable =
          selfReference ? self : tablesByName.get(foreignKeyDef.foreignTable)
        if (!targetPlan || !targetTable)
          throw new Error(
            `${plan.tableName}: foreign key target "${foreignKeyDef.foreignTable}" has not been built`)

        const localColumns =
          foreignKeyDef.columns.map(
            x => (self as any)[columnKeyFor(plan, x)]) as [any, ...any[]]
        const targetColumns =
          foreignKeyDef.foreignColumns.map(
            x => targetTable[columnKeyFor(targetPlan, x)]) as [any, ...any[]]

        const builder =
          foreignKey(
            { name: `${plan.tableName}_${foreignKeyDef.columns.join('_')}_fk`
            , columns: localColumns
            , foreignColumns: targetColumns
            })
        if (foreignKeyDef.onDelete) builder.onDelete(foreignKeyDef.onDelete)
        if (foreignKeyDef.onUpdate) builder.onUpdate(foreignKeyDef.onUpdate)
        extras.push(builder)
      }

      const visibility = plan.columns.find(x => x.columnName === 'visibility')
      if (visibility)
        extras.push(
          check(
            `${plan.tableName}_visibility_check`
            , sql.raw(
                `\`visibility\` IN (${plan.access.visibility.map(x => `'${x}'`).join(', ')})`)))

      const checks = plan.schema['x-checks'] ?? []
      if (!Array.isArray(checks) || checks.some(x => typeof x !== 'string'))
        throw new Error(`${plan.schema.title}: x-checks must be a list of SQL expressions`)
      checks.forEach((expression, i) =>
        extras.push(check(`${plan.tableName}_check_${i}`, sql.raw(expression))))

      for (const constraint of plan.uniqueConstraints) {
        const args =
          constraint.map(
            x => (self as any)[columnKeyFor(plan, x)]) as [any, ...any[]]
        extras.push(
          unique(`${plan.tableName}_${constraint.join('_')}_unique`).on(...args))
      }

      for (const columnName of plan.indexes) {
        extras.push(
          index(`${plan.tableName}_${columnName}_index`)
            .on((self as any)[columnKeyFor(plan, columnName)]))
      }

      return extras
    })
  }

export const buildSchema =
  (base: LoadedSchema[]): BuiltSchema => {
    const schemas = deriveSchemas(base)
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

    const tablesByName = new Map<string, any>()
    const builtByName = new Map<string, TableDef>()

    for (const plan of sortPlansByDependencies(plans)) {
      const drizzleSchema =
        createDrizzleTable(plan, plansByName, tablesByName)
      const table: TableDef = { ...plan, drizzleSchema }
      tablesByName.set(plan.tableName, drizzleSchema)
      builtByName.set(plan.tableName, table)
      tables[plan.key] = table
    }

    const orderedTables =
      [...builtByName.values()].sort(
        (a, b) => a.tableName.localeCompare(b.tableName))

    const built: BuiltSchema =
      { tables
      , orderedTables
      , triggers:
          Object.fromEntries(
            orderedTables.map(x => [x.tableName, x.trigger]))
      , views: {}
      }

    return { ...built, views: buildViews(built) }
  }

export type { JSONSchema }
