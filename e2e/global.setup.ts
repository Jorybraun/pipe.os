import { clerkSetup } from "@clerk/testing/playwright";

export function shouldSkipClerkGlobalSetup(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PIPE_SKIP_CLERK_GLOBAL_SETUP === '1'
    || env.PLAYWRIGHT_SKIP_CLERK_GLOBAL_SETUP === '1';
}

export default async function globalSetup() {
  if (shouldSkipClerkGlobalSetup()) {
    return;
  }
  await clerkSetup();
}
