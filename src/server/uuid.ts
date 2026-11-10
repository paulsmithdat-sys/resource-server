export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const newUuid =
  () => Bun.randomUUIDv7()

export const canonicalUuid =
  (value: unknown) => {
    if (typeof value === 'string' && UUID_PATTERN.test(value))
      return value.toLowerCase()

    if (value instanceof Uint8Array) {
      if (value.length !== 16)
        throw new Error('Database returned a UUID with an invalid length')
      const hex = Buffer.from(value).toString('hex')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
        + `-${hex.slice(16, 20)}-${hex.slice(20)}`
    }

    throw new Error('Expected a UUID')
  }

export const uuidToBuffer =
  (value: string) => {
    if (!UUID_PATTERN.test(value))
      throw new Error(`"${value}" is not a canonical UUID`)
    return Buffer.from(value.replaceAll('-', ''), 'hex')
  }
