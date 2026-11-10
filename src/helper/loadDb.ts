import { openDatabase } from '../db/open.ts'

export const db = await openDatabase()
