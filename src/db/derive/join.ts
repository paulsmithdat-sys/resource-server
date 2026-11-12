import { pascalCase, type JSONSchema, type LoadedSchema } from '../schema-types.ts'
import { DERIVED_SOURCE, DEFAULT_ID, titleFromTableName, resolveTargetProperty, foreignKeyProperty } from './helpers.ts'

export type JoinCandidate =
  { pair: [string, string]
  , label: string
  , explicitThrough: Set<string>
  }

export const deriveJoinTable =
  ( pair: [string, string]
  , through: string
  , schemas: Map<string, LoadedSchema>
  ): LoadedSchema => {
    const [leftTable, rightTable] = pair
    // A self-referential pair needs distinct names for its two sides
    const selfReferential = leftTable === rightTable
    const rightName = selfReferential ? `related_${rightTable}` : rightTable

    const leftSchema = schemas.get(leftTable)!.schema
    const rightSchema = schemas.get(rightTable)!.schema
    const leftColumn = `${leftTable}_id`
    const rightColumn = `${rightName}_id`
    const leftTarget = resolveTargetProperty(leftSchema, leftTable, DEFAULT_ID)
    const rightTarget = resolveTargetProperty(rightSchema, rightTable, DEFAULT_ID)

    const schema: JSONSchema =
      { $schema: 'https://json-schema.org/draft/2020-12/schema'
      , title: titleFromTableName(through)
      , type: 'object'
      , additionalProperties: false
      , description: `Join table between ${leftTable} and ${rightTable}`
      , properties:
        { [leftColumn]: foreignKeyProperty(leftTable, DEFAULT_ID, leftTarget.property)
        , [rightColumn]: foreignKeyProperty(rightTable, DEFAULT_ID, rightTarget.property)
        }
      , required: [leftColumn, rightColumn]
      , 'x-relations':
        { [leftTable]:
          { table: leftTable
          , column: DEFAULT_ID
          , cardinality: 'one'
          , foreignKey: leftColumn
          , required: true
          }
        , [rightName]:
          { table: rightTable
          , column: DEFAULT_ID
          , cardinality: 'one'
          , foreignKey: rightColumn
          , required: true
          }
        }
      , 'x-unique-constraints': [[leftColumn, rightColumn]]
      }

    return (
      { schema
      , source: DERIVED_SOURCE
      , importPath: DERIVED_SOURCE
      })
  }
