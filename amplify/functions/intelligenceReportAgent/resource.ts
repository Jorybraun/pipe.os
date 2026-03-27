import { defineFunction } from "@aws-amplify/backend";

export const intelligenceReportAgent = defineFunction({
  name: "intelligenceReportAgent",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
});
