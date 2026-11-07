import { Relator, Serializer } from 'ts-japi'
import type { Registry, RelationshipMeta, ResourceMeta } from './registry.ts'

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
  (value: unknown, cardinality: RelationshipMeta['cardinality']) => {
    let parsed = value

    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        parsed = null
      }
    }

    if (parsed === null || parsed === undefined)
      return cardinality === 'many' ? [] : null

    if (cardinality === 'many')
      return Array.isArray(parsed) ? parsed : [parsed]

    return Array.isArray(parsed) ? parsed[0] ?? null : parsed
  }

export const createSerializers =
  ( registry: Registry
  , fields: Map<string, Set<string>>
  , include: string[]
  , primaryType: string): Serializers => {
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
      const relators: Record<string, Relator<any, any>> = {}

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
              parseRelationValue(row[label], relationship.cardinality)
            , target
            , { relatedName: label })
      }

      serializer.setRelators(relators)
    }

    return serializers
  }
