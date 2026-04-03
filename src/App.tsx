import { useState, useEffect } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FEATURE_FLAGS } from "./config/featureFlags";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { ClerkAuthGate, ClerkAuthWrapper } from "./providers/clerk";
import { useAuth } from "./providers";
import { Layout, SidebarNav } from "./components";
import ListingPage from "./pages/ListingPage";
import OverviewPage from "./pages/OverviewPage";
import StageDetailPage from "./pages/StageDetailPage";
import ChallengeDndLayout from "./pages/ChallengeDndLayout";
import CandidateProfilePage from "./pages/CandidateProfilePage";
import CandidateScreeningPage from "./pages/CandidateScreeningPage";
import PipelineCreatePage from "./pages/archived/PipelineCreatePage";
import ChallengeEditorPage from "./pages/ChallengeEditorPage";
import CandidateAssessmentPage from "./pages/CandidateAssessmentPage";
import SchedulingPage from "./pages/SchedulingPage";
import DevContainerSandboxPage from "./pages/DevContainerSandboxPage";
import CandidateReportPrototype from "./pages/CandidateReportPrototype";
import { ArrowLeft, Plus, LogOut } from "lucide-react";
import Logo from "./components/ui/Logo";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { useAuth as useClerkAuth } from "@clerk/react";
import { DisplaySettingsPanel } from "./components/DisplaySettingsPanel";
import { StageConfigPanel } from "./components/StageConfigPanel";

/**
 * SubHeader - Main interactive UI for navigation and context
 */
const SubHeader = () => {
  const navigate = useNavigate();
  const { id, stage, questionId } = useParams();
  const location = useLocation();
  const auth = useAuth();

  const isCandidateContext = location.pathname.startsWith("/candidates/");

  const headerData = { title: "PIPE_OS", count: 0 };

  const handleNewRole = (): void => {
    navigate("/pipeline/new");
  };

  const currentStage = stage ? { title: stage } : null;
  const isHome = location.pathname === "/";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 0,
        padding: 20,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <div style={{ width: 40, height: 40 }}>
          <Logo />
        </div>

        {!isHome && (
          <>
            <button
              onClick={() => {
                if (questionId && stage) {
                  navigate(`/pipeline/${id}/${stage}`);
                } else if (stage) {
                  navigate(`/pipeline/${id}`);
                } else {
                  navigate(-1);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "transparent",
                border: "none",
                color: "var(--pipe-text-muted)",
                cursor: "pointer",
                fontSize: 10,
                letterSpacing: "0.15em",
              }}
            >
              <ArrowLeft size={12} />{" "}
              {questionId && currentStage
                ? `BACK TO ${currentStage.title.toUpperCase()}`
                : stage
                  ? "BACK TO OVERVIEW"
                  : "BACK"}
            </button>

            <div
              style={{
                width: 1,
                height: 40,
                background: "var(--pipe-surface-hover)",
              }}
            />

            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "var(--pipe-text-dim)",
                  marginBottom: 6,
                }}
              >
                {isCandidateContext ? "CANDIDATE" : "POSITION"}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  letterSpacing: "0.05em",
                }}
              >
                {headerData.title.toUpperCase()}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleNewRole}
          style={{
            padding: "14px 28px",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))",
            border: "1px solid var(--pipe-border)",
            color: "var(--pipe-text, #fff)",
            fontSize: 11,
            letterSpacing: "0.15em",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Plus size={16} />
          CREATE NEW PIPE
        </button>
        <button
          onClick={() => void auth.signOut()}
          style={{
            padding: "14px 18px",
            background: "transparent",
            border: "1px solid var(--pipe-border)",
            color: "var(--pipe-text-muted)",
            fontSize: 11,
            letterSpacing: "0.15em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          title="Sign out"
        >
          <LogOut size={14} />
          SIGN OUT
        </button>
      </div>
    </div>
  );
};

/**
 * AppLayout - Wrapper component that provides consistent Layout to child routes
 */
function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("roles");
  const [showSettings, setShowSettings] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const configStageId = searchParams.get('config');

  const closeConfig = (): void => {
    setSearchParams((prev) => { prev.delete('config'); return prev; }, { replace: true });
  };

  // Determine which panel to show (stage config takes priority)
  const panelContent = configStageId
    ? <StageConfigPanel stageId={configStageId} onClose={closeConfig} />
    : showSettings
      ? <DisplaySettingsPanel onClose={() => { setShowSettings(false); setActiveSection("roles"); }} />
      : undefined;

  const isPanelOpen = !!configStageId || showSettings;

  return (
    <Layout
      header={<SubHeader />}
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onRolesClick={() => {
            setActiveSection("roles");
            setShowSettings(false);
            closeConfig();
            navigate("/");
          }}
          {...(FEATURE_FLAGS.FEATURE_FLAG_SCHEDULE_ROUTE
            ? {
                onScheduleClick: () => {
                  setActiveSection("schedule");
                  setShowSettings(false);
                  navigate("/schedule");
                },
              }
            : {})}
          {...(FEATURE_FLAGS.FEATURE_FLAG_CODE_SANDBOX
            ? {
                onSandboxClick: () => {
                  setActiveSection("sandbox");
                  setShowSettings(false);
                  navigate("/sandbox/dev-container");
                },
              }
            : {})}
          onSettingsClick={() => {
            if (configStageId) closeConfig();
            setShowSettings((prev) => !prev);
            if (!showSettings) setActiveSection("settings");
            else setActiveSection("roles");
          }}
        />
      }
      agentPanel={panelContent}
      isAgentOpen={isPanelOpen}
    >
      <Outlet />
    </Layout>
  );
}

/** Binds the theme storage to the signed-in recruiter's Clerk userId. */
function RecruiterThemeSync(): null {
  const { userId } = useClerkAuth();
  const { bindUser } = useTheme();
  useEffect(() => {
    if (userId) bindUser(userId);
  }, [userId, bindUser]);
  return null;
}

/**
 * App - Main application component with routing configuration
 */
function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Candidate Assessment Route */}
        <Route
          path="/assess/:token"
          element={
            <ThemeProvider>
              <ErrorBoundary>
                <CandidateAssessmentPage />
              </ErrorBoundary>
            </ThemeProvider>
          }
        />

        {/* Protected Recruiter Routes */}
        <Route
          path="*"
          element={
            <ThemeProvider>
            <ClerkAuthGate>
              <ClerkAuthWrapper>
                <RecruiterThemeSync />
                <Routes>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<ListingPage />} />
                    <Route path="/pipeline/:id" element={<OverviewPage />} />
                    <Route element={<ChallengeDndLayout />}>
                      <Route
                        path="/pipeline/:id/stages/:stageId"
                        element={<StageDetailPage />}
                      />
                      <Route
                        path="/pipeline/:id/stages/:stageId/challenges"
                        element={<StageDetailPage />}
                      />
                    </Route>
                    {FEATURE_FLAGS.FEATURE_FLAG_CHALLENGE_EDITOR && (
                      <Route
                        path="/pipeline/:id/challenges/:challengeId"
                        element={<ChallengeEditorPage />}
                      />
                    )}
                    <Route path="/pipeline/new" element={<PipelineCreatePage />} />
                    <Route
                      path="/candidates/:id"
                      element={<CandidateProfilePage />}
                    />
                    <Route
                      path="/screenings/:id/preview"
                      element={<CandidateScreeningPage />}
                    />
                    {FEATURE_FLAGS.FEATURE_FLAG_SCHEDULE_ROUTE && (
                      <Route path="/schedule" element={<SchedulingPage />} />
                    )}
                    {FEATURE_FLAGS.FEATURE_FLAG_DEV_CONTAINER_ROUTE && (
                      <Route
                        path="/sandbox/dev-container"
                        element={<DevContainerSandboxPage />}
                      />
                    )}
                    <Route
                      path="/prototype/report"
                      element={<CandidateReportPrototype />}
                    />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ClerkAuthWrapper>
            </ClerkAuthGate>
            </ThemeProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
