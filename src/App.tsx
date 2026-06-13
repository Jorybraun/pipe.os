import { useState, useEffect, Suspense, lazy } from "react";
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
} from "react-router-dom";
import { ClerkAuthGate, ClerkAuthWrapper } from "./providers/clerk";
import { useAuth } from "./providers";
import { Layout, SidebarNav } from "./components";
import { AgentDrawerProvider, useAgentDrawer } from "./contexts/AgentDrawerContext";
import { AgentDrawer } from "./components/Agent/AgentDrawer";
const ListingPage = lazy(() => import("./pages/ListingPage"));
const PipelineShellPage = lazy(() => import("./pages/PipelineShellPage"));
const PipelineInsightsPanel = lazy(() => import("./pages/PipelineInsightsPanel"));
const StagePanel = lazy(() => import("./pages/StagePanel"));
const StageIndexTab = lazy(() => import("./pages/stage-tabs/StageIndexTab"));
const CandidatesTab = lazy(() => import("./pages/stage-tabs/CandidatesTab"));
const ConfigureTab = lazy(() => import("./pages/stage-tabs/ConfigureTab"));
const GateConfigTab = lazy(() => import("./pages/stage-tabs/GateConfigTab"));
const CultureBenchmarkTab = lazy(() => import("./pages/stage-tabs/CultureBenchmarkTab"));
const NewStageFormPage = lazy(() => import("./pages/NewStageFormPage"));
const KanbanPage = lazy(() => import("./pages/KanbanPage"));
const CandidateProfilePage = lazy(() => import("./pages/CandidateProfilePage"));
const CandidateScreeningPage = lazy(() => import("./pages/CandidateScreeningPage"));
const RoleDiscoveryPage = lazy(() => import("./pages/RoleDiscoveryPage"));
const ChallengeEditorPage = lazy(() => import("./pages/ChallengeEditorPage"));
const CandidateAssessmentPage = lazy(() => import("./pages/CandidateAssessmentPage"));
const CultureInterviewPage = lazy(() => import("./pages/CultureInterviewPage"));
const VideoJoinPage = lazy(() => import("./pages/VideoJoinPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const SchedulingPage = lazy(() => import("./pages/SchedulingPage"));
const OutreachPage = lazy(() => import("./pages/OutreachPage"));
const DevContainerSandboxPage = lazy(() => import("./pages/DevContainerSandboxPage"));
const CandidateReportPrototype = lazy(() => import("./pages/CandidateReportPrototype"));
const RepoAdminPage = lazy(() => import("./pages/admin/RepoAdminPage"));
const RepoSearchPage = lazy(() => import("./pages/admin/RepoSearchPage"));
const RepoDetailPage = lazy(() => import("./pages/admin/RepoDetailPage"));
const AiUsagePage = lazy(() => import("./pages/admin/AiUsagePage"));
import { ArrowLeft, Plus, LogOut, Loader2 } from "lucide-react";
import Logo from "./components/ui/Logo";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { useAuth as useClerkAuth } from "@clerk/react";
import { SettingsPanel } from "./components/SettingsPanel";
import { RecruiterCallDrawer } from "./components/Video/RecruiterCallDrawer";
import { SidebarPortalProvider } from "./contexts/SidebarPortalContext";
import { StageRefetchProvider } from "./contexts/StageRefetchContext";

/**
 * SubHeader - Main interactive UI for navigation and context
 */
const SubHeader = () => {
  const navigate = useNavigate();
  const { id, stageId, questionId } = useParams();
  const location = useLocation();
  const auth = useAuth();

  const isCandidateContext = location.pathname.startsWith("/candidates/");

  const headerData = { title: "PIPE_OS", count: 0 };

  const handleNewRole = (): void => {
    navigate("/pipeline/new");
  };

  const currentStage = stageId ? { title: stageId } : null;
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
                if (isCandidateContext) {
                  navigate(-1);
                } else if (questionId && stageId) {
                  navigate(`/pipeline/${id}/stage/${stageId}`);
                } else if (stageId) {
                  navigate(`/pipeline/${id}`);
                } else if (id) {
                  navigate('/');
                } else {
                  navigate('/');
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
                ? "BACK TO STAGE"
                : stageId
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
  // Auto-open settings on OAuth callback (Calendly redirects back with ?code=&state=)
  const hasOAuthCallback = new URLSearchParams(window.location.search).has('code') &&
    new URLSearchParams(window.location.search).has('state');
  const [showSettings, setShowSettings] = useState(hasOAuthCallback);
  const [showCalls, setShowCalls] = useState(false);
  const agent = useAgentDrawer();

  const agentDrawerVisible = FEATURE_FLAGS.FEATURE_FLAG_COPILOT_AGENT && agent.isOpen;

  const panelContent = showSettings
    ? <SettingsPanel onClose={() => { setShowSettings(false); setActiveSection("roles"); }} initialTab={hasOAuthCallback ? 'integrations' : undefined} />
    : showCalls
      ? <RecruiterCallDrawer onClose={() => { setShowCalls(false); setActiveSection("roles"); }} />
      : agentDrawerVisible
        ? <AgentDrawer pipelineId={agent.pipelineId} skillMode={agent.skillMode} onClose={agent.closeAgent} onSkillModeChange={agent.setSkillMode} />
        : undefined;

  const isPanelOpen = showSettings || showCalls || agentDrawerVisible;

  return (
    <SidebarPortalProvider>
    <StageRefetchProvider>
    <Layout
      header={<SubHeader />}
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onRolesClick={() => {
            setActiveSection("roles");
            setShowSettings(false);
            setShowCalls(false);
            navigate("/");
          }}
          {...(FEATURE_FLAGS.FEATURE_FLAG_SCHEDULE_ROUTE
            ? {
                onScheduleClick: () => {
                  setActiveSection("schedule");
                  setShowSettings(false);
                  setShowCalls(false);
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
          {...(FEATURE_FLAGS.FEATURE_FLAG_LIVE_VIDEO
            ? {
                onCallsClick: () => {
                  setShowSettings(false);
                  agent.closeAgent();
                  setShowCalls((prev) => !prev);
                  if (!showCalls) setActiveSection("calls");
                  else setActiveSection("roles");
                },
              }
            : {})}
          onContactsClick={() => {
            setActiveSection("contacts");
            setShowSettings(false);
            setShowCalls(false);
            navigate("/contacts");
          }}
          onRepoAdminClick={() => {
            setActiveSection("repo-admin");
            setShowSettings(false);
            setShowCalls(false);
            navigate("/admin/repos");
          }}
          onAiUsageClick={() => {
            setActiveSection("ai-usage");
            setShowSettings(false);
            setShowCalls(false);
            navigate("/admin/ai-usage");
          }}
          {...(FEATURE_FLAGS.FEATURE_FLAG_COPILOT_AGENT
            ? {
                onAgentClick: () => {
                  setShowSettings(false);
                  setShowCalls(false);
                  if (agent.isOpen) {
                    agent.closeAgent();
                    setActiveSection("roles");
                  } else {
                    agent.openAgent();
                    setActiveSection("agent");
                  }
                },
              }
            : {})}
          onSettingsClick={() => {
            setShowCalls(false);
            agent.closeAgent();
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
    </StageRefetchProvider>
    </SidebarPortalProvider>
  );
}

/** Redirect old /pipeline/:id/stages/:stageId paths to the new /stage/:stageId shape. */
function LegacyStageRedirect(): JSX.Element {
  const { id, stageId } = useParams<{ id: string; stageId: string }>();
  return <Navigate to={`/pipeline/${id}/stage/${stageId}`} replace />;
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
 * PageLoader — minimal fallback shown while lazy chunks load.
 */
function PageLoader(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--pipe-bg, #0a0a0c)',
      }}
    >
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--pipe-text-dim)' }} />
    </div>
  );
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
            <ThemeProvider forceMode="dark">
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <CandidateAssessmentPage />
                </Suspense>
              </ErrorBoundary>
            </ThemeProvider>
          }
        />

        {/* Public Candidate Culture Interview Route */}
        <Route
          path="/culture/:token"
          element={
            <ThemeProvider forceMode="dark">
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <CultureInterviewPage />
                </Suspense>
              </ErrorBoundary>
            </ThemeProvider>
          }
        />

        {/* Public Video Join Route — candidate joins via invite email link */}
        <Route
          path="/video/:sessionId"
          element={
            <ThemeProvider forceMode="dark">
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <VideoJoinPage />
                </Suspense>
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
                <AgentDrawerProvider>
                <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<ListingPage />} />
                    <Route path="/pipeline/:id" element={<PipelineShellPage />}>
                      <Route index element={<PipelineInsightsPanel />} />
                      <Route path="new-stage" element={<NewStageFormPage />} />
                      <Route path="stage/:stageId" element={<StagePanel />}>
                        <Route index element={<StageIndexTab />} />
                        <Route path="candidates" element={<CandidatesTab />} />
                        <Route path="configure" element={<ConfigureTab />} />
                        <Route path="gate" element={<GateConfigTab />} />
                        <Route path="benchmark" element={<CultureBenchmarkTab />} />
                      </Route>
                    </Route>
                    <Route path="/pipeline/:id/kanban" element={<KanbanPage />} />
                    {/* Legacy redirects — old /stages/:stageId paths */}
                    <Route
                      path="/pipeline/:id/stages/:stageId"
                      element={<LegacyStageRedirect />}
                    />
                    <Route
                      path="/pipeline/:id/stages/:stageId/challenges"
                      element={<LegacyStageRedirect />}
                    />
                    {FEATURE_FLAGS.FEATURE_FLAG_CHALLENGE_EDITOR && (
                      <Route
                        path="/pipeline/:id/challenges/:challengeId"
                        element={<ChallengeEditorPage />}
                      />
                    )}
                    <Route path="/pipeline/new" element={<RoleDiscoveryPage />} />
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
                    <Route path="/outreach" element={<OutreachPage />} />
                    <Route path="/contacts" element={<ContactsPage />} />
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
                    <Route path="/admin/repos" element={<RepoAdminPage />} />
                    <Route path="/admin/repos/search" element={<RepoSearchPage />} />
                    <Route path="/admin/repos/:id" element={<RepoDetailPage />} />
                    <Route path="/admin/ai-usage" element={<AiUsagePage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </Suspense>
                </AgentDrawerProvider>
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
