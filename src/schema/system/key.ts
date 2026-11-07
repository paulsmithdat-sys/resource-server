export const keySchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Key"
  , type: "object"
  , additionalProperties: false
  , description: "A user-owned cryptographic key"
  , "x-system": true
  , properties:
    { jwk:
      { description: "JSON Web Key representation"
      , type: "object"
      }
    }
  , "x-relations":
    { user:
      { table: "user"
      , column: "id"
      , cardinality: "one"
      , foreignKey: "user_id"
      , onDelete: "restrict"
      }
    }
  }
