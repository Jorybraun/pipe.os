import { useState, useEffect, Suspense, lazy, type ComponentType } from "react";
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
const PipelineNewRoutePage = lazy(() => import("./pages/PipelineNewRoutePage"));
const ChallengeEditorPage = lazy(() => import("./pages/ChallengeEditorPage"));
const CandidateAssessmentPage = lazy(() => import("./pages/CandidateAssessmentPage"));
const CultureInterviewPage = lazy(() => import("./pages/CultureInterviewPage"));
const VideoJoinPage = lazy(() => import("./pages/VideoJoinPage"));
const PersonProfilePage = lazy(() => import("./pages/PersonProfilePage"));
const ContactsPage = lazy(() =>
  import("./pages/ContactsPage").then((module) => ({
    default: module.default as ComponentType<{ view?: "people" | "clients" }>,
  })),
);
const SchedulingPage = lazy(() => import("./pages/SchedulingPage"));
const InterviewDetailPage = lazy(() => import("./pages/InterviewDetailPage"));
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

  const isPersonContext = location.pathname.startsWith("/candidates/") || location.pathname.startsWith("/people/");

  const headerData = { title: "PIPE_OS", count: 0 };

  const handleNewInterview = (): void => {
    navigate("/interviews?new=1");
  };

  const currentStage = stageId ? { title: stageId } : null;
  const isHome = ["/", "/interviews", "/roles", "/people"].includes(location.pathname);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 0,
        padding: 20,
        borderBottom: "1px solid var(--pipe-border-light)",
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
                if (isPersonContext) {
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
                ? "BACK TO INTERVIEW"
                : stageId
                  ? "BACK TO CONTEXT"
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
                {isPersonContext ? "PERSON" : stageId ? "INTERVIEW" : "CONTEXT"}
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
          onClick={handleNewInterview}
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
          NEW INTERVIEW
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

function NavigateToPeopleProfile(): JSX.Element {
  const { personId } = useParams<{ personId: string }>();
  return <Navigate to={personId ? `/people/${personId}` : '/people'} replace />;
}

/**
 * AppLayout - Wrapper component that provides consistent Layout to child routes
 */
function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const getSectionForPath = (pathname: string): string => {
    if (pathname === "/" || pathname.startsWith("/interviews") || pathname.startsWith("/schedule")) {
      return "interviews";
    }
    if (pathname.startsWith("/roles") || pathname.startsWith("/pipeline")) {
      return "roles";
    }
    if (pathname.startsWith("/people") || pathname.startsWith("/clients") || pathname.startsWith("/contacts") || pathname.startsWith("/candidates")) {
      return "people";
    }
    if (pathname.startsWith("/admin/repos")) {
      return "repo-admin";
    }
    if (pathname.startsWith("/admin/ai-usage")) {
      return "ai-usage";
    }
    if (pathname.startsWith("/sandbox")) {
      return "sandbox";
    }
    return "interviews";
  };
  const [activeSection, setActiveSection] = useState(() => getSectionForPath(location.pathname));
  // Auto-open settings on OAuth callback (Calendly redirects back with ?code=&state=)
  const hasOAuthCallback = new URLSearchParams(window.location.search).has('code') &&
    new URLSearchParams(window.location.search).has('state');
  const [showSettings, setShowSettings] = useState(hasOAuthCallback);
  const [showCalls, setShowCalls] = useState(false);
  const agent = useAgentDrawer();

  const agentDrawerVisible = FEATURE_FLAGS.FEATURE_FLAG_COPILOT_AGENT && agent.isOpen;

  useEffect(() => {
    if (!showSettings && !showCalls && !agentDrawerVisible) {
      setActiveSection(getSectionForPath(location.pathname));
    }
  }, [agentDrawerVisible, location.pathname, showCalls, showSettings]);

  const panelContent = showSettings
    ? <SettingsPanel onClose={() => { setShowSettings(false); setActiveSection(getSectionForPath(location.pathname)); }} initialTab={hasOAuthCallback ? 'integrations' : undefined} />
    : showCalls
      ? <RecruiterCallDrawer onClose={() => { setShowCalls(false); setActiveSection(getSectionForPath(location.pathname)); }} />
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
          onInterviewsClick={() => {
            setActiveSection("interviews");
            setShowSettings(false);
            setShowCalls(false);
            agent.closeAgent();
            navigate("/interviews");
          }}
          onRolesClick={() => {
            setActiveSection("roles");
            setShowSettings(false);
            setShowCalls(false);
            agent.closeAgent();
            navigate("/roles");
          }}
          {...(FEATURE_FLAGS.FEATURE_FLAG_CODE_SANDBOX
            ? {
                onSandboxClick: () => {
                  setActiveSection("sandbox");
                  setShowSettings(false);
                  setShowCalls(false);
                  navigate("/sandbox/dev-container");
                },
              }
            : {})}
          onPeopleClick={() => {
            setActiveSection("people");
            setShowSettings(false);
            setShowCalls(false);
            agent.closeAgent();
            navigate("/people");
          }}
          {...(FEATURE_FLAGS.FEATURE_FLAG_COPILOT_AGENT
            ? {
                onAgentClick: () => {
                  setShowSettings(false);
                  setShowCalls(false);
                  if (agent.isOpen) {
                    agent.closeAgent();
                    setActiveSection(getSectionForPath(location.pathname));
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
            else setActiveSection(getSectionForPath(location.pathname));
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

/** Public product route alias for the legacy pipeline detail shell. */
function RoleRedirect(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/pipeline/${id}`} replace />;
}

/** Preserves OAuth callback params from the retired scheduling route. */
function ScheduleRedirect(): JSX.Element {
  const location = useLocation();
  return <Navigate to={`/interviews${location.search}${location.hash}`} replace />;
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
            <ThemeProvider forceMode="pipe-blue">
            <ClerkAuthGate>
              <ClerkAuthWrapper>
                <RecruiterThemeSync />
                <AgentDrawerProvider>
                <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<SchedulingPage />} />
                    <Route path="/interviews" element={<SchedulingPage />} />
                    <Route path="/interviews/:interviewId" element={<InterviewDetailPage />} />
                    <Route path="/schedule" element={<ScheduleRedirect />} />
                    <Route path="/roles" element={<ListingPage />} />
                    <Route path="/roles/new" element={<PipelineNewRoutePage />} />
                    <Route path="/roles/:id/*" element={<RoleRedirect />} />
                    <Route path="/pipeline/:id" element={<PipelineShellPage />}>
                      <Route index element={<PipelineInsightsPanel />} />
                      <Route path="kanban" element={<KanbanPage />} />
                      <Route path="new-stage" element={<NewStageFormPage />} />
                      <Route path="stage/:stageId" element={<StagePanel />}>
                        <Route index element={<StageIndexTab />} />
                        <Route path="candidates" element={<CandidatesTab />} />
                        <Route path="configure" element={<ConfigureTab />} />
                        <Route path="gate" element={<GateConfigTab />} />
                        <Route path="benchmark" element={<CultureBenchmarkTab />} />
                      </Route>
                    </Route>
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
                    <Route path="/pipeline/new" element={<PipelineNewRoutePage />} />
                    <Route
                      path="/candidates/:id"
                      element={<CandidateProfilePage />}
                    />
                    <Route
                      path="/screenings/:id/preview"
                      element={<CandidateScreeningPage />}
                    />
                    <Route path="/outreach" element={<OutreachPage />} />
                    <Route path="/people" element={<ContactsPage />} />
                    <Route path="/people/:personId" element={<PersonProfilePage />} />
                    <Route path="/person/:personId" element={<NavigateToPeopleProfile />} />
                    <Route path="/clients" element={<Navigate to="/people" replace />} />
                    <Route path="/contacts" element={<Navigate to="/people" replace />} />
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
