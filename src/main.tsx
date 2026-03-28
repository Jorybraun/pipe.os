import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App.tsx";
import "./index.css";
import { PipeProviderRoot } from "./providers/DataContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string}
    afterSignOutUrl="/"
  >
    <PipeProviderRoot providers={{}}>
      <App />
    </PipeProviderRoot>
  </ClerkProvider>,
);
