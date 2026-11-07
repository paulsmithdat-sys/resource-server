import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSchemaObject, type LoadedSchema } from './schema-types.ts'

const projectRoot = join(import.meta.dir, '../..')
const schemaRoot = join(import.meta.dir, '../schema')
const systemRoot = join(schemaRoot, 'system')

const listSchemaFiles =
  async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(x => x.isFile() && x.name.endsWith('.ts') && !x.name.endsWith('.test.ts'))
      .map(x => join(dir, x.name))
      .sort()
  }

const loadFromFile =
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

export const loadSchemas =
  async (): Promise<LoadedSchema[]> => {
    const [systemFiles, userFiles] = await Promise.all(
      [ listSchemaFiles(systemRoot)
      , listSchemaFiles(schemaRoot)
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
