import nacl from 'tweetnacl'

export type PublicJwk =
  { kty: 'OKP'
  , crv: 'Ed25519'
  , x: string
  }

export type PrivateJwk =
  PublicJwk & { d: string }

const base64Url =
  (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

const fromBase64Url =
  (value: string) => Buffer.from(value, 'base64url')

import { isObject } from '../server/guard.ts'

export const generateKeyPair =
  () => {
    const seed = nacl.randomBytes(nacl.sign.seedLength)
    const pair = nacl.sign.keyPair.fromSeed(seed)
    const publicJwk: PublicJwk =
      { kty: 'OKP'
      , crv: 'Ed25519'
      , x: base64Url(pair.publicKey)
      }
    const privateJwk: PrivateJwk =
      { ...publicJwk
      , d: base64Url(seed)
      }

    return { publicJwk, privateJwk, publicKey: pair.publicKey, secretKey: pair.secretKey }
  }

export const parsePublicJwk =
  (value: unknown): PublicJwk => {
    if (!isObject(value)
        || value.kty !== 'OKP'
        || value.crv !== 'Ed25519'
        || typeof value.x !== 'string'
        || value.x.length === 0
        || value.d !== undefined)
      throw new Error('Expected an Ed25519 public JWK')

    const key = fromBase64Url(value.x)
    if (key.length !== nacl.sign.publicKeyLength)
      throw new Error('Ed25519 public key has an invalid length')

    return { kty: 'OKP', crv: 'Ed25519', x: value.x }
  }

export const parsePrivateJwk =
  (value: unknown): PrivateJwk => {
    if (!isObject(value)
        || value.kty !== 'OKP'
        || value.crv !== 'Ed25519'
        || typeof value.x !== 'string'
        || typeof value.d !== 'string')
      throw new Error('Expected an Ed25519 private JWK')

    const seed = fromBase64Url(value.d)
    if (seed.length !== nacl.sign.seedLength)
      throw new Error('Ed25519 private key has an invalid length')

    const derived = nacl.sign.keyPair.fromSeed(seed)
    if (base64Url(derived.publicKey) !== value.x)
      throw new Error('Ed25519 private JWK does not match its public key')

    return { kty: 'OKP', crv: 'Ed25519', x: value.x, d: value.d }
  }

export const publicJwkFromPrivate =
  (value: unknown): PublicJwk => {
    const privateJwk = parsePrivateJwk(value)
    return { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x }
  }
