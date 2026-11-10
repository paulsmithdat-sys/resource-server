export const tagSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Tag"
  , type: "object"
  , additionalProperties: false
  , description: "Tag"
  , "x-access": { "read": "public" }
  , properties:
    { name:
      { description: "name"
      , type: "string"
      , minLength: 1
      , maxLength: 100
      }
    , kind:
      { description: "What the tag refers to"
      , type: "string"
      , enum: ["exam", "topic"]
      }
    }
  }
