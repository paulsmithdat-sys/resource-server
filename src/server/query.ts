import type { Registry, ResourceMeta } from './registry.ts'
import { badRequest } from './errors.ts'

export type SortField =
  { field: string
  , direction: 'asc' | 'desc'
  }

export const FILTER_OPERATORS =
  ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'nin', 'contains', 'starts', 'ends', 'null']

export type FilterField =
  { field: string
  , operator: string
  , value: string
  }

export type ListQuery =
  { pageNumber: number
  , pageSize: number
  , sort: SortField[]
  , filters: FilterField[]
  , fields: Map<string, Set<string>>
  , include: string[]
  }

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export { quote as quoteIdentifier } from '../db/views.ts'

/** List `name[inner]=value` query parameters as [key, inner, value]. */
const bracketed =
  (params: URLSearchParams, name: string) =>
    [...params].flatMap(([key, value]) => {
      const match = new RegExp(`^${name}\\[([^\\]]+)\\]$`).exec(key)
      return match ? [[key, match[1]!, value] as const] : []
    })

const integerParameter =
  ( params: URLSearchParams
  , name: string
  , fallback: number
  , min: number
  , max: number) => {
    const raw = params.get(name)
    if (raw === null) return fallback
    if (!/^\d+$/.test(raw))
      throw badRequest(`"${name}" must be a positive integer`, name)

    const value = Number(raw)
    if (value < min || value > max)
      throw badRequest(
        `"${name}" must be between ${min} and ${max}`, name)
    return value
  }

const parseSort =
  (params: URLSearchParams, resource: ResourceMeta) => {
    const raw = params.get('sort')
    if (raw === null) return []

    const allowed = new Set(resource.columns)
    const result: SortField[] = []

    for (const entry of raw.split(',')) {
      const item = entry.trim()
      if (item.length === 0)
        throw badRequest('"sort" contains an empty field', 'sort')

      const descending = item.startsWith('-')
      const field = descending ? item.slice(1) : item
      if (!allowed.has(field))
        throw badRequest(
          `Cannot sort by unknown field "${field}"`, 'sort')
      result.push({ field, direction: descending ? 'desc' : 'asc' })
    }

    return result
  }

/** Read filter[field]=value and filter[field][operator]=value parameters. */
const parseFilters =
  (params: URLSearchParams, resource: ResourceMeta) => {
    const allowed = new Set(resource.columns)
    const result: FilterField[] = []

    for (const [key, value] of params) {
      if (!key.startsWith('filter')) continue
      const match = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(key)
      if (!match)
        throw badRequest(
          'Filters must look like filter[field]=value or filter[field][operator]=value', key)

      const [, field, operator = 'eq'] = match
      if (!allowed.has(field!))
        throw badRequest(`Cannot filter by unknown field "${field}"`, key)
      if (!FILTER_OPERATORS.includes(operator))
        throw badRequest(
          `Unknown filter operator "${operator}"; use one of ${FILTER_OPERATORS.join(', ')}`, key)
      result.push({ field: field!, operator, value })
    }

    return result
  }

const parseFields =
  (params: URLSearchParams, registry: Registry) => {
    const fields = new Map<string, Set<string>>()

    for (const [key, type, value] of bracketed(params, 'fields')) {
      const resource = registry.get(type)
      if (!resource)
        throw badRequest(`Unknown resource type "${type}"`, key)

      const allowed = new Set<string>(
        [ ...resource.attributes
        , ...Object.keys(resource.relationships)
        ])
      const selected = new Set<string>()

      for (const entry of value.split(',')) {
        const field = entry.trim()
        if (field.length === 0) continue
        if (!allowed.has(field))
          throw badRequest(
            `Unknown field "${field}" for resource "${type}"`, key)
        selected.add(field)
      }

      fields.set(type, selected)
    }

    return fields
  }

const parseInclude =
  (params: URLSearchParams, resource: ResourceMeta) => {
    const raw = params.get('include')
    if (raw === null) return []

    const result: string[] = []
    for (const entry of raw.split(',')) {
      const label = entry.trim()
      if (label.length === 0) continue
      if (!resource.relationships[label])
        throw badRequest(
          `Unknown relationship "${label}" for resource "${resource.type}"`, 'include')
      if (!result.includes(label)) result.push(label)
    }

    return result
  }

export const parseListQuery =
  ( params: URLSearchParams
  , resource: ResourceMeta
  , registry: Registry): ListQuery => (
    { pageNumber:
        integerParameter(params, 'page[number]', 1, 1, 1_000_000)
    , pageSize:
        integerParameter(
          params, 'page[size]', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    , sort: parseSort(params, resource)
    , filters: parseFilters(params, resource)
    , fields: parseFields(params, registry)
    , include: parseInclude(params, resource)
    })
