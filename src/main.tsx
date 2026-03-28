import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import "@aws-amplify/ui-react/styles.css";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";
import {
  AmplifyDataProviderFactory,
  AmplifyStorageProvider,
} from "./providers/amplify";

// Initialize Amplify SDK — required for the Amplify provider implementations.
// This stays here even after the Cloudflare migration; Phase 1 will swap out
// AmplifyDataProviderFactory and AmplifyStorageProvider, at which point
// Amplify.configure() can be removed.
Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <PipeProviderRoot
    providers={{
      data: AmplifyDataProviderFactory,
      storage: AmplifyStorageProvider,
      // auth is provided by AmplifyAuthWrapper inside the Authenticator boundary.
      // See src/App.tsx — AmplifyAuthWrapper wraps the protected routes.
    }}
  >
    <App />
  </PipeProviderRoot>,
);
