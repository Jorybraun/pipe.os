import { useState, useEffect } from "react";
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
import StageDetailPage from "./pages/StageDetailPage";
import CandidateProfilePage from "./pages/CandidateProfilePage";
import CandidateScreeningPage from "./pages/CandidateScreeningPage";
import RoleDiscoveryPage from "./pages/RoleDiscoveryPage";
import ChallengeEditorPage from "./pages/ChallengeEditorPage";
import CandidateAssessmentPage from "./pages/CandidateAssessmentPage";
import SchedulingPage from "./pages/SchedulingPage";
import DevContainerSandboxPage from "./pages/DevContainerSandboxPage";
import { ArrowLeft, Plus, LogOut } from "lucide-react";
import Logo from "./components/ui/Logo";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

const client = generateClient<Schema>();

/**
 * SubHeader - Main interactive UI for navigation and context
 */
const SubHeader = () => {
  const navigate = useNavigate();
  const { id, stage, questionId } = useParams();
  const location = useLocation();
  const { signOut } = useAuthenticator();
  const [headerData, setHeaderData] = useState<{
    title: string;
    count: number;
  }>({
    title: "PIPE_OS",
    count: 0,
  });

  const isPipelineContext =
    location.pathname.startsWith("/pipeline/") &&
    !location.pathname.startsWith("/pipeline/new");
  const isCandidateContext = location.pathname.startsWith("/candidates/");

  const handleNewRole = (): void => {
    navigate("/pipeline/new");
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        let pipelineId = isPipelineContext ? id : null;

        if (isCandidateContext && id) {
          const { data: candidate } = await client.models.Candidate.get({ id });
          if (candidate) {
            pipelineId = candidate.pipelineId;
          }
        }

        if (pipelineId) {
          const [pipeline, candidates] = await Promise.all([
            client.models.Pipeline.get({ id: pipelineId }),
            client.models.Candidate.list({
              filter: { pipelineId: { eq: pipelineId } },
            }),
          ]);

          setHeaderData({
            title: pipeline.data?.title || "POSITION",
            count: candidates.data?.length || 0,
          });
        } else {
          setHeaderData({
            title: "PIPE_OS",
            count: 0,
          });
        }
      } catch (err) {
        console.error("[SubHeader] Error fetching header data:", err);
      }
    };

    fetchData();
  }, [id, isPipelineContext, isCandidateContext]);

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
                } else if (isCandidateContext) {
                  navigate(-1);
                } else {
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
                ? `BACK TO ${currentStage.title.toUpperCase()}`
                : stage
                ? "BACK TO OVERVIEW"
                : isCandidateContext
                ? "BACK"
                : "BACK TO ROLES"}
            </button>

            <div
              style={{
                width: 1,
                height: 40,
                background: "rgba(255,255,255,0.08)",
              }}
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
                {isCandidateContext ? "CANDIDATE" : "POSITION"}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "0.05em",
                }}
              >
                {headerData.title.toUpperCase()}
              </div>
            </div>

            {(isPipelineContext || isCandidateContext) && (
              <>
                <div
                  style={{
                    width: 1,
                    height: 40,
                    background: "rgba(255,255,255,0.08)",
                  }}
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
                    {headerData.count}
                  </div>
                </div>
              </>
            )}
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
    </div>
  );
};

/**
 * AppLayout - Wrapper component that provides consistent Layout to child routes
 */
function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("roles");

  return (
    <Layout
      header={<SubHeader />}
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onScheduleClick={() => {
            setActiveSection("schedule");
            navigate("/schedule");
          }}
        />
      }
    >
      <Outlet />
    </Layout>
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
        <Route path="/assess/:token" element={<CandidateAssessmentPage />} />

        {/* Protected Recruiter Routes */}
        <Route
          path="*"
          element={
            <Authenticator>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<ListingPage />} />
                  <Route path="/pipeline/:id" element={<OverviewPage />} />
                  <Route
                    path="/pipeline/:id/stages/:stageId"
                    element={<StageDetailPage />}
                  />
                  <Route
                    path="/pipeline/:pipelineId/challenges/:challengeId"
                    element={<ChallengeEditorPage />}
                  />
                  <Route path="/pipeline/new" element={<RoleDiscoveryPage />} />
                  <Route
                    path="/pipeline/new/discovery"
                    element={<RoleDiscoveryPage />}
                  />
                  <Route
                    path="/candidates/:id"
                    element={<CandidateProfilePage />}
                  />
                  <Route
                    path="/screenings/:id/preview"
                    element={<CandidateScreeningPage />}
                  />
                  <Route path="/schedule" element={<SchedulingPage />} />
                  <Route
                    path="/sandbox/dev-container"
                    element={<DevContainerSandboxPage />}
                  />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Authenticator>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
