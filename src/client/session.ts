import type { PublicJwk } from './crypto.ts'

export type ResourceServerSession =
  { sessionId: string
  , userId: string
  , expiresAt: string
  , clientPublicKey: PublicJwk
  , serverPublicKey: PublicJwk
  , secretKey: string
  }

export type SessionStorage =
  { getItem: (key: string) => string | null
  , setItem: (key: string, value: string) => void
  , removeItem: (key: string) => void
  }

export const SESSION_STORAGE_KEY = 'resource-server.session'

export const memoryStorage =
  (): SessionStorage => {
    const values = new Map<string, string>()
    return (
      { getItem: key => values.get(key) ?? null
      , setItem: (key, value) => {
          values.set(key, value)
        }
      , removeItem: key => {
          values.delete(key)
        }
      })
  }

export const browserStorage =
  (): SessionStorage | null => {
    try {
      const storage =
        (globalThis as { localStorage?: SessionStorage }).localStorage
      if (storage && typeof storage.getItem === 'function') return storage
    } catch {
      // Some privacy modes throw when localStorage is touched.
    }
    return null
  }

const isSession =
  (value: unknown): value is ResourceServerSession => {
    if (typeof value !== 'object' || value === null) return false
    const session = value as Partial<ResourceServerSession>
    return typeof session.sessionId === 'string'
      && typeof session.userId === 'string'
      && typeof session.expiresAt === 'string'
      && typeof session.secretKey === 'string'
      && typeof session.clientPublicKey === 'object'
      && session.clientPublicKey !== null
      && typeof session.serverPublicKey === 'object'
      && session.serverPublicKey !== null
  }

export type SessionStore =
  { load: () => ResourceServerSession | null
  , save: (session: ResourceServerSession) => void
  , clear: () => void
  , readonly current: ResourceServerSession | null
  }

export const createSessionStore =
  (storage: SessionStorage | null): SessionStore => {
    let current: ResourceServerSession | null = null

    const load =
      () => {
        if (current) return current
        if (!storage) return null

        const text = storage.getItem(SESSION_STORAGE_KEY)
        if (text === null) return null

        try {
          const parsed = JSON.parse(text) as unknown
          const expires = isSession(parsed)
            ? Date.parse(parsed.expiresAt)
            : Number.NaN
          if (!isSession(parsed)
              || !Number.isFinite(expires)
              || expires <= Date.now()) {
            storage.removeItem(SESSION_STORAGE_KEY)
            return null
          }
          current = parsed
          return current
        } catch {
          storage.removeItem(SESSION_STORAGE_KEY)
          return null
        }
      }

    return (
      { load
      , save: session => {
          current = session
          storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
        }
      , clear: () => {
          current = null
          storage?.removeItem(SESSION_STORAGE_KEY)
        }
      , get current() {
          return current
        }
      })
  }
