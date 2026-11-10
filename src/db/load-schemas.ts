import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSchemaObject, type LoadedSchema } from './schema-types.ts'

const packageRoot = join(import.meta.dir, '../..')
const schemaRoot = join(import.meta.dir, '../schema')
const systemRoot = join(schemaRoot, 'system')

const schemaFile = (name: string) =>
  (name.endsWith('.ts') || name.endsWith('.json')) && !name.endsWith('.test.ts')

const listSchemaFiles =
  async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(x => x.isFile() && schemaFile(x.name))
      .map(x => join(dir, x.name))
      .sort()
  }

const importPathOf =
  (source: string) => {
    // Purpose: path used to identify a schema file: relative to this package for its own schemas, else to the working directory
    const base = source.startsWith(packageRoot + sep) ? packageRoot : process.cwd()
    return relative(base, source).split(sep).join('/')
  }

const listSources =
  async (target: string): Promise<string[]> => {
    // Purpose: expand a schema path (a folder or one file) into schema files
    const info = await stat(target).catch(() => undefined)
    if (!info) throw new Error(`Schema path not found: ${target}`)
    return info.isDirectory() ? listSchemaFiles(target) : [target]
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

const loadFromJsonFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const text = await readFile(source, 'utf8')
    const value = JSON.parse(text) as unknown
    const result: LoadedSchema[] = []
    if (isSchemaObject(value)) {
      const importPath = importPathOf(source)
      const exportName = source.split(sep).pop()!.replace(/\.json$/, '')
      result.push({ schema: value, source, importPath, exportName })
    }
    return result
  }

const loadFromFile =
  async (source: string): Promise<LoadedSchema[]> =>
    source.endsWith('.json')
      ? loadFromJsonFile(source)
      : loadFromTsFile(source)

export const loadSchemas =
  async (options?: { schemaDir?: string | string[] }): Promise<LoadedSchema[]> => {
    // Purpose: load the built-in system schemas plus every schema in the given folders or files
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
