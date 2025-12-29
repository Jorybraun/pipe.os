import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Layout, ProfileHeader, SidebarNav } from "./components";
import ListingPage from "./pages/ListingPage";
import OverviewPage from "./pages/OverviewPage";
import PipelineDetailPage from "./pages/PipelineDetailPage";
import CandidateProfilePage from "./pages/CandidateProfilePage";
import CandidateScreeningPage from "./pages/CandidateScreeningPage";
import RoleDiscoveryPage from "./pages/RoleDiscoveryPage";
import { QuestionDetail } from "./components/QuestionDetail";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { SubTitle } from "./components/ui/SubTitle";

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

const SubHeader = () => {
  const navigate = useNavigate();
  const { id, stage, questionId } = useParams();

  // Mock data
  const role = { title: "Senior Full-Stack Engineer" };
  const totalCandidates = 42;
  const currentStage = stage ? { name: stage } : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 32,
        paddingBottom: 20,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <button
          onClick={() => {
            if (questionId && stage) {
              // From question detail -> stage detail
              navigate(`/pipeline/${id}/${stage}`);
            } else if (stage) {
              // From stage detail -> overview
              navigate(`/pipeline/${id}`);
            } else {
              // From overview -> home
              navigate("/");
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.15em",
          }}
        >
          <ArrowLeft size={12} />{" "}
          {questionId && currentStage
            ? `BACK TO ${currentStage.name.toUpperCase()}`
            : stage
            ? "BACK TO OVERVIEW"
            : "BACK TO ROLES"}
        </button>

        <div
          style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }}
        />

        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.2em",
              color: "rgba(255,255,255,0.3)",
              marginBottom: 6,
            }}
          >
            POSITION
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "0.05em",
            }}
          >
            {role.title.toUpperCase()}
          </div>
        </div>

        <div
          style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }}
        />

        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.2em",
              color: "rgba(255,255,255,0.3)",
              marginBottom: 6,
            }}
          >
            ACTIVE CANDIDATES
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              background:
                "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {totalCandidates}
          </div>
        </div>
      </div>

      <SubTitle>PIPELINE_STATUS</SubTitle>
    </div>
  );
};

function AppLayout(): JSX.Element {
  const navigate = useNavigate();
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

  const handleNewRole = (): void => {
    navigate("/pipeline/new");
  };

  return (
    <Layout
      header={
        <ProfileHeader
          title="PIPE_OS"
          subtitle="V.2.0.4"
          actions={
            <button
              onClick={handleNewRole}
              style={{
                padding: "14px 28px",
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                fontSize: 11,
                letterSpacing: "0.15em",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <Plus size={16} />
              CREATE NEW PIPE
            </button>
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
      <SubHeader />
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
