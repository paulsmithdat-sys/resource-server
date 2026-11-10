export const userRoleSchema =
  { $schema: "https://json-schema.org/draft/2020-12/schema"
  , title: "User Role"
  , type: "object"
  , additionalProperties: false
  , description: "A role held by a user. Only admins can grant, read or revoke roles"
  , "x-system": true
  , "x-access":
    { create: "role"
    , visibility: ["private"]
    , roles: { admin: true }
    , audited: ["create", "update", "delete"]
    }
  , properties:
    { role:
      { description: "Role name, as used in x-access roles"
      , type: "string"
      , minLength: 1
      , maxLength: 50
      }
    }
  , required: ["role"]
  , "x-relations":
    { user:
      { table: "user"
      , column: "id"
      , cardinality: "one"
      , foreignKey: "user_id"
      , required: true
      , onDelete: "cascade"
      , "x-link-any": true
      }
    }
  , "x-unique-constraints": [["user_id", "role"]]
  }
