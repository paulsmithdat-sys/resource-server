import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { parseAllDocuments } from 'yaml'
import { isSchemaObject, type LoadedSchema } from './schema-types.ts'

const packageRoot = join(import.meta.dir, '../..')
const schemaRoot = join(import.meta.dir, '../schema')
const systemRoot = join(schemaRoot, 'system')

const SCHEMA_EXTENSIONS = ['.json', '.yaml', '.yml']

const isTestFile = (name: string) => /\.test\.(json|yaml|yml)$/.test(name)

/** Files a schema folder may hold without being schema candidates. */
const isIgnored =
  (name: string) =>
    name.startsWith('.') || name.startsWith('README') || name.startsWith('LICENSE')

/** The schema files directly inside a folder (not its subfolders), failing loudly on anything unrecognized. */
const listSchemaFiles =
  async (dir: string): Promise<string[]> => {
    const files = (await readdir(dir, { withFileTypes: true })).filter(x => x.isFile())
    const candidates = files.filter(x => !isIgnored(x.name) && !isTestFile(x.name))
    const unsupported = candidates.filter(x => !SCHEMA_EXTENSIONS.includes(extname(x.name)))

    if (unsupported.length > 0)
      throw new Error(
        `Unsupported schema files (expected ${SCHEMA_EXTENSIONS.join(' or ')}):\n  `
        + unsupported.map(x => join(dir, x.name)).sort().join('\n  '))
    return candidates.map(x => join(dir, x.name)).sort()
  }

/** Expand a schema path (a folder or one file) into schema files. */
const listSources =
  async (target: string): Promise<string[]> => {
    const info = await stat(target).catch(() => undefined)
    if (!info) throw new Error(`Schema path not found: ${target}`)
    if (info.isDirectory()) return listSchemaFiles(target)
    if (!SCHEMA_EXTENSIONS.includes(extname(target)))
      throw new Error(
        `Unsupported schema file "${target}" (expected ${SCHEMA_EXTENSIONS.join(' or ')})`)
    return [target]
  }

/** The values a file holds: one object for JSON, one per document for YAML. */
const parseFile =
  async (source: string): Promise<unknown[]> => {
    const text = await readFile(source, 'utf8')
    if (extname(source) === '.json')
      try {
        return [JSON.parse(text)]
      } catch (error) {
        throw new Error(`${source}: JSON parse failed: ${(error as Error).message}`)
      }

    const documents = parseAllDocuments(text)
    const errors =
      documents.flatMap((document, index) =>
        document.errors.map(error => `${source}: document ${index + 1}: ${error.message}`))
    if (errors.length > 0) throw new Error(errors.join('\n'))
    if (documents.length === 0)
      throw new Error(`${source}: YAML schema file holds no schema documents`)
    return documents.map(x => x.toJS())
  }

/** Every document in a file is one schema, with its `$ref`s to other files and `$defs` resolved. */
const loadFromFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const base = source.startsWith(packageRoot + sep) ? packageRoot : process.cwd()
    const importPath = relative(base, source).split(sep).join('/')
    const json = extname(source) === '.json'

    return Promise.all((await parseFile(source)).map(async (value, index) => {
      const where = json ? source : `${source}: document ${index + 1}`
      if (!isSchemaObject(value))
        throw new Error(
          json
            ? `${where}: JSON schema file must hold one schema object with a title`
            : `${where} is not a schema object: it needs a title and either properties or type "object"`)
      try {
        const schema =
          await $RefParser.dereference(source, value, { dereference: { circular: false } })
        return { schema: schema as LoadedSchema['schema'], source, importPath }
      } catch (error) {
        throw new Error(`${where}: ${(error as Error).message}`)
      }
    }))
  }

/** Load the built-in system schemas plus every schema in the given folders or files. */
export const loadSchemas =
  async (options?: { schemaDir?: string | string[] }): Promise<LoadedSchema[]> => {
    const schemaDir = options?.schemaDir ?? process.env.SCHEMA_DIR ?? schemaRoot
    const targets = [schemaDir].flat().map(x => resolve(x))
    const files = (await Promise.all([systemRoot, ...targets].map(listSources))).flat()
    const loaded = (await Promise.all([...new Set(files)].map(loadFromFile))).flat()

    return loaded.sort(
      (a, b) =>
        Number(b.schema['x-system'] === true) - Number(a.schema['x-system'] === true)
        || a.schema.title.localeCompare(b.schema.title)
        || a.importPath.localeCompare(b.importPath))
  }
