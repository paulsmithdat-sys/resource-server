import type { ColumnDef, TableDef } from '../db/schema-types.ts'
import { quote, relationJoin, selectSql, uuidString } from '../db/views.ts'
import type { Row, RowDatabase } from './database.ts'
import { badRequest } from './errors.ts'
import type { FilterField, ListQuery } from './query.ts'
import type { ResourceMeta } from './registry.ts'
import type { Scope } from './scope.ts'

export type Tables = Map<string, TableDef>

/** The resource's rows as a sub-select named like its view, embedding only the relations this request needs. */
const sourceSql =
  (tables: Tables, resource: ResourceMeta, query?: Pick<ListQuery, 'fields' | 'include'>) => {
    const selection = query?.fields.get(resource.type)
    const sql =
      selectSql(
        resource.definition
        , tables
        , label =>
            !query || !resource.relationships[label] ? 'none'
            : query.include.includes(label) ? 'full'
            : !selection || selection.has(label) ? 'light'
            : 'none')
    return `(${sql}) AS ${quote(resource.view)}`
  }

/** Convert a filter's text value to the column's stored type. */
const filterValue =
  (column: ColumnDef, key: string, raw: string): unknown => {
    /** Raise the 400 for a value of the wrong type. */
    const fail = (expected: string): never => {
      throw badRequest(`Filter "${key}" expects ${expected}`, key)
    }
    const { type, format } = column.schema
    if (format === 'date-time') {
      const time = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
      return Number.isFinite(time) ? time : fail('a date-time')
    }
    if (type === 'integer' || type === 'number') {
      const value = Number(raw)
      return raw.trim() !== '' && Number.isFinite(value) ? value : fail('a number')
    }
    if (type === 'boolean')
      return raw === 'true' ? 1 : raw === 'false' ? 0 : fail('true or false')
    return raw
  }

const escapeLike =
  (value: string) => value.replace(/[\\%_]/g, x => `\\${x}`)

const comparison: Record<string, string> =
  { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }

/** The condition of one filter on a column of the view aliased `alias`. */
const columnScope =
  (resource: ResourceMeta, alias: string, filter: FilterField): Scope => {
    const { key, field, operator, value } = filter
    const column = resource.definition.columns.find(x => x.columnName === field)!
    const name = `${quote(alias)}.${quote(field)}`
    const typed = (raw: string) => filterValue(column, key, raw)

    if (comparison[operator])
      return { sql: `${name} ${comparison[operator]} ?`, params: [typed(value)] }
    if (operator === 'in' || operator === 'nin') {
      const values = value.split(',').map(typed)
      return (
        { sql:
            `${name} ${operator === 'in' ? 'IN' : 'NOT IN'}`
            + ` (${values.map(() => '?').join(', ')})`
        , params: values
        })
    }
    if (operator === 'null') {
      if (value !== 'true' && value !== 'false')
        throw badRequest(`Filter "${key}" null expects true or false`, key)
      return { sql: `${name} IS ${value === 'true' ? '' : 'NOT '}NULL`, params: [] }
    }

    const pattern =
      { contains: `%${escapeLike(value)}%`
      , starts: `${escapeLike(value)}%`
      , ends: `%${escapeLike(value)}`
      }[operator]
    return { sql: `${name} LIKE ? ESCAPE '\\'`, params: [pattern] }
  }

/** Which related rows a viewer may see, as a condition on a view alias. */
export type ScopeFor = (resource: ResourceMeta, alias: string) => Scope

/**
 * The condition of one filter. A filter through relationships holds when at
 * least one related row the viewer may read matches, so rows they cannot read
 * never affect the result.
 */
const filterScope =
  ( tables: Tables
  , filter: FilterField
  , scopeFor: ScopeFor
  , resource: ResourceMeta
  , alias: string
  , step = 0): Scope => {
    const hop = filter.path[step]
    if (!hop) return columnScope(resource, alias, filter)

    const [s, t, j, f] = ['s', 't', 'j', 'f'].map(x => `${x}${step}`) as [string, string, string, string]
    const relation = hop.from.definition.relations[hop.label]!
    const readable = scopeFor(hop.to, f)
    const inner = filterScope(tables, filter, scopeFor, hop.to, f, step + 1)
    const correlated =
      { sql: `${uuidString(`${quote(s)}.\`id\``)} = ${quote(alias)}.\`id\``, params: [] }
    const where = whereSql([correlated, readable, inner])
    return (
      { sql:
          `EXISTS (SELECT 1 FROM ${quote(hop.from.table)} AS ${quote(s)} `
          + relationJoin(hop.from.definition, relation, tables, s, t, j)
          + ` JOIN ${quote(hop.to.view)} AS ${quote(f)}`
          + ` ON ${quote(f)}.\`id\` = ${uuidString(`${quote(t)}.\`id\``)}`
          + `${where.sql})`
      , params: where.params
      })
  }

/** AND the non-empty scopes into a WHERE clause with its parameters. */
const whereSql =
  (scopes: Scope[]) => {
    const active = scopes.filter(x => x.sql !== '')
    return (
      { sql: active.length ? ` WHERE ${active.map(x => `(${x.sql})`).join(' AND ')}` : ''
      , params: active.flatMap(x => x.params)
      })
  }

export const listRows =
  async ( db: RowDatabase
  , tables: Tables
  , resource: ResourceMeta
  , query: ListQuery
  , scopes: Scope[]
  /** Run a filtered, sorted, paginated list and return the page with the total count. */
  , scopeFor: ScopeFor) => {
    const where =
      whereSql(
        [ ...query.filters.map(x => filterScope(tables, x, scopeFor, resource, resource.view))
        , ...scopes
        ])
    const view = quote(resource.view)
    const order =
      query.sort.length > 0
        ? query.sort
            .map(x => `${view}.${quote(x.field)} ${x.direction.toUpperCase()}`)
            .join(', ')
        : `${view}.\`id\` ASC`

    const total =
      Number(
        (await db.get(
          `SELECT COUNT(*) AS count FROM ${sourceSql(tables, resource)}${where.sql}`
          , where.params))
          ?.count ?? 0)
    const rows =
      await db.all(
        `SELECT * FROM ${sourceSql(tables, resource, query)}${where.sql}`
        + ` ORDER BY ${order} LIMIT ? OFFSET ?`
        , [ ...where.params
          , query.pageSize
          , (query.pageNumber - 1) * query.pageSize
          ])
    return { rows, total }
  }

export const readRow =
  ( db: RowDatabase
  , tables: Tables
  , resource: ResourceMeta
  , query: ListQuery
  , id: string
  /** Read one row by id if it passes the scope. */
  , scope: Scope): Promise<Row | undefined> => {
    const where =
      whereSql([{ sql: `${quote(resource.view)}.\`id\` = ?`, params: [id] }, scope])
    return db.get(
      `SELECT * FROM ${sourceSql(tables, resource, query)}${where.sql} LIMIT 1`
      , where.params)
  }

const ID_CHUNK = 500

/** Read the rows with these ids that pass the scope, embedding the relations the query includes. */
export const readRowsByIds =
  async ( db: RowDatabase
  , tables: Tables
  , resource: ResourceMeta
  , query: Pick<ListQuery, 'fields' | 'include'>
  , ids: string[]
  , scope: Scope) => {
    const rows: Row[] = []
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const chunk = ids.slice(start, start + ID_CHUNK)
      const where =
        whereSql(
          [ { sql: `${quote(resource.view)}.\`id\` IN (${chunk.map(() => '?').join(', ')})`
            , params: chunk
            }
          , scope
          ])
      rows.push(
        ...await db.all(
          `SELECT * FROM ${sourceSql(tables, resource, query)}${where.sql}`, where.params))
    }
    return rows
  }
