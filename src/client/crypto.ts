import { sha256 } from '@noble/hashes/sha2.js'
import nacl from 'tweetnacl'

/** A public Ed25519 key as a JSON Web Key. */
export type PublicJwk =
  { kty: 'OKP'
  , crv: 'Ed25519'
  , x: string
  }

/** A private Ed25519 key as a JSON Web Key. */
export type PrivateJwk =
  PublicJwk & { d: string }

export type KeyPair =
  { publicJwk: PublicJwk
  , privateJwk: PrivateJwk
  , publicKey: Uint8Array
  , secretKey: Uint8Array
  }

/** Encodes bytes as unpadded base64url. */
export const bytesToBase64Url =
  (bytes: Uint8Array) => bytes.toBase64({ alphabet: 'base64url', omitPadding: true })

/**
 * Decodes unpadded base64url into bytes. Rejects anything that is not the
 * canonical encoding: other characters, padding, or non-zero trailing bits.
 */
export const base64UrlToBytes =
  (value: string) => {
    const bytes = Uint8Array.fromBase64(value, { alphabet: 'base64url' })
    if (bytesToBase64Url(bytes) !== value)
      throw new Error('Invalid base64url value')
    return bytes
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

const sha256Base64Url = (bytes: Uint8Array) => bytesToBase64Url(sha256(bytes))

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
  (parts: SigningParts) => {
    const digest = sha256Base64Url(parts.body)
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

/** A fresh random nonce for one signed request. */
export const randomNonce = () => bytesToBase64Url(nacl.randomBytes(16))
