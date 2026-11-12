import type { BuiltSchema } from '../../db/schema-types.ts'
import type { RowDatabase } from '../database.ts'
import type { Registry } from '../registry.ts'
import type { Validator } from '../ajv.ts'
import { type Viewer } from '../scope.ts'


export type MutationContext =
  { built: BuiltSchema
  , db: RowDatabase
  , registry: Registry
  , userId?: string
  , anonymous?: boolean
  , roles?: string[]
  , signed?: boolean
  , isOwner?: boolean
  }

export const viewerIn =
  (context: MutationContext): Viewer => (
    { userId: context.userId
    , anonymous: context.anonymous
    , roles: context.roles
    , signed: context.signed
    })

export type WriteDocument =
  { id?: string
  , attributes: Record<string, unknown>
  , relationships: Map<string, string | null | string[]>
  }

export type Mode = 'create' | 'put' | 'patch'

export type AttributeValidator = Validator
