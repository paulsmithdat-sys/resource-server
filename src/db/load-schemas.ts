import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseAllDocuments } from 'yaml'
import
  { isSchemaObject
  , pascalCase
  , type JSONSchema
  , type LoadedSchema
  } from './schema-types.ts'

const packageRoot = join(import.meta.dir, '../..')
const schemaRoot = join(import.meta.dir, '../schema')
const systemRoot = join(schemaRoot, 'system')

const SCHEMA_EXTENSIONS = ['.ts', '.json', '.yaml', '.yml']

const extensionOf =
  (name: string) => {
    const dot = name.lastIndexOf('.')
    return dot === -1 ? '' : name.slice(dot)
  }

const isTestFile = (name: string) => /\.test\.(ts|json|yaml|yml)$/.test(name)

/** Files a schema folder may hold without being schema candidates. */
const isIgnored =
  (name: string) =>
    name.startsWith('.') || name.startsWith('README') || name.startsWith('LICENSE')

const isSchemaFile =
  (name: string) =>
    !isTestFile(name) && SCHEMA_EXTENSIONS.includes(extensionOf(name))

/** Every schema file under dir at any depth, failing loudly on anything unrecognized. */
const listSchemaFiles =
  async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    const unsupported: string[] = []

    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...await listSchemaFiles(path))
        continue
      }
      if (!entry.isFile() || isIgnored(entry.name) || isTestFile(entry.name))
        continue
      if (isSchemaFile(entry.name)) files.push(path)
      else unsupported.push(path)
    }

    if (unsupported.length > 0)
      throw new Error(
        `Unsupported schema files (expected ${SCHEMA_EXTENSIONS.join(' or ')}):\n  `
        + unsupported.sort().join('\n  '))
    return files.sort()
  }

/** Path used to identify a schema file: relative to this package for its own schemas, else to the working directory. */
const importPathOf =
  (source: string) => {
    const base = source.startsWith(packageRoot + sep) ? packageRoot : process.cwd()
    return relative(base, source).split(sep).join('/')
  }

/** Expand a schema path (a folder or one file) into schema files. */
const listSources =
  async (target: string): Promise<string[]> => {
    const info = await stat(target).catch(() => undefined)
    if (!info) throw new Error(`Schema path not found: ${target}`)
    if (info.isDirectory()) return listSchemaFiles(target)
    if (!isSchemaFile(basename(target)))
      throw new Error(
        `Unsupported schema file "${target}" (expected ${SCHEMA_EXTENSIONS.join(' or ')})`)
    return [target]
  }

const loadFromTsFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const module = await import(pathToFileURL(source).href)
    const importPath = importPathOf(source)
    const result: LoadedSchema[] = []
    for (const [exportName, value] of Object.entries(module)) {
      if (!isSchemaObject(value)) continue
      result.push({ schema: value, source, importPath, exportName })
    }
    return result
  }

/** A JSON schema file holds exactly one schema object, or it fails. */
const loadFromJsonFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const text = await readFile(source, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`${source}: JSON parse failed: ${(error as Error).message}`)
    }
    if (!isSchemaObject(value))
      throw new Error(
        `${source}: JSON schema file must hold one schema object with a title`)
    const importPath = importPathOf(source)
    const exportName = source.split(sep).pop()!.replace(/\.json$/, '')
    return [{ schema: value, source, importPath, exportName }]
  }

/** Reject YAML values that cannot be stored as JSON schema data. */
const assertPlainData =
  (value: unknown, context: string): void => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      return
    if (Array.isArray(value)) {
      for (const item of value) assertPlainData(item, context)
      return
    }
    const prototype =
      typeof value === 'object' ? Object.getPrototypeOf(value) : undefined
    if (prototype === Object.prototype || prototype === null) {
      for (const item of Object.values(value as Record<string, unknown>))
        assertPlainData(item, context)
      return
    }
    throw new Error(`${context}: YAML value is not plain JSON data`)
  }

/** Every YAML document in the file is one schema, named by its title rather than the file name. */
const loadFromYamlFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const text = await readFile(source, 'utf8')
    const documents = parseAllDocuments(text)
    const errors =
      documents.flatMap(
        (document, index) =>
          document.errors.map(
            error => `${source}: document ${index + 1}: ${error.message}`))
    if (errors.length > 0) throw new Error(errors.join('\n'))

    if (documents.length === 0)
      throw new Error(`${source}: YAML schema file holds no schema documents`)

    const importPath = importPathOf(source)
    return documents.map((document, index) => {
      const context = `${source}: document ${index + 1}`
      const value = document.toJS()
      assertPlainData(value, context)
      if (!isSchemaObject(value))
        throw new Error(
          `${context} is not a schema object: it needs a title and either`
          + ' properties or type "object"')
      const schema = value as JSONSchema
      return (
        { schema
        , source
        , importPath
        , exportName: `${pascalCase(schema.title)}Schema`
        })
    })
  }

/** Parse one schema file according to its extension. */
const loadFromFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const extension = extensionOf(source)
    if (extension === '.json') return loadFromJsonFile(source)
    if (extension === '.yaml' || extension === '.yml') return loadFromYamlFile(source)
    return loadFromTsFile(source)
  }

/** Load the built-in system schemas plus every schema in the given folders or files. */
export const loadSchemas =
  async (options?: { schemaDir?: string | string[] }): Promise<LoadedSchema[]> => {
    const schemaDir = options?.schemaDir ?? process.env.SCHEMA_DIR ?? schemaRoot
    const targets = [schemaDir].flat().map(x => resolve(x))

    const [systemFiles, userFiles] = await Promise.all([
      listSchemaFiles(systemRoot),
      Promise.all(targets.map(listSources)).then(x => x.flat())
    ])

    const loaded = await Promise.all(
      [...new Set(systemFiles.concat(userFiles))].map(loadFromFile))

    return loaded.flat().sort(
      (a, b) =>
        Number(b.schema['x-system'] === true) - Number(a.schema['x-system'] === true)
        || a.schema.title.localeCompare(b.schema.title)
        || a.importPath.localeCompare(b.importPath)
        || a.exportName.localeCompare(b.exportName))
  }
