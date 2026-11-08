import {connect as dbConnect} from "@tursodatabase/database"
import type { DatabaseOpts } from "@tursodatabase/database-common"
const options: DatabaseOpts = { experimental: ["views", "custom_types", "encryption", "vacuum"] }
export const db = await dbConnect(process.env.DB_PATH ?? '.db', options)

await db.exec('PRAGMA foreign_keys = ON')

/*
console.log(process.env.DB_PATH)
let x = db.prepare('select * from article')
console.log(await x.all())
*/
