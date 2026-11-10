export const authLimitSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Auth Limit"
  , type: "object"
  , additionalProperties: false
  , description: "Login rate-limit counters and lockouts, shared by every server process"
  , "x-system": true
  , "x-exposed": false
  , properties:
    { key:
      { description: "What is being counted, e.g. user:alice"
      , type: "string"
      , "x-unique": true
      }
    , count:
      { description: "Events in the current window"
      , type: "integer"
      , default: 0
      }
    , value:
      { description: "Extra data for the key"
      , type: "string"
      }
    , expires_at:
      { description: "Unix ms when the counter or lock ends"
      , type: "integer"
      }
    }
  , required: ["key", "expires_at"]
  }
