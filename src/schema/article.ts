export const articleSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Article"
  , type: "object"
  , additionalProperties: false
  , description: "A blog article"
  , properties:
    { heading:
      { description: "Heading"
      , type: "string"
      , minLength: 2
      , maxLength: 100
      }
    , subheading:
      { description: "Subheading"
      , type: "string"
      , minLength: 1
      , maxLength: 100
      }
    , content:
      { description: "Article content. MDX"
      , type: "string"
      }
    }
  , "x-relations":
    { tag:
      { table: "tag"
      , column: "id"
      , cardinality: "many"
      }
    }
  }
