export const noteSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Note"
  , type: "object"
  , additionalProperties: false
  , description: "A private note that its owner can share with users or groups"
  , "x-access": { shareable: true }
  , properties:
    { title:
      { description: "Title"
      , type: "string"
      , minLength: 1
      , maxLength: 200
      }
    , body:
      { description: "Note text"
      , type: "string"
      }
    }
  , required: ["title"]
  }
