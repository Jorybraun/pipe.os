import { defineFunction } from "@aws-amplify/backend";

export const turnCredentialsAgent = defineFunction({
  name: "turnCredentialsAgent",
  runtime: 22,
  environment: {
    METERED_API_KEY: process.env.METERED_API_KEY,
  },
});
