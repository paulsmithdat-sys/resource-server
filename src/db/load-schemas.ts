import { readdir } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSchemaObject, type LoadedSchema } from './schema-types.ts'

const projectRoot = join(import.meta.dir, '../..')
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

const loadFromTsFile =
  async (source: string): Promise<LoadedSchema[]> => {
    const module = await import(pathToFileURL(source).href)
    const importPath = relative(projectRoot, source).split(sep).join('/')
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
      const importPath = relative(projectRoot, source).split(sep).join('/')
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
  async (options?: { schemaDir?: string }): Promise<LoadedSchema[]> => {
    const schemaDir = options?.schemaDir ?? process.env.SCHEMA_DIR ?? schemaRoot

    const [systemFiles, userFiles] = await Promise.all([
      listSchemaFiles(systemRoot),
      listSchemaFiles(schemaDir)
    ])

    const loaded = await Promise.all(
      systemFiles.concat(userFiles).map(loadFromFile))

    return loaded.flat().sort(
      (a, b) =>
        Number(b.schema['x-system'] === true) - Number(a.schema['x-system'] === true)
        || a.schema.title.localeCompare(b.schema.title)
        || a.importPath.localeCompare(b.importPath)
        || a.exportName.localeCompare(b.exportName))
  }
