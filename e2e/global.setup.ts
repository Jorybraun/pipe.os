import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  if (!process.env.CLERK_PUBLISHABLE_KEY && !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    console.warn("[global.setup] Clerk publishable key missing; skipping Clerk setup for unauthenticated specs.");
    return;
  }
  await clerkSetup();
}
