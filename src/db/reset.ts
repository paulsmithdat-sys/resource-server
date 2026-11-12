import { access, cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const projectRoot = join(import.meta.dir, '../..')
const backupRoot = '/tmp/opencode'

const paths =
  [ '.migrations'
  , '.db'
  , '.db-shm'
  , '.db-wal'
  ]

const exists =
  async (path: string) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

const main =
  async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(backupRoot, `serber-reset-${stamp}`)
    await mkdir(backupDir, { recursive: true })

    for (const relativePath of paths) {
      const source = join(projectRoot, relativePath)
      if (!await exists(source)) continue
      await cp(source, join(backupDir, relativePath), { recursive: true })
      await rm(source, { recursive: true, force: true })
      console.log(`Moved ${relativePath} to ${backupDir}/${relativePath}`)
    }

    console.log(`Backup: ${backupDir}`)
    console.log('Baseline reset. Run `bun run db:generate` to create a new migration.')
  }

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
