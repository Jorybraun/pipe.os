import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";
import type { PipeProviders } from "./providers/types";

// Amplify providers removed in migration; Cloudflare providers not yet wired.
// Hooks (useData, useStorage) throw a clear error at call time if unavailable.
const providers = {} as PipeProviders;
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function MissingAuthConfiguration(): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0c0c0e",
        color: "#f7f7fb",
        fontFamily: '"Space Mono", monospace',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(255,255,255,0.05)",
          padding: 32,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.24em",
            color: "rgba(255,255,255,0.54)",
            marginBottom: 14,
          }}
        >
          PIPE_OS
        </div>
        <h1 style={{ fontSize: 24, lineHeight: 1.2, margin: "0 0 12px" }}>
          Auth configuration missing
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.68)", margin: 0 }}>
          This deployment needs VITE_CLERK_PUBLISHABLE_KEY at build time before the recruiter app can load.
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  clerkPublishableKey ? (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <PipeProviderRoot providers={providers}>
        <App />
      </PipeProviderRoot>
    </ClerkProvider>
  ) : (
    <PipeProviderRoot providers={providers}>
      <MissingAuthConfiguration />
    </PipeProviderRoot>
  ),
);
