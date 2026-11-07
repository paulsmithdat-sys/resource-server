export const schemaSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Schema"
  , type: "object"
  , additionalProperties: false
  , description: "A stored JSON Schema definition"
  , "x-system": true
  , properties:
    { table_name:
      { description: "The table generated from this schema"
      , type: "string"
      , minLength: 1
      , maxLength: 100
      , "x-unique": true
      }
    , jsonschema:
      { description: "The JSON Schema document"
      , type: "object"
      }
    }
  }
