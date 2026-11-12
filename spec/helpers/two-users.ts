import { signIn } from './session.ts'
import { createTestServer } from './test-server.ts'

/** Build a session-protected server with alice and bob signed in. */
export const twoUsers =
  async () => {
    const server = await createTestServer({ session: true })
    const alice = await signIn(server.app, 'alice')
    const bob = await signIn(server.app, 'bob')
    return { ...server, alice, bob }
  }

export const body = async (response: Response) => await response.json() as any
