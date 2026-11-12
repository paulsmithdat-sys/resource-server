import type { TagSeed } from './tag.ts'

export type ArticleSeed =
  { type: 'article'
  , id: string
  , attributes:
      { heading: string
      , subheading: string
      , content: string
      }
  , relationships:
      { tag:
          { data:
              { type: TagSeed['type']
              , id: string
              }[]
          }
      }
  }

/**
 * Each entry is a JSON:API resource object and can be POSTed as `{ "data": entry }`.
 * Tag ids refer to entries in `tagSeed`; seed tags before articles.
 */
export const articleSeed: ArticleSeed[] =
  [ { type: 'article'
    , id: '01940000-0000-7000-8000-000000000101'
    , attributes:
      { heading: 'Getting started with SQL'
      , subheading: 'Queries, tables, and joins'
      , content: 'A practical introduction to SQL using SQLite.'
      }
    , relationships:
      { tag:
        { data:
          [ { type: 'tag'
            , id: '01940000-0000-7000-8000-000000000001'
            }
          , { type: 'tag'
            , id: '01940000-0000-7000-8000-000000000002'
            }
          ]
        }
      }
    }
  , { type: 'article'
    , id: '01940000-0000-7000-8000-000000000102'
    , attributes:
      { heading: 'Exam preparation checklist'
      , subheading: 'What to review first'
      , content: 'A short checklist for preparing for the database exam.'
      }
    , relationships:
      { tag:
        { data:
          [ { type: 'tag'
            , id: '01940000-0000-7000-8000-000000000002'
            }
          , { type: 'tag'
            , id: '01940000-0000-7000-8000-000000000003'
            }
          ]
        }
      }
    }
  ]
