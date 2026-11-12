import { Relator, Serializer } from 'ts-japi'
import type { Row } from './database.ts'
import type { Registry, RelationshipMeta, ResourceMeta } from './registry.ts'
import type { RowReader } from './scope.ts'

export type Serializers = Map<string, Serializer<Record<string, unknown>>>

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
  , read: RowReader) => {
    // Purpose: decode an embedded relation, keeping only rows the viewer may read
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

export const createSerializers =
  ( registry: Registry
  , fields: Map<string, Set<string>>
  , include: string[]
  , primaryType: string
  , read: RowReader = async (_table, rows) => rows): Serializers => {
    const serializers: Serializers = new Map()

    for (const resource of registry.resources.values()) {
      const projection =
        Object.fromEntries(
          selectedAttributes(resource, fields).map(x => [x, 1])) as Record<string, 0 | 1>
      serializers.set(
        resource.type
        , new Serializer(resource.type, { projection }))
    }

    for (const resource of registry.resources.values()) {
      const serializer = serializers.get(resource.type)!
      const relators: Record<string, Relator<Row, Row>> = {}

      for (const label of
        (resource.type === primaryType
          ? selectedRelationships(resource, fields, include)
          : [])) {
        const relationship = resource.relationships[label]!
        const target = serializers.get(relationship.type)
        if (!target) continue

        relators[label] =
          new Relator(
            async (row: Record<string, unknown>) =>
              parseRelationValue(row[label], relationship, read)
            , target
            , { relatedName: label })
      }

      serializer.setRelators(relators)
    }

    return serializers
  }
