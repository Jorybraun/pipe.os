import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  // Legacy Todo model (keeping for now, can remove later)
  Todo: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * RoleContext Model
   *
   * Stores role discovery session state and outputs.
   * Each session is owned by the creating user (Cognito auth).
   */
  RoleContext: a
    .model({
      // Session ID (auto-generated)
      id: a.id().required(),

      // Owner (from Cognito auth)
      owner: a.string(),

      // Baseline (Part 1 - structured fields)
      title: a.string(),
      level: a.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager']),
      department: a.string(),
      workModel: a.enum(['remote', 'hybrid', 'onsite']),
      teamSize: a.string(),
      reportsTo: a.string(),
      stack: a.string().array(),

      // Dynamic context (Part 2 - JSON blob)
      // DynamicContext: Record<string, string | string[]>
      context: a.json(),

      // Conversation history (JSON blob)
      // Exchange[]
      exchanges: a.json(),

      // Status tracking
      status: a.enum(['baseline', 'exploring', 'almost_ready', 'ready']),
      gaps: a.string().array(),

      // User persona signals (JSON blob)
      userSignals: a.json(),

      // Generated outputs (when ready)
      jobDescription: a.json(),      // JobDescription
      candidateFilters: a.json(),    // CandidateFilter[]
      suggestedStages: a.json(),     // SuggestedStage[]

      // Metadata
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),  // Only the creator can access their role context
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',  // Changed to userPool for owner auth
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
