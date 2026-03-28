import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import "@aws-amplify/ui-react/styles.css";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";
import {
  AmplifyDataProviderFactory,
  AmplifyStorageProvider,
} from "./providers/amplify";

// NOTE: Amplify.configure() removed — auth is now Clerk.
// AmplifyDataProviderFactory and AmplifyStorageProvider still rely on the
// Amplify SDK for AppSync / S3 access. Phase 1 will replace them with
// fetch-based Cloudflare Workers clients, at which point these imports can
// be dropped entirely.
//
// IMPORTANT: AmplifyDataProviderFactory internally calls generateClient()
// which requires Amplify to be configured at module load time via
// amplify_outputs.json. Until Phase 1 lands, we must keep that configuration.
// The import below is intentionally kept; remove alongside Phase 1 data swap.
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string}
    afterSignOutUrl="/"
  >
    <PipeProviderRoot
      providers={{
        data: AmplifyDataProviderFactory,
        storage: AmplifyStorageProvider,
        // auth is provided by ClerkAuthWrapper inside the ClerkAuthGate boundary.
        // See src/App.tsx — ClerkAuthWrapper wraps the protected routes.
      }}
    >
      <App />
    </PipeProviderRoot>
  </ClerkProvider>,
);
