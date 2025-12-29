import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { Layout, ProfileHeader, SidebarNav } from "./components";
import ListingPage from "./pages/ListingPage";
import OverviewPage from "./pages/OverviewPage";
import PipelineDetailPage from "./pages/PipelineDetailPage";
import CandidateProfilePage from "./pages/CandidateProfilePage";
import CandidateScreeningPage from "./pages/CandidateScreeningPage";
import RoleDiscoveryPage from "./pages/RoleDiscoveryPage";
import { QuestionDetail } from "./components/QuestionDetail";
import { ArrowRight } from "lucide-react";

/**
 * AppLayout - Wrapper component that provides consistent Layout to child routes
 *
 * Features:
 * - Shared header with title and subtitle
 * - Shared sidebar navigation
 * - Outlet for nested route content
 */
interface ActionsProps {
  progress?: {
    completeness: number;
    isReady: boolean;
  };
  onContinue?: () => void;
}

const Actions = ({
  progress = { completeness: 45, isReady: false },
  onContinue,
}: ActionsProps) => {
  const handleContinue = () => {
    if (onContinue) {
      onContinue();
    } else {
      console.log("Continue to Phase 2");
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.2em",
            color: "rgba(255,255,255,0.3)",
          }}
        >
          COMPLETENESS
        </span>
        <div
          style={{
            width: 140,
            height: 4,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              width: `${progress.completeness}%`,
              height: "100%",
              background:
                progress.completeness >= 60
                  ? "linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))"
                  : "linear-gradient(90deg, rgba(139, 92, 246, 0.4), rgba(139, 92, 246, 0.8))",
              boxShadow:
                progress.completeness >= 60
                  ? "0 0 12px rgba(150,255,150,0.4)"
                  : "0 0 10px rgba(139, 92, 246, 0.3)",
              transition: "width 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
          {progress.completeness}%
        </span>
      </div>

      <button
        onClick={handleContinue}
        disabled={!progress.isReady}
        style={{
          padding: "12px 24px",
          background: progress.isReady
            ? "linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))"
            : "rgba(255,255,255,0.05)",
          border: `1px solid ${
            progress.isReady ? "rgba(150,255,150,0.3)" : "rgba(255,255,255,0.1)"
          }`,
          color: progress.isReady ? "#fff" : "rgba(255,255,255,0.3)",
          fontSize: 10,
          letterSpacing: "0.15em",
          fontWeight: 700,
          cursor: progress.isReady ? "pointer" : "not-allowed",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: '"Space Mono", monospace',
        }}
      >
        CONTINUE TO PHASE 2
        <ArrowRight size={14} />
      </button>
    </>
  );
};

function AppLayout(): JSX.Element {
  const [activeSection, setActiveSection] = useState("roles");

  // Mock progress data for Actions component
  const mockProgress = {
    completeness: 75,
    isReady: true,
  };

  const handlePhase2Continue = () => {
    console.log("Navigating to Phase 2");
    // Add navigation logic here
  };

  return (
    <Layout
      header={
        <ProfileHeader
          title="PIPE_OS"
          subtitle="V.2.0.4"
          actions={
            null
            // <Actions
            //   progress={mockProgress}
            //   onContinue={handlePhase2Continue}
            // />
            // <InfoBar />
          }
        />
      }
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
      }
    >
      <Outlet />
    </Layout>
  );
}

/**
 * App - Main application component with routing configuration
 *
 * Architecture:
 * - AppLayout wraps routes that need consistent header/sidebar
 * - RoleDiscoveryPage has custom layout (no AppLayout wrapper)
 * - Nested routes use Outlet pattern for composition
 *
 * Routes:
 * - / → ListingPage (main entry point)
 * - /pipeline/new → RoleDiscoveryPage (Phase 1: Role Discovery, custom layout)
 * - /pipeline/:id → OverviewPage (pipeline overview)
 * - /pipeline/:id/:stage → PipelineDetailPage (stage detail, questions list)
 * - /pipeline/:id/:stage/:questionId → QuestionDetail (nested route, question detail)
 * - /candidates/:id → CandidateProfilePage
 * - /screenings/:id/preview → CandidateScreeningPage
 */
function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        {/* Role Discovery - Phase 1 (custom layout, no AppLayout wrapper) */}

        {/* Routes with shared Layout */}
        <Route element={<AppLayout />}>
          {/* Main entry point */}
          <Route path="/" element={<ListingPage />} />

          {/* Pipeline routes */}
          <Route path="/pipeline/:id" element={<OverviewPage />}>
            <Route index element={null} />
            <Route path=":stage" element={<PipelineDetailPage />} />
            <Route path=":stage/:questionId" element={<QuestionDetail />} />
          </Route>

          <Route path="/pipeline/new" element={<RoleDiscoveryPage />} />

          {/* Candidate routes */}
          <Route path="/candidates/:id" element={<CandidateProfilePage />} />
          <Route
            path="/screenings/:id/preview"
            element={<CandidateScreeningPage />}
          />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
