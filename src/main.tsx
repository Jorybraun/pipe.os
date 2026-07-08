import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";
import type { PipeProviders } from "./providers/types";

// Amplify providers removed in migration; Cloudflare providers not yet wired.
// Hooks (useData, useStorage) throw a clear error at call time if unavailable.
// Clerk authentication fix deployed 2026-07-08 v9 - fix Show component rendering
const providers = {} as PipeProviders;
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const useClerkProvider = Boolean(clerkPublishableKey);

ReactDOM.createRoot(document.getElementById("root")!).render(
  useClerkProvider ? (
    <ClerkProvider publishableKey={clerkPublishableKey ?? ''} afterSignOutUrl="/">
      <PipeProviderRoot providers={providers}>
        <App />
      </PipeProviderRoot>
    </ClerkProvider>
  ) : (
    <PipeProviderRoot providers={providers}>
      <App recruiterAuthUnavailable />
    </PipeProviderRoot>
  ),
);
