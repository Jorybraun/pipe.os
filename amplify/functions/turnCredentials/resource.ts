import { defineFunction, secret } from "@aws-amplify/backend";

export const turnCredentials = defineFunction({
  runtime: 22,
  environment: {
    METERED_API_KEY: secret('METERED_API_KEY'),
  },
});
