export const auditLogSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "Audit Log"
  , type: "object"
  , additionalProperties: false
  , description: "Append-only record of audited actions. Written by the server; readable by admins"
  , "x-system": true
  , "x-access":
    { create: "role"
    , visibility: ["private"]
    , roles: { admin: ["read"] }
    }
  , properties:
    { actor:
      { description: "User who performed the action, if signed in"
      , type: "string"
      , format: "uuid"
      }
    , action:
      { description: "create, update, delete, login or login_failed"
      , type: "string"
      }
    , resource:
      { description: "Resource type acted on"
      , type: "string"
      }
    , resource_id:
      { description: "Id of the row acted on"
      , type: "string"
      , format: "uuid"
      }
    , signature:
      { description: "Request signature, when the request was signed"
      , type: "string"
      }
    }
  , required: ["action", "resource"]
  }
