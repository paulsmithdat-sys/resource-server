import {connect as dbConnect} from "@tursodatabase/database"
const options = {experimental: ["views", "custom_types", "encryption", "vacuum"]}
export const db = await dbConnect(process.env.DB_PATH,options)

/*
console.log(process.env.DB_PATH)
let x = db.prepare('select * from article')
console.log(await x.all())
*/
