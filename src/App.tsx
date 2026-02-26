import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { Layout, ProfileHeader, SidebarNav } from "./components";
import ListingPage from "./pages/ListingPage";
import OverviewPage from "./pages/OverviewPage";
import PipelineDetailPage from "./pages/PipelineDetailPage";
import CandidateProfilePage from "./pages/CandidateProfilePage";
import CandidateScreeningPage from "./pages/CandidateScreeningPage";
import RoleDiscoveryPage from "./pages/RoleDiscoveryPage"; // Legacy — preserved for post-MVP agentic discovery
import PipelineCreatePage from "./pages/PipelineCreatePage";
import { QuestionDetail } from "./components/QuestionDetail";
import { ArrowLeft, Plus, LogOut } from "lucide-react";
import { SubTitle } from "./components/ui/SubTitle";

/**
 * AppLayout - Wrapper component that provides consistent Layout to child routes
 *
 * Features:
 * - Shared header with title and subtitle
 * - Shared sidebar navigation
 * - Outlet for nested route content
 */

const SubHeader = () => {
  const navigate = useNavigate();
  const { id, stage, questionId } = useParams();
  const location = useLocation();

  // Only render on pipeline context routes — not on shell pages like / or /pipeline/new
  const isPipelineContext =
    location.pathname.startsWith("/pipeline/") &&
    !location.pathname.startsWith("/pipeline/new");

  if (!isPipelineContext) return null;

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
  const { signOut } = useAuthenticator();

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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
              <button
                onClick={signOut}
                style={{
                  padding: "14px 18px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.2s ease",
                }}
                title="Sign out"
              >
                <LogOut size={14} />
                SIGN OUT
              </button>
            </div>
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
  const content = (
    <BrowserRouter>
      <Routes>
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

          {/* MVP: simplified create form. RoleDiscoveryPage preserved for post-MVP agent flow. */}
          <Route path="/pipeline/new" element={<RoleDiscoveryPage />} />
          <Route
            path="/pipeline/new/discovery"
            element={<RoleDiscoveryPage />}
          />

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

  // Temporary bypass for E2E tests
  if (import.meta.env.VITE_SKIP_AUTH === 'true') {
    return content;
  }

  return <Authenticator>{content}</Authenticator>;
}

export default App;
