import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Write the file (creating folders) only when its content differs. */
export const writeIfChanged =
  async (path: string, content: string) => {
    const previous = await readFile(path, 'utf8').catch(() => undefined)
    if (previous === content) return false
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
    return true
  }
