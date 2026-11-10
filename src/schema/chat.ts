export const chatSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Chat"
  , type: "object"
  , additionalProperties: false
  , description: "A conversation its owner shares with users or groups"
  , "x-access": { shareable: true }
  , properties:
    { name:
      { description: "Chat name"
      , type: "string"
      , minLength: 1
      , maxLength: 100
      }
    }
  , required: ["name"]
  , "x-relations":
    { messages:
      { table: "message"
      , cardinality: "many"
      }
    }
  }
