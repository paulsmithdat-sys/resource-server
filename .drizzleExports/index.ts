import {tables} from '../src/db/generate-migration.ts'

export const Tag = tables['Tag'].drizzleSchema
export const Article = tables['Article'].drizzleSchema
export const Schema = tables['Schema'].drizzleSchema
export const User = tables['User'].drizzleSchema
export const UserGroup = tables['UserGroup'].drizzleSchema
export const UserGroup2 = tables['UserGroup2'].drizzleSchema
export const Key = tables['Key'].drizzleSchema