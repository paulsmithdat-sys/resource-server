export const requestNonceSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Request Nonce"
  , type: "object"
  , additionalProperties: false
  , description: "Nonces of signed requests, kept until they expire, to block replays"
  , "x-system": true
  , "x-exposed": false
  , properties:
    { session_id:
      { description: "Key-table id of the session that signed the request"
      , type: "string"
      , format: "byte"
      }
    , nonce:
      { description: "Client-chosen random value, unique per session"
      , type: "string"
      , minLength: 16
      , maxLength: 128
      }
    , expires_at:
      { description: "Unix ms after which the nonce can be forgotten"
      , type: "integer"
      }
    }
  , required: ["session_id", "nonce", "expires_at"]
  , "x-unique-constraints": [["session_id", "nonce"]]
  }
