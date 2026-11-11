import nacl from 'tweetnacl'

export type PublicJwk =
  { kty: 'OKP'
  , crv: 'Ed25519'
  , x: string
  }

export type PrivateJwk =
  PublicJwk & { d: string }

export type KeyPair =
  { publicJwk: PublicJwk
  , privateJwk: PrivateJwk
  , publicKey: Uint8Array
  , secretKey: Uint8Array
  }

const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const reverse =
  new Map(
    Array.from(alphabet).map((character, index) => [character, index] as const))

/**
 * Encodes bytes as unpadded base64url without relying on Buffer or btoa, so the
 * same code runs in browsers, Bun, and Node.
 */
export const bytesToBase64Url =
  (bytes: Uint8Array) => {
    let value = ''
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index]!
      const second = bytes[index + 1]
      const third = bytes[index + 2]

      value += alphabet[first >> 2]!
      value += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!
      if (second === undefined) break

      value += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!
      if (third === undefined) break

      value += alphabet[third & 0x3f]!
    }
    return value
  }

/**
 * Decodes unpadded base64url into bytes. Rejects characters outside the
 * base64url alphabet and non-zero trailing bits.
 */
export const base64UrlToBytes =
  (value: string) => {
    if (value.length > 0 && !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error('Invalid base64url value')

    const bytes: number[] = []
    let accumulator = 0
    let bits = 0

    for (const character of value) {
      const digit = reverse.get(character)
      if (digit === undefined)
        throw new Error('Invalid base64url value')

      accumulator = (accumulator << 6) | digit
      bits += 6
      if (bits >= 8) {
        bits -= 8
        bytes.push((accumulator >> bits) & 0xff)
      }
    }

    if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0)
      throw new Error('Invalid base64url value')

    return Uint8Array.from(bytes)
  }

/**
 * Generates the fresh Ed25519 keypair used for one registration or login.
 */
export const generateKeyPair =
  (): KeyPair => {
    const pair = nacl.sign.keyPair()
    const publicJwk: PublicJwk =
      { kty: 'OKP'
      , crv: 'Ed25519'
      , x: bytesToBase64Url(pair.publicKey)
      }
    const privateJwk: PrivateJwk =
      { ...publicJwk
      , d: bytesToBase64Url(pair.secretKey.slice(0, nacl.sign.seedLength))
      }

    return (
      { publicJwk
      , privateJwk
      , publicKey: pair.publicKey
      , secretKey: pair.secretKey
      })
  }

const sha256Base64Url =
  async (bytes: Uint8Array) => {
    if (globalThis.crypto?.subtle === undefined)
      throw new Error('Web Crypto is required to sign requests')
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256', new Uint8Array(bytes))
    return bytesToBase64Url(new Uint8Array(digest))
  }

export type SigningParts =
  { method: string
  , path: string
  , sessionId: string
  , timestamp: string
  , nonce: string
  , body: Uint8Array
  }

/**
 * Builds the exact bytes the server verifies for a signed request.
 */
export const signingMessage =
  async (parts: SigningParts) => {
    const digest = await sha256Base64Url(parts.body)
    return new TextEncoder().encode(
      [ 'serber-signature-v1'
      , parts.method.toUpperCase()
      , parts.path
      , parts.sessionId.toLowerCase()
      , parts.timestamp
      , parts.nonce
      , digest
      ].join('\n'))
  }

export const sign =
  (message: Uint8Array, secretKey: string) =>
    bytesToBase64Url(
      nacl.sign.detached(message, base64UrlToBytes(secretKey)))

export const randomNonce =
  () => {
    if (globalThis.crypto?.getRandomValues === undefined)
      throw new Error('Web Crypto is required to sign requests')
    return bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)))
  }
