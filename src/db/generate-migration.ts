import { timestamp, real, blob, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'
import {sql} from 'drizzle-orm'
import Z from '@consoleillusion/zamda'
//import * as R from 'ramda'
import { appendFile, readdir, writeFile, mkdir} from "node:fs/promises"
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from "node:child_process"
import { readdirSync, appendFileSync } from "node:fs"

const schemaDir          = join(import.meta.dir,'../schema/')
const migrationsDir      = join(import.meta.dir,'../../.drizzle/')
const drizzleConfig      = join(import.meta.dir,'../../drizzle.config.ts')
const generatedExportDir = join(import.meta.dir,'../../.drizzleExports')
await mkdir(generatedExportDir, { recursive: true })

const getLastMigrationPath =
  async () => await Z.pipeSync(
    [ readdir
    , dirs => dirs.sort().at(-1)!
    , async (dir) => [dir, await readdir(join(migrationsDir, dir))] as const
    , ([dir, files]) => join(migrationsDir, dir, files.find((f) => f.endsWith(".sql"))!)
    ]) (migrationsDir)

const extensions = 
  x => t => x['x-unique']
          ? t.unique()
          : t

const loadSchema =
  () => Z.pipeSync(
    [ Z.logPipe
    , Z.filter(x => x.endsWith(".ts") && x !== 'schema.ts')
    , Z.map(x => import(join(schemaDir, x)))
    , Z.promiseAll
    , Z.chain(Object.values)
    ]) (readdir(schemaDir))

const toDrizzleColumnType = Z.cond(
  [ [ x => x.type === 'string' && x.format === 'uuid'
    , x => blob(x.tableName).default(sql`(uuid7())`)
    ]
  , [ x => x.type === 'string' && x.format === 'date-time'
    , x => integer({mode:'timestamp'}).defaultNow().notNull()
    ]
  , [ Z.propEq('string')('type')
    , x => text(x.tableName)
    ]
  , [ Z.propEq('integer')('type')
    , x => integer(x.tableName)
    ]
  , [ Z.propEq('number')('type')
    , x => real(x.tableName)
    ]
  , [ Z.propEq('boolean')('type')
    , x => integer(x.tableName, { mode: 'boolean' })
    ]
  , [ Z.propEq('object')('type')
    , x => blob(x.tableName)
    ]
  , [ Z.propEq('array')('type')
    , x => blob(x.tableName)
    ]
  , [ Z.T
    , x => text(x.tableName)
    ]
  ])

const createModifiedTrigger =
  tableName => `
CREATE TRIGGER IF NOT EXISTS ${tableName}_updated
AFTER UPDATE ON ${tableName}
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE ${tableName}
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END`;

const defaultColumns =
  { id:         {type: 'string', format: 'uuid', 'x-primary': true}
  , updated_at: {type: 'string', format: 'date-time'}
  }
const toDrizzleExtensions = 
  s => d => s['x-primary'] ? d.primaryKey() : d

const toDrizzleTable =
  schema => Z.pipe(
    [ Z.prop('properties')
    , Z.mergeRight(defaultColumns)
    , Z.toPairs
    , Z.map(([key, value]) => Z.assoc('columnName', key, value))
    , Z.map(s => 
         [s.columnName, Z.pipe(
		 [ toDrizzleColumnType, toDrizzleExtensions(s) ]
	 )(s)]
      )
    , Object.fromEntries
    , x => {
      const drizzleSchema = sqliteTable(Z.snakeCase(schema.title), x)
      const trigger = createModifiedTrigger(Z.snakeCase(schema.title))
      return {drizzleSchema,trigger,schema}
    }
    ])(schema)
    
const schemas = await loadSchema()
const defaultTables =
  [ {title: "Schema",properties:{table_name:{type:"string"},jsonschema:{type: "object"}}}
  , {title: "User",properties:{username:{type:"string"},email:{type:"string",format:"email"}}}
  , {title: "User Group",properties:{username:{type:"string"},email:{type:"string",format:"email"}}}
  , {title: "User Group2",properties:{username:{type:"string"},email:{type:"string",format:"email"}}}
  , {title: "Key", type: "object", additionalProperties: false, description: "Cryptographic Key", properties: { user_id: { description: "The owner of the key", type: "string", minLength: 0, maxLength: 100 }, key_data: { type: "string" }, longevity: { type: "string", enum: ['session','id'] }, purpose: { type: "string", enum: ['encryption','signing'] } }, "x-relations": { tag: { table: "user", column: "id", cardinality: "one" } } }
  ].map(Z.assoc("$schema","https://json-schema.org/draft/2020-12/schema"))

export const tables = Z.map(toDrizzleTable,schemas.concat(defaultTables)).reduce(
	(acc,cur) => {
	  const t = Z.pascalCase(cur.schema.title)
	  acc[t] = cur
	  return acc
	} , {})

const main =
  async () => {
    await writeFile( join(generatedExportDir,'index.ts')
                   , `import {tables} from '../src/db/generate-migration.ts'\n\n`
	             + Z.keys(tables).map(t=>`export const ${t} = tables['${t}'].drizzleSchema`).join('\n')
		   , "utf8"
		   )
    execSync(`bunx --bun drizzle-kit generate --config=${drizzleConfig}  --name=initial`, { stdio: "inherit" });
    await appendFile( join(await getLastMigrationPath())
		   , Z.values(tables).map(x=>'--> statement-breakpoint'+x['trigger']+';').join('\n')
	           , "utf8"
		   )
  }
main()

/*
*/
