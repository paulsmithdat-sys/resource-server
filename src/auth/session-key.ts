/** Derive the key-table id stored for a session, so the database never holds the bearer token. */
export const sessionKeyId =
  (token: string) => {
    const digest =
      new Bun.CryptoHasher('sha256')
        .update(`serber-session:${token.toLowerCase()}`)
        .digest()
    return new Uint8Array(digest).slice(0, 16)
  }
