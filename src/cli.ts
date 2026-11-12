#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { config } from 'dotenv'

config({ quiet: true })

const { defaultDir, init, serve } = await import('./commands.ts')

const usage = `resource-server: JSON Schema in, JSON:API server out

  resource-server init <schema…> [--dir ${defaultDir}]
      Generate the database migrations for the schema folder(s) or file(s)
      into --dir, and print the settings to add to .env. Run it again after
      every schema change. An existing OPAQUE_SERVER_SETUP is never replaced.

  resource-server serve [--dir ${defaultDir}] [--port 5734]
      Apply the migrations and start the server.
`

/** Run the init or serve command named on the command line. */
const main =
  async () => {
    const { positionals, values } =
      parseArgs(
        { allowPositionals: true
        , options:
          { dir: { type: 'string', default: defaultDir }
          , port: { type: 'string' }
          , help: { type: 'boolean', short: 'h' }
          }
        })
    const [command, ...rest] = positionals

    if (command === 'init') return init({ schemas: rest, dir: values.dir })
    if (command === 'serve')
      return serve(
        { dir: values.dir
        , port: values.port === undefined ? undefined : Number(values.port)
        })
    console.log(usage)
    if (!values.help && command !== undefined) process.exitCode = 1
  }

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
