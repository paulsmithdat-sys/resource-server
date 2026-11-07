export const userSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "User"
  , type: "object"
  , additionalProperties: false
  , description: "An application user"
  , "x-system": true
  , properties:
    { username:
      { description: "Unique login name"
      , type: "string"
      , minLength: 1
      , maxLength: 100
      , "x-unique": true
      }
    , email:
      { description: "Email address"
      , type: "string"
      , format: "email"
      , maxLength: 255
      , "x-unique": true
      }
    , display_name:
      { description: "Display name"
      , type: "string"
      , maxLength: 100
      }
    }
  , "x-relations":
    { keys:
      { table: "key"
      , column: "id"
      , cardinality: "many"
      }
    , groups:
      { table: "group"
      , column: "id"
      , cardinality: "many"
      , through: "user_group"
      }
    }
  }
