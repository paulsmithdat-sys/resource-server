export type TagSeed =
  { type: 'tag'
  , id: string
  , attributes:
      { name: string
      , kind: 'exam' | 'topic'
      }
  }

/**
 * Each entry is a JSON:API resource object and can be POSTed as `{ "data": entry }`.
 */
export const tagSeed: TagSeed[] =
  [ { type: 'tag'
    , id: '01940000-0000-7000-8000-000000000001'
    , attributes:
      { name: 'sql'
      , kind: 'topic'
      }
    }
  , { type: 'tag'
    , id: '01940000-0000-7000-8000-000000000002'
    , attributes:
      { name: 'database'
      , kind: 'topic'
      }
    }
  , { type: 'tag'
    , id: '01940000-0000-7000-8000-000000000003'
    , attributes:
      { name: 'midterm'
      , kind: 'exam'
      }
    }
  ]
