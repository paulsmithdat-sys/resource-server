export const keySchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Key"
  , type: "object"
  , additionalProperties: false
  , description: "A user-owned cryptographic key or authentication record"
  , "x-system": true
  , "x-exposed": false
  , properties:
    { type:
      { description: "The kind of key material stored in this row"
      , type: "string"
      , enum:
          [ "jwk"
          , "opaque_registration"
          , "opaque_login_state"
          , "session"
          ]
      , default: "jwk"
      }
    , jwk:
      { description: "JSON Web Key representation"
      , type: "object"
      }
    , client_jwk:
      { description: "Client JSON Web Key for a login or session"
      , type: "object"
      }
    , material:
      { description: "Opaque serialized authentication material"
      , type: "string"
      }
    , expires_at:
      { description: "Expiry time for temporary authentication state"
      , type: "string"
      , format: "date-time"
      }
    , consumed_at:
      { description: "Time this one-time authentication state was consumed"
      , type: "string"
      , format: "date-time"
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
