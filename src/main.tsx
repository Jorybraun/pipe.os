import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";
import type { PipeProviders } from "./providers/types";

// Amplify providers removed in migration; Cloudflare providers not yet wired.
// Hooks (useData, useStorage) throw a clear error at call time if unavailable.
const providers = {} as PipeProviders;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string}
    afterSignOutUrl="/"
  >
    <PipeProviderRoot providers={providers}>
      <App />
    </PipeProviderRoot>
  </ClerkProvider>,
);
