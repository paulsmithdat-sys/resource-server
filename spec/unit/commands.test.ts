import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResourceServerClient, memoryStorage } from '../../src/client/index.ts'

const cli = join(import.meta.dir, '../../src/cli.ts')
let project = ''

const book =
  (extra: Record<string, unknown> = {}) =>
    JSON.stringify(
      { title: 'Book'
      , type: 'object'
      , additionalProperties: false
      , properties: { name: { type: 'string' }, ...extra }
      })

const magazineYaml = `
title: Magazine
type: object
properties:
  name: { type: string }
---
title: Issue
type: object
properties:
  number: { type: integer }
`

/** Run the CLI in the throwaway project with a clean environment plus the given variables. */
const run =
  (args: string[], env: Record<string, string> = {}) => {
    const result =
      Bun.spawnSync(
        [process.execPath, cli, ...args],
        { cwd: project
        , env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }
        })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'rs-cli-'))
  await mkdir(join(project, 'schemas'))
  await writeFile(join(project, 'schemas/book.json'), book())
  await writeFile(join(project, 'schemas/magazine.yaml'), magazineYaml)
})

afterAll(() => rm(project, { recursive: true, force: true }))

describe('resource-server init and serve', () => {
  let key = ''

  test('init generates migrations, config and a new server key', async () => {
    const result = run(['init', 'schemas'])
    expect(result.code).toBe(0)
    key = result.out.match(/OPAQUE_SERVER_SETUP=(\S+)/)?.[1] ?? ''
    expect(key.length).toBeGreaterThan(20)
    const config = JSON.parse(await readFile(join(project, '.resource-server/config.json'), 'utf8'))
    expect(config.schemas).toEqual(['schemas'])
    expect(await readFile(join(project, '.resource-server/.gitignore'), 'utf8')).toContain('exports.ts')
  }, 60_000)

  test('init again keeps an existing key and prints none', () => {
    const result = run(['init', 'schemas'], { OPAQUE_SERVER_SETUP: key })
    expect(result.code).toBe(0)
    expect(result.out).toContain('was kept')
    expect(result.out).not.toContain(`OPAQUE_SERVER_SETUP=${key}`)
  }, 60_000)

  test('serve refuses to start without the server key', () => {
    const result = run(['serve'])
    expect(result.code).toBe(1)
    expect(result.out).toContain('OPAQUE_SERVER_SETUP is required')
  })

  test('serve starts and enforces sessions on every resource', async () => {
    const port = 5900 + Math.floor(Math.random() * 90)
    const baseUrl = `http://localhost:${port}`
    const child =
      Bun.spawn(
        [process.execPath, cli, 'serve', '--port', String(port)],
        { cwd: project
        , env: { PATH: process.env.PATH ?? '', OPAQUE_SERVER_SETUP: key }
        , stdout: 'ignore'
        , stderr: 'ignore'
        })
    try {
      let status: number | undefined
      for (let i = 0; i < 50 && status === undefined; i++) {
        status = await fetch(`${baseUrl}/`).then(x => x.status).catch(() => undefined)
        if (status === undefined) await Bun.sleep(200)
      }
      // Sessions are enforced, so the catalog is closed to anonymous callers
      expect(status).toBe(401)

      const client = createResourceServerClient({ baseUrl, storage: memoryStorage() })
      await client.register({ username: 'tester', password: 'correct horse battery staple' }, { signIn: true })
      const catalog = await client.get<{ meta: { resources: { type: string }[] } }>('/')
      const types = catalog.meta.resources.map(x => x.type)
      expect(types).toContain('book')
      // Both YAML documents from one file become their own tables
      expect(types).toContain('magazine')
      expect(types).toContain('issue')
    } finally {
      child.kill()
    }
  }, 30_000)

  test('serve refuses stale schemas until init is run again', async () => {
    await writeFile(join(project, 'schemas/book.json'), book({ author: { type: 'string' } }))
    const stale = run(['serve'], { OPAQUE_SERVER_SETUP: key })
    expect(stale.code).toBe(1)
    expect(stale.out).toContain('schemas changed')

    const again = run(['init', 'schemas'], { OPAQUE_SERVER_SETUP: key })
    expect(again.code).toBe(0)
    expect(again.out).toContain('was kept')
  }, 60_000)
})
