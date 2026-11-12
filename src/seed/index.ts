export { articleSeed, type ArticleSeed } from './article.ts'
export { tagSeed, type TagSeed } from './tag.ts'

import { articleSeed } from './article.ts'
import { tagSeed } from './tag.ts'

/**
 * Tags are listed first so articles can reference them during seeding.
 */
export const seedDocuments = [...tagSeed, ...articleSeed]
