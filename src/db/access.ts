import type { AccessConfig, JSONSchema, Operation, Visibility } from './schema-types.ts'

export const VISIBILITIES: Visibility[] = ['private', 'shared', 'authenticated', 'public']
const OPERATIONS: Operation[] = ['read', 'create', 'update', 'delete']
const KEYS =
  [ 'read', 'create', 'visibility', 'defaultVisibility', 'shareable', 'signed'
  , 'roles', 'inherit', 'audited'
  ]

export const normalizeAccess =
  (schema: JSONSchema): AccessConfig => {
    // Purpose: validate a schema's x-access object and fill in the secure defaults
    const fail = (message: string): never => {
      // Purpose: raise a schema error naming the resource
      throw new Error(`${schema.title}: x-access ${message}`)
    }
    const raw = (schema['x-access'] ?? {}) as Record<string, unknown>
    if (typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object')
    for (const key of Object.keys(raw))
      if (!KEYS.includes(key)) fail(`has unknown key "${key}"`)

    const level = <T extends string>(key: string, allowed: T[]) => {
      // Purpose: read a read/create level, defaulting to "session"
      const value = raw[key] ?? 'session'
      if (!allowed.includes(value as T))
        fail(`${key} must be one of ${allowed.join(', ')}`)
      return value as T
    }

    const operations = (key: string, value: unknown): Operation[] => {
      // Purpose: read true/false or a list of operations
      const list =
        value === true ? OPERATIONS
        : value === undefined || value === false ? []
        : value
      if (!Array.isArray(list) || list.some(x => !OPERATIONS.includes(x)))
        fail(`${key} must be a boolean or a list of ${OPERATIONS.join(', ')}`)
      return list as Operation[]
    }

    const shareable = raw.shareable ?? false
    if (typeof shareable !== 'boolean') fail('shareable must be a boolean')

    const visibility =
      (raw.visibility
        ?? VISIBILITIES.filter(x => x !== 'shared' || shareable)) as Visibility[]
    if (!Array.isArray(visibility) || visibility.length === 0
        || visibility.some(x => !VISIBILITIES.includes(x)))
      fail(`visibility must list values from ${VISIBILITIES.join(', ')}`)
    if (visibility.includes('shared') && !shareable)
      fail('visibility "shared" needs shareable: true')

    const defaultVisibility = (raw.defaultVisibility ?? 'private') as Visibility
    if (!visibility.includes(defaultVisibility))
      fail(`defaultVisibility "${defaultVisibility}" is not an allowed visibility`)

    const rawRoles = raw.roles ?? {}
    if (typeof rawRoles !== 'object' || rawRoles === null || Array.isArray(rawRoles))
      fail('roles must be an object of role name to operations')
    const roles =
      Object.fromEntries(
        Object.entries(rawRoles as Record<string, unknown>)
          .map(([role, value]) => [role, operations(`roles.${role}`, value)]))

    if (raw.inherit !== undefined
        && (typeof raw.inherit !== 'string' || raw.inherit.length === 0))
      fail('inherit must name a to-one relation')

    return (
      { read: level('read', ['session', 'public'])
      , create: level('create', ['session', 'public', 'role'])
      , visibility
      , defaultVisibility
      , shareable: shareable as boolean
      , signed: operations('signed', raw.signed)
      , roles
      , ...(raw.inherit ? { inherit: raw.inherit as string } : {})
      , audited: operations('audited', raw.audited)
      })
  }
