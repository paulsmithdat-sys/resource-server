import type { ColumnDef, TableDef } from '../db/schema-types.ts'
import { quote, selectSql } from '../db/views.ts'
import type { Row, RowDatabase } from './database.ts'
import { badRequest } from './errors.ts'
import type { FilterField, ListQuery } from './query.ts'
import type { ResourceMeta } from './registry.ts'
import type { Scope } from './scope.ts'

export type Tables = Map<string, TableDef>

const sourceSql =
  (tables: Tables, resource: ResourceMeta, query?: ListQuery) => {
    // Purpose: the resource's rows as a sub-select named like its view, embedding only the relations this request needs
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

const filterValue =
  (column: ColumnDef, field: string, raw: string): unknown => {
    // Purpose: convert a filter's text value to the column's stored type
    const fail = (expected: string): never => {
      // Purpose: raise the 400 for a value of the wrong type
      throw badRequest(`Filter "${field}" expects ${expected}`, `filter[${field}]`)
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

const filterScope =
  (resource: ResourceMeta, filter: FilterField): Scope => {
    // Purpose: turn one filter[field][operator]=value into parameterized SQL
    const { field, operator, value } = filter
    const column = resource.definition.columns.find(x => x.columnName === field)!
    const name = `${quote(resource.view)}.${quote(field)}`
    const typed = (raw: string) => filterValue(column, field, raw)

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
        throw badRequest(
          `Filter "${field}" null expects true or false`, `filter[${field}][null]`)
      return { sql: `${name} IS ${value === 'true' ? '' : 'NOT '}NULL`, params: [] }
    }

    const pattern =
      { contains: `%${escapeLike(value)}%`
      , starts: `${escapeLike(value)}%`
      , ends: `%${escapeLike(value)}`
      }[operator]
    return { sql: `${name} LIKE ? ESCAPE '\\'`, params: [pattern] }
  }

const whereSql =
  (scopes: Scope[]) => {
    // Purpose: AND the non-empty scopes into a WHERE clause with its parameters
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
  , scopes: Scope[]) => {
    // Purpose: run a filtered, sorted, paginated list and return the page with the total count
    const where =
      whereSql([...query.filters.map(x => filterScope(resource, x)), ...scopes])
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
  , scope: Scope): Promise<Row | undefined> => {
    // Purpose: read one row by id if it passes the scope
    const where =
      whereSql([{ sql: `${quote(resource.view)}.\`id\` = ?`, params: [id] }, scope])
    return db.get(
      `SELECT * FROM ${sourceSql(tables, resource, query)}${where.sql} LIMIT 1`
      , where.params)
  }
