import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadSchemas } from '../../../src/db/load-schemas.ts'

let dir = ''

const makeDir =
  async (files: Record<string, string>) => {
    dir = await mkdtemp(join(tmpdir(), 'rs-loader-'))
    for (const [path, content] of Object.entries(files)) {
      const file = join(dir, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    return dir
  }

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  dir = ''
})

const loadUserSchemas =
  async (target: string) => {
    const loaded = await loadSchemas({ schemaDir: target })
    return loaded.filter(x => x.source.startsWith(target))
  }

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

describe('loadSchemas', () => {
  test('loads .json, .yaml and .yml files from a folder, not its subfolders', async () => {
    const target = await makeDir(
      { 'book.json': JSON.stringify(
          { title: 'Book', type: 'object', properties: { name: { type: 'string' } } })
      , 'magazine.yaml': magazineYaml
      , 'note.yml':
          'title: Note\ntype: object\nproperties:\n  body: { type: string }\n'
      , 'nested/pen.yaml':
          'title: Pen\ntype: object\nproperties:\n  color: { type: string }\n'
      , 'README.md': 'docs'
      , '.hidden': 'dotfile'
      , 'skip.test.yaml': 'title: Skip\ntype: object\n'
      })

    const user = await loadUserSchemas(target)
    expect(user.map(x => x.schema.title).sort())
      .toEqual(['Book', 'Issue', 'Magazine', 'Note'])

    // Both YAML documents share one file
    const byTitle = Object.fromEntries(user.map(x => [x.schema.title, x]))
    expect(byTitle.Magazine!.importPath).toBe(byTitle.Issue!.importPath)
  })

  test('resolves $ref to other files and to $defs', async () => {
    const target = await makeDir(
      { 'email.yaml': 'type: string\nformat: email\n'
      , 'person.yaml':
          'title: Person\ntype: object\n$defs:\n  count: { type: integer }\n'
          + 'properties:\n  email: { $ref: email.yaml }\n  visits: { $ref: "#/$defs/count" }\n'
      })

    const person = (await loadUserSchemas(join(target, 'person.yaml')))[0]!
    expect(person.schema.properties).toEqual(
      { email: { type: 'string', format: 'email' }, visits: { type: 'integer' } })
  })

  test('fails when a $ref cannot be resolved', async () => {
    const target = await makeDir(
      { 'person.yaml':
          'title: Person\ntype: object\nproperties:\n  email: { $ref: missing.yaml }\n'
      })
    await expect(loadUserSchemas(join(target, 'person.yaml')))
      .rejects.toThrow('person.yaml: document 1:')
  })

  test('expands a single schema file target', async () => {
    const target = await makeDir({ 'magazine.yaml': magazineYaml })
    const user = await loadUserSchemas(join(target, 'magazine.yaml'))
    expect(user.map(x => x.schema.title).sort()).toEqual(['Issue', 'Magazine'])
  })

  test('fails on a missing schema path', async () => {
    await expect(loadSchemas({ schemaDir: '/nowhere/at/all' }))
      .rejects.toThrow('Schema path not found')
  })

  test('fails on an unsupported single-file target', async () => {
    const target = await makeDir({ 'image.png': 'x' })
    await expect(loadSchemas({ schemaDir: join(target, 'image.png') }))
      .rejects.toThrow('Unsupported schema file')
  })

  test('fails on unsupported files in a schema folder', async () => {
    const target =
      await makeDir(
        { 'book.json': JSON.stringify(
            { title: 'Book', type: 'object', properties: { name: { type: 'string' } } })
        , 'draft.txt': 'not a schema'
        , 'image.png': 'x'
        })

    await expect(loadUserSchemas(target))
      .rejects.toThrow(/Unsupported schema files.*draft\.txt.*image\.png/s)
  })

  test('fails when JSON does not hold one schema object', async () => {
    const target = await makeDir(
      { 'array.json': '[{ "title": "Book" }]'
      , 'scalar.json': '42'
      , 'untitled.json': '{ "type": "object" }'
      })

    for (const file of ['array.json', 'scalar.json', 'untitled.json']) {
      await expect(loadUserSchemas(join(target, file)))
        .rejects.toThrow(`${file}: JSON schema file must hold one schema object`)
    }
  })

  test('fails on invalid JSON syntax', async () => {
    const target = await makeDir({ 'broken.json': '{ "title": ' })
    await expect(loadUserSchemas(target)).rejects.toThrow('JSON parse failed')
  })

  test('fails when a YAML document is not a schema object', async () => {
    const target = await makeDir(
      { 'scalar.yaml': 'hello\n'
      , 'untitled.yaml': 'type: object\n'
      , 'trailing.yaml': 'title: Book\ntype: object\n---\n'
      })

    await expect(loadUserSchemas(join(target, 'scalar.yaml')))
      .rejects.toThrow('document 1 is not a schema object')
    await expect(loadUserSchemas(join(target, 'untitled.yaml')))
      .rejects.toThrow('document 1 is not a schema object')
    await expect(loadUserSchemas(join(target, 'trailing.yaml')))
      .rejects.toThrow('document 2 is not a schema object')
  })

  test('fails when a YAML file holds no documents', async () => {
    const target =
      await makeDir(
        { 'empty.yaml': ''
        , 'comment.yaml': '# only a comment\n'
        })

    for (const file of ['empty.yaml', 'comment.yaml']) {
      await expect(loadUserSchemas(join(target, file)))
        .rejects.toThrow(`${file}: YAML schema file holds no schema documents`)
    }
  })

  test('fails on invalid YAML syntax', async () => {
    const target = await makeDir({ 'broken.yaml': 'title: One\n  bad indent: [\n' })
    await expect(loadUserSchemas(target))
      .rejects.toThrow(/broken\.yaml: document 1: [\s\S]*bad indent/)
  })
})
