import { clerkSetup } from "@clerk/testing/playwright";

export function shouldSkipClerkGlobalSetup(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PIPE_SKIP_CLERK_GLOBAL_SETUP === '1'
    || env.PLAYWRIGHT_SKIP_CLERK_GLOBAL_SETUP === '1';
}

export default async function globalSetup() {
  if (shouldSkipClerkGlobalSetup()) {
    console.warn("[global.setup] Clerk setup skipped by environment flag.");
    return;
  }
  if (!process.env.CLERK_PUBLISHABLE_KEY && !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    console.warn("[global.setup] Clerk publishable key missing; skipping Clerk setup for unauthenticated specs.");
    return;
  }
  await clerkSetup();
}
