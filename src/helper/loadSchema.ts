import Z from '@consoleillusion/zamda'
import { readdir, path } from "node:fs/promises"
import { join } from 'node:path'

const dir = join(import.meta.dir,'../schema/')

export const loadSchema =
  async () => Z.pipeSync(
    [ Z.filter(x => x.endsWith(".ts") && x !== 'schema.ts')
    , Z.map(x => import(join(dir,x)))
    , Z.promiseAll
    , Z.chain(Object.values)
    ]) (await readdir(dir))


loadSchema()
