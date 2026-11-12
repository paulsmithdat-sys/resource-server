import type { ApiDocument, ResourceObject } from './app/document.ts'
import type { Row } from './database.ts'
import type { Registry, RelationshipMeta, ResourceMeta } from './registry.ts'
import type { IncludeTree } from './query.ts'
import type { RowReader } from './scope.ts'

const selectedAttributes =
  (resource: ResourceMeta, fields: Map<string, Set<string>>) => {
    const selection = fields.get(resource.type)
    if (!selection) return resource.attributes
    return resource.attributes.filter(x => selection.has(x))
  }

const selectedRelationships =
  ( resource: ResourceMeta
  , fields: Map<string, Set<string>>
  , include: string[]) => {
    const selection = fields.get(resource.type)
    const selected =
      selection
        ? Object.keys(resource.relationships)
            .filter(x => selection.has(x))
        : Object.keys(resource.relationships)

    for (const label of include)
      if (resource.relationships[label] && !selected.includes(label))
        selected.push(label)

    return selected
  }

const parseRelationValue =
  async ( value: unknown
  , relationship: RelationshipMeta
  /** Decode an embedded relation, keeping only rows the viewer may read. */
  , read: RowReader) => {
    let parsed = value
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        parsed = null
      }
    }

    const all =
      parsed === null || parsed === undefined ? [] : [parsed].flat() as Row[]
    const readable = await read(relationship.table, all)
    // x-link-any relations (shares, group members) keep the ids of unreadable rows
    const rows =
      relationship.linkAny
        ? all.map(x => readable.includes(x) ? x : { id: x.id })
        : readable
    return relationship.cardinality === 'many' ? rows : rows[0] ?? null
  }

/** Loads readable rows of a resource by id, embedding the given relationships (used to follow nested includes). */
export type RowExpander =
  (resource: ResourceMeta, ids: string[], labels: string[]) => Promise<Row[]>

const identifier = (target: ResourceMeta) => (row: Row) => ({ type: target.type, id: String(row.id) })

/**
 * Builds a JSON:API document for a row or rows: relationship linkage for the
 * primary resources, and `included` for every path in the include tree.
 * Rows reached through a nested path are loaded with `expand`, which applies
 * the viewer's read access again at each step.
 */
export const createSerializer =
  ( registry: Registry
  , fields: Map<string, Set<string>>
  , tree: IncludeTree
  , primaryType: string
  , read: RowReader
  , expand: RowExpander) => {
    const included = new Map<string, ResourceObject>()

    const toObject =
      (resource: ResourceMeta, row: Row): ResourceObject => (
        { type: resource.type
        , id: String(row.id)
        , attributes:
            Object.fromEntries(
              selectedAttributes(resource, fields)
                .filter(x => x in row)
                .map(x => [x, row[x]]))
        , relationships: {}
        })

    /** Add linkage for `labels` to the objects of `rows`, and collect what the tree includes. */
    const link =
      async ( resource: ResourceMeta
      , rows: Row[]
      , objects: Map<string, ResourceObject>
      , labels: string[]
      , level: IncludeTree): Promise<void> => {
        for (const label of labels) {
          const relationship = resource.relationships[label]!
          const target = registry.resources.get(relationship.type)
          if (!target) continue

          const related: Row[] = []
          for (const row of rows) {
            const value = await parseRelationValue(row[label], relationship, read)
            const found = [value ?? []].flat() as Row[]
            objects.get(String(row.id))!.relationships![label] =
              { data:
                  Array.isArray(value) ? found.map(identifier(target))
                  : found[0] ? identifier(target)(found[0])
                  : null
              }
            related.push(...found)
          }

          const below = level.get(label)
          if (!below) continue

          const reached = new Map<string, ResourceObject>()
          for (const row of related) {
            const key = `${target.type}:${row.id}`
            if (!included.has(key)) included.set(key, toObject(target, row))
            reached.set(String(row.id), included.get(key)!)
          }
          if (below.size === 0 || reached.size === 0) continue

          const next = [...below.keys()]
          await link(target, await expand(target, [...reached.keys()], next), reached, next, below)
        }
      }

    return async (data: Row | Row[]): Promise<ApiDocument> => {
      const resource = registry.resources.get(primaryType)!
      const rows = [data].flat()
      const objects = new Map(rows.map(x => [String(x.id), toObject(resource, x)]))
      await link(resource, rows, objects, selectedRelationships(resource, fields, [...tree.keys()]), tree)

      const document: ApiDocument =
        { data: Array.isArray(data) ? rows.map(x => objects.get(String(x.id))!) : objects.get(String(data.id))! }
      if (tree.size > 0) {
        for (const key of objects.keys()) included.delete(`${primaryType}:${key}`)
        document.included = [...included.values()]
      }
      return document
    }
  }
