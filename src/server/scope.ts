import type { AppContext, Next } from './context.ts'
import type { Operation } from '../db/schema-types.ts'
import { quote, uuidString } from '../db/views.ts'
import type { Row, RowDatabase } from './database.ts'
import type { Registry, ResourceMeta } from './registry.ts'
import { uuidToBuffer } from './uuid.ts'

// userId set: signed in. anonymous: no session on an x-access "public" operation.
// Neither: the server runs without sessions and applies no scoping.
// signed: this request carried a valid signature.
export type Viewer =
  { userId?: string
  , anonymous?: boolean
  , roles?: string[]
  , signed?: boolean
  }

// An empty sql means "no restriction".
export type Scope = { sql: string, params: unknown[] }

const NONE: Scope = { sql: '', params: [] }
const NEVER: Scope = { sql: '0', params: [] }
const MAX_INHERIT_DEPTH = 3

type Grant = 'can_read' | 'can_write'

export const viewerOf =
  (c: AppContext): Viewer => (
    { userId: c.get('userId')
    , anonymous: c.get('anonymous') === true
    , roles: c.get('roles') ?? []
    , signed: c.get('signed') === true
    })

export const granted =
  (viewer: Viewer, resource: ResourceMeta, operation: Operation) =>
    // Purpose: report whether one of the viewer's roles allows the operation on every row
    Object.entries(resource.access.roles).some(
      ([role, operations]) =>
        operations.includes(operation) && viewer.roles?.includes(role) === true)

const sharedWith =
  (table: string, idSql: string, userId: string, grant: Grant): Scope => {
    // Purpose: SQL that is true when a share grants this user (or one of their groups) the permission
    const user = uuidToBuffer(userId)
    return (
      { sql:
          `EXISTS (SELECT 1 FROM ${quote(`${table}_share`)} AS \`s\``
          + ` WHERE ${uuidString(`\`s\`.${quote(`${table}_id`)}`)} = ${idSql}`
          + ` AND \`s\`.${quote(grant)}`
          + ' AND (`s`.`user_id` = ? OR `s`.`user_group_id` IN'
          + ' (SELECT `m`.`user_group_id` FROM `user_group_membership` AS `m`'
          + ' WHERE `m`.`user_id` = ?)))'
      , params: [user, user]
      })
  }

const anyOf =
  (scopes: Scope[]): Scope => {
    // Purpose: OR scopes together; an unrestricted scope makes the result unrestricted
    if (scopes.some(x => x.sql === '')) return NONE
    return (
      { sql: `(${scopes.map(x => x.sql).join(' OR ')})`
      , params: scopes.flatMap(x => x.params)
      })
  }

export const readScope =
  ( viewer: Viewer
  , resource: ResourceMeta
  , registry: Registry
  , alias = resource.view
  , depth = 0): Scope => {
    // Purpose: restrict reads to rows the viewer owns, may see by visibility, share, role or parent
    if (!viewer.userId && !viewer.anonymous) return NONE
    if (resource.access.signed.includes('read') && !viewer.signed) return NEVER
    if (granted(viewer, resource, 'read')) return NONE

    const a = quote(alias)
    const scopes: Scope[] = []

    if (viewer.userId) {
      scopes.push(
        { sql: `${a}.\`owner\` = ? OR ${a}.\`visibility\` IN ('public', 'authenticated')`
        , params: [viewer.userId]
        })
      if (resource.access.shareable) {
        const shared =
          sharedWith(resource.table, `${a}.\`id\``, viewer.userId, 'can_read')
        scopes.push(
          { sql: `(${a}.\`visibility\` = 'shared' AND ${shared.sql})`
          , params: shared.params
          })
      }
    } else if (resource.access.read === 'public')
      scopes.push({ sql: `${a}.\`visibility\` = 'public'`, params: [] })

    const relation =
      resource.access.inherit
        ? resource.definition.relations[resource.access.inherit]
        : undefined
    const parent = relation ? registry.get(relation.table) : undefined
    if (relation?.foreignKey && parent && depth < MAX_INHERIT_DEPTH) {
      const p = `p${depth}`
      const inner = readScope(viewer, parent, registry, p, depth + 1)
      scopes.push(
        { sql:
            `EXISTS (SELECT 1 FROM ${quote(parent.view)} AS ${quote(p)}`
            + ` WHERE ${quote(p)}.\`id\` = ${a}.${quote(relation.foreignKey)}`
            + (inner.sql ? ` AND ${inner.sql}` : '')
            + ')'
        , params: inner.params
        })
    }

    return scopes.length === 0 ? NEVER : anyOf(scopes)
  }

export const writeScope =
  (viewer: Viewer, resource: ResourceMeta): Scope => {
    // Purpose: restrict updates to rows the user owns, holds a write share on, or has a role for
    if (!viewer.userId) return viewer.anonymous ? NEVER : NONE
    if (granted(viewer, resource, 'update')) return NONE

    const a = quote(resource.view)
    const scopes: Scope[] = [{ sql: `${a}.\`owner\` = ?`, params: [viewer.userId] }]
    if (resource.access.shareable)
      scopes.push(
        sharedWith(resource.table, `${a}.\`id\``, viewer.userId, 'can_write'))
    return anyOf(scopes)
  }

export const deleteScope =
  (viewer: Viewer, resource: ResourceMeta): Scope => {
    // Purpose: restrict deletes to rows the user owns or has a role for
    if (!viewer.userId) return viewer.anonymous ? NEVER : NONE
    if (granted(viewer, resource, 'delete')) return NONE
    return { sql: `${quote(resource.view)}.\`owner\` = ?`, params: [viewer.userId] }
  }

const quickRead =
  (viewer: Viewer, resource: ResourceMeta, row: Row): boolean | undefined => {
    // Purpose: decide from the row alone whether it is readable; undefined means "ask the database"
    if (!viewer.userId && !viewer.anonymous) return true
    if (resource.access.signed.includes('read') && !viewer.signed) return false
    if (viewer.userId
        && (row.owner === viewer.userId
            || row.visibility === 'public'
            || row.visibility === 'authenticated'))
      return true
    if (viewer.anonymous
        && resource.access.read === 'public'
        && row.visibility === 'public')
      return true

    const { shareable, inherit, roles } = resource.access
    return shareable || inherit || Object.keys(roles).length > 0 ? undefined : false
  }

export type RowReader = (table: string, rows: Row[]) => Promise<Row[]>

export const createReader =
  (db: RowDatabase, viewer: Viewer, registry: Registry): RowReader =>
    async (table, rows) => {
      // Purpose: keep only the embedded rows this viewer may read
      const resource = registry.get(table)
      if (!resource) return []

      const result: Row[] = []
      for (const row of rows) {
        let readable = quickRead(viewer, resource, row)
        if (readable === undefined) {
          const scope = readScope(viewer, resource, registry)
          readable =
            await db.get(
              `SELECT 1 AS found FROM ${quote(resource.view)} WHERE \`id\` = ?`
              + (scope.sql ? ` AND ${scope.sql}` : '')
              , [row.id, ...scope.params]) !== undefined
        }
        if (readable) result.push(row)
      }
      return result
    }
