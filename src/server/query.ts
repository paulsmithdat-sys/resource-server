import type { Registry, RelationshipMeta, ResourceMeta } from './registry.ts'
import { badRequest } from './errors.ts'

export type SortField =
  { field: string
  , direction: 'asc' | 'desc'
  }

export const FILTER_OPERATORS =
  ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'nin', 'contains', 'starts', 'ends', 'null']

/** One `filter[path.field][operator]=value` parameter, with its relationship path resolved. */
export type FilterField =
  { key: string
  /** The relationships followed from the requested resource, in order (empty for its own columns). */
  , path: { from: ResourceMeta, label: string, to: ResourceMeta }[]
  , field: string
  , operator: string
  , value: string
  }

export type ListQuery =
  { pageNumber: number
  , pageSize: number
  , sort: SortField[]
  , filters: FilterField[]
  , fields: Map<string, Set<string>>
  /** The relationships to include directly, the first step of each `include` path. */
  , include: string[]
  /** All `include` paths as a tree: `a.b` puts b under a. */
  , includeTree: IncludeTree
  }

/** Relationship labels to include, each with what to include through it. */
export type IncludeTree = Map<string, IncludeTree>

const MAX_INCLUDE_DEPTH = 3

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
  (params: URLSearchParams, resource: ResourceMeta, registry: Registry) => {
    const result: FilterField[] = []

    for (const [key, value] of params) {
      if (!key.startsWith('filter')) continue
      const match = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(key)
      if (!match)
        throw badRequest(
          'Filters must look like filter[field]=value or filter[field][operator]=value', key)

      const [, name, operator = 'eq'] = match
      const labels = name!.split('.')
      const field = labels.pop()!
      if (labels.length > MAX_INCLUDE_DEPTH)
        throw badRequest(
          `Filter path "${name}" is deeper than ${MAX_INCLUDE_DEPTH} relationships`, key)

      const path: FilterField['path'] = []
      let target = resource
      for (const label of labels) {
        const relationship = target.relationships[label]
        const next = relationship && registry.get(relationship.type)
        if (!next)
          throw badRequest(
            `Unknown relationship "${label}" for resource "${target.type}"`, key)
        path.push({ from: target, label, to: next })
        target = next
      }
      if (!target.columns.includes(field))
        throw badRequest(`Cannot filter by unknown field "${name}"`, key)
      if (!FILTER_OPERATORS.includes(operator))
        throw badRequest(
          `Unknown filter operator "${operator}"; use one of ${FILTER_OPERATORS.join(', ')}`, key)
      result.push({ key, path, field, operator, value })
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

/** Read `include=a,b.c` into a tree, checking every step names a relationship of the resource before it. */
const parseInclude =
  (params: URLSearchParams, resource: ResourceMeta, registry: Registry) => {
    const tree: IncludeTree = new Map()

    for (const entry of (params.get('include') ?? '').split(',')) {
      const path = entry.trim()
      if (path.length === 0) continue

      const labels = path.split('.')
      if (labels.length > MAX_INCLUDE_DEPTH)
        throw badRequest(
          `Include path "${path}" is deeper than ${MAX_INCLUDE_DEPTH} relationships`, 'include')

      let level = tree
      let from: ResourceMeta | undefined = resource
      for (const label of labels) {
        const relationship: RelationshipMeta | undefined = from?.relationships[label]
        if (!from || !relationship)
          throw badRequest(
            `Unknown relationship "${label}" for resource "${from?.type ?? path}"`, 'include')
        if (!level.has(label)) level.set(label, new Map())
        level = level.get(label)!
        from = registry.get(relationship.type)
      }
    }

    return tree
  }

export const parseListQuery =
  ( params: URLSearchParams
  , resource: ResourceMeta
  , registry: Registry): ListQuery => {
    const includeTree = parseInclude(params, resource, registry)
    return (
    { pageNumber:
        integerParameter(params, 'page[number]', 1, 1, 1_000_000)
    , pageSize:
        integerParameter(
          params, 'page[size]', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    , sort: parseSort(params, resource)
    , filters: parseFilters(params, resource, registry)
    , fields: parseFields(params, registry)
    , include: [...includeTree.keys()]
    , includeTree
    })
  }
