import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Save,
  AlertCircle,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  Trash2,
  Shield,
  Copy,
  X,
} from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { ChallengeRegistry } from "../components/Assessment/ChallengeRegistry";
import { TimerProvider } from "../components/Assessment/TimerContext";
import { GitHubPRFetcher } from "../components/Assessment/GitHubPRFetcher";
import { GroundTruthAnnotationEditor } from "../components/Assessment/GroundTruthAnnotationEditor";
import { ALL_CHALLENGE_TEMPLATES, normalizeShortAnswerConfig } from "../content/challengeLibrary";
import { QuestionVideoRecorder } from "../components/Challenge/QuestionVideoRecorder";

import { MonacoPanel } from "../components/Panels/MonacoPanel";

const client = generateClient<Schema>();

/**
 * ChallengeEditorPage - Advanced editor for creating and modifying pipeline challenges.
 */
export default function ChallengeEditorPage(): JSX.Element {
  const { id, challengeId } = useParams<{
    id: string;
    challengeId: string;
  }>();
  const pipelineId = id;
  const navigate = useNavigate();

  const [challenge, setChallenge] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [runPanel, setRunPanel] = useState<{
    isOpen: boolean;
    status: "idle" | "running" | "success" | "error";
    logs: string[];
    error?: string;
    durationMs?: number;
  }>({
    isOpen: false,
    status: "idle",
    logs: [],
  });

  // GitHub PR Integration state
  const [prFetched, setPrFetched] = useState(false);
  const [groundTruthAnnotations, setGroundTruthAnnotations] = useState<any>({
    senior: [],
    mid: [],
    junior: [],
  });

  const fetchData = useCallback(async () => {
    if (!challengeId) return;
    try {
      setIsLoading(true);

      // 1. Try to find in template library first (for Clone-on-Edit)
      const libraryTemplate = ALL_CHALLENGE_TEMPLATES.find(
        (t: any) => t.id === challengeId,
      );
      if (libraryTemplate) {
        setChallenge({
          ...libraryTemplate,
          // We don't have a stageId yet if we're coming from the picker with a template ID
          // unless it's passed in location state or similar.
          // For now, assume it's a template we're about to "clone into" this pipeline.
          config: libraryTemplate.config,
          serverConfig: (libraryTemplate.config as any).correctOptionId
            ? {
                correctOptionId: (libraryTemplate.config as any)
                  .correctOptionId,
              }
            : {},
          isTemplate: true,
        });
        setIsLoading(false);
        return;
      }

      // 2. Try to handle "NEW_" placeholders
      if (challengeId.startsWith("NEW_")) {
        const type = challengeId.replace("NEW_", "");
        setChallenge({
          id: challengeId,
          type,
          title: `New ${type.replace("_", " ").toLowerCase()}`,
          instructions:
            type === "CODE_IMPLEMENTATION"
              ? `# Problem\n\nDescribe the task.\n\n## Requirements\n\n- \n\n## Examples\n\n\`\`\`txt\ninput: \noutput: \n\`\`\`\n`
              : "",
          config:
            type === "CODE_IMPLEMENTATION"
              ? {
                  starterCode: "export function solve() {\n  return null;\n}\n",
                  language: "javascript",
                }
              : {},
          serverConfig:
            type === "CODE_IMPLEMENTATION"
              ? {
                  testCode:
                    "import { solve } from './starter';\n\nassert.equal(solve(), null, 'stub should return null');\n",
                  testLanguage: "javascript",
                }
              : {},
          isNew: true,
        });
        setIsLoading(false);
        return;
      }

      // 3. Otherwise fetch from DB
      const { data } = await client.models.Challenge.get({ id: challengeId });
      if (data) {
        // Parse config and serverConfig into objects for easier editing
        const parsedConfig =
          typeof data.config === "string"
            ? JSON.parse(data.config)
            : data.config || {};
        const parsedServerConfig =
          typeof data.serverConfig === "string"
            ? JSON.parse(data.serverConfig)
            : data.serverConfig || {};

        setChallenge({
          ...data,
          config: parsedConfig,
          serverConfig: parsedServerConfig,
        });

        // Initialize ground truth if available
        if (data.groundTruthAnnotations) {
          const parsed =
            typeof data.groundTruthAnnotations === "string"
              ? JSON.parse(data.groundTruthAnnotations)
              : data.groundTruthAnnotations;
          setGroundTruthAnnotations(parsed);
        }

        // If it's a code review and already has PR info, mark as fetched
        if (
          data.type === "CODE_REVIEW" &&
          data.githubRepoUrl &&
          data.githubPrNumber
        ) {
          setPrFetched(true);
        }
      }
    } catch (err) {
      console.error("[ChallengeEditor] Error fetching challenge:", err);
    } finally {
      setIsLoading(false);
    }
  }, [challengeId]);

  const handleRunTests = async () => {
    if (challenge?.type !== "CODE_IMPLEMENTATION") return;
    const starterCode = String(challenge.config?.starterCode || "");
    const testCode = String(challenge.serverConfig?.testCode || "");
    const testLanguage = String(
      challenge.serverConfig?.testLanguage ||
        challenge.config?.language ||
        "javascript",
    ).toLowerCase();

    if (testLanguage !== "javascript") {
      setRunPanel({
        isOpen: true,
        status: "error",
        logs: [],
        error: `Runner currently supports JavaScript only. Set TESTS language to JAVASCRIPT to run.`,
      });
      return;
    }

    setRunPanel({
      isOpen: true,
      status: "running",
      logs: [],
    });

    const workerSource = `
      const post = (payload) => self.postMessage(payload);

      function safeStringify(x) {
        try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
      }

      const assert = {
        ok: (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); },
        equal: (a, b, msg) => { if (a !== b) throw new Error(msg || ('Expected ' + safeStringify(a) + ' to equal ' + safeStringify(b))); },
        deepEqual: (a, b, msg) => {
          const aa = safeStringify(a);
          const bb = safeStringify(b);
          if (aa !== bb) throw new Error(msg || ('Expected ' + aa + ' to deepEqual ' + bb));
        },
      };

      self.onmessage = (e) => {
        const { starterCode, testCode } = e.data || {};
        const startedAt = Date.now();
        const logs = [];

        const consoleShim = {
          log: (...args) => logs.push(args.map(safeStringify).join(' ')),
          warn: (...args) => logs.push('[warn] ' + args.map(safeStringify).join(' ')),
          error: (...args) => logs.push('[error] ' + args.map(safeStringify).join(' ')),
        };

        try {
          const module = { exports: {} };
          const exports = module.exports;
          const run = (code, filename) => {
            const fn = new Function('module', 'exports', 'assert', 'console', 'globalThis', code + '\\n//# sourceURL=' + filename);
            fn(module, exports, assert, consoleShim, self);
          };

          const rewriteStarter = (code) => {
            const exportNames = [];
            let out = String(code || '');
            out = out.replace(/export\\s+default\\s+/g, '');
            out = out.replace(/export\\s+function\\s+([A-Za-z0-9_]+)\\s*\\(/g, (m, name) => {
              exportNames.push(name);
              return 'function ' + name + '(';
            });
            out = out.replace(/export\\s+(?:const|let|var)\\s+([A-Za-z0-9_]+)\\s*=/g, (m, name) => {
              exportNames.push(name);
              return m.replace(/^export\\s+/, '');
            });
            if (exportNames.length > 0) {
              out +=
                '\\n' +
                exportNames
                  .map((n) => 'module.exports.' + n + ' = ' + n + ';')
                  .join('\\n');
            }
            return out;
          };

          run(rewriteStarter(starterCode), 'starter.js');

          // Allow tests to import from './starter' without a bundler.
          // In practice this is a tiny convenience shim:
          // - we also expose module.exports as globalThis.__exports
          self.__exports = module.exports;

          // Replace bare "import { x } from './starter'" with a destructure of global exports.
          // This is intentionally minimal: authors can also just read from globalThis.__exports.
          const rewrittenTests = String(testCode || '')
            .replace(/import\\s+\\{([^}]+)\\}\\s+from\\s+['"]\\.\\/starter['"]\\s*;?/g, (m, names) => {
              return 'const {' + names.trim() + '} = globalThis.__exports;';
            })
            .replace(/import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"]\\.\\/starter['"]\\s*;?/g, (m, ns) => {
              return 'const ' + ns + ' = globalThis.__exports;';
            });

          run(rewrittenTests, 'tests.js');

          post({ type: 'done', success: true, logs, durationMs: Date.now() - startedAt });
        } catch (err) {
          const message = (err && err.message) ? String(err.message) : String(err);
          const stack = (err && err.stack) ? String(err.stack) : undefined;
          post({ type: 'done', success: false, logs, error: message, stack, durationMs: Date.now() - startedAt });
        }
      };
    `;

    const blob = new Blob([workerSource], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timeoutMs = 5000;
    const timeout = window.setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      setRunPanel((prev) => ({
        ...prev,
        status: "error",
        error: `Timeout after ${timeoutMs}ms (possible infinite loop).`,
      }));
    }, timeoutMs);

    worker.onmessage = (e) => {
      if (!e?.data || e.data.type !== "done") return;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);

      const payload = e.data as {
        success: boolean;
        logs?: string[];
        error?: string;
        durationMs?: number;
      };

      setRunPanel({
        isOpen: true,
        status: payload.success ? "success" : "error",
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        ...(payload.error ? { error: payload.error } : {}),
        ...(typeof payload.durationMs === "number"
          ? { durationMs: payload.durationMs }
          : {}),
      });
    };

    worker.onerror = (err) => {
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      setRunPanel((prev) => ({
        ...prev,
        status: "error",
        error: err?.message || "Worker error",
      }));
    };

    worker.postMessage({ starterCode, testCode });
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!challenge) return;
    setIsSaving(true);
    try {
      // 1. Determine if we should clone (e.g. if it's a template or "NEW_" placeholder)
      // We also check if it's a library template being edited for the first time
      const isTemplate = challenge.isTemplate;
      const isNew = challenge.isNew || challenge.id.startsWith("NEW_");

      const updateParams: any = {
        title: challenge.title,
        instructions: challenge.instructions,
        config: JSON.stringify(challenge.config || {}),
        serverConfig: JSON.stringify(challenge.serverConfig || {}),
      };

      // Add GitHub PR fields if CODE_REVIEW
      if (challenge.type === "CODE_REVIEW" && challenge.githubRepoUrl) {
        updateParams.githubRepoUrl = challenge.githubRepoUrl;
        updateParams.githubPrNumber = challenge.githubPrNumber;
        updateParams.githubPrTitle = challenge.githubPrTitle;
        updateParams.githubPrDescription = challenge.githubPrDescription;
        updateParams.cachedDiffJson =
          typeof challenge.cachedDiffJson === "string"
            ? challenge.cachedDiffJson
            : JSON.stringify(challenge.cachedDiffJson);
        updateParams.cachedMetadata =
          typeof challenge.cachedMetadata === "string"
            ? challenge.cachedMetadata
            : JSON.stringify(challenge.cachedMetadata);
        updateParams.diffCachedAt = new Date().toISOString();
        updateParams.groundTruthAnnotations = JSON.stringify(
          groundTruthAnnotations,
        );
      }

      // If it's a template or new, we always CREATE a new record
      if (isTemplate || isNew) {
        // Find a stageId if we don't have one (this might need to be passed in state)
        let stageId = challenge.stageId;

        // If no stageId, we might be in a broken state unless the caller provided it
        if (!stageId && pipelineId) {
          // Fallback: try to find the first stage of the pipeline
          const { data: stages } = await client.models.Stage.list({
            filter: { pipelineId: { eq: pipelineId! } },
          });
          if (stages && stages.length > 0 && stages[0]) {
            stageId = stages[0].id;
          }
        }

        if (!stageId) {
          throw new Error("Cannot save challenge without a stage ID.");
        }

        const challengeOrder = challenge.order ?? 0;
        const { data: newChallenge } = await client.models.Challenge.create({
          ...updateParams,
          stageId,
          type: challenge.type,
          order: challengeOrder,
        });

        // Auto-create FOLLOW_UP challenge if enabled
        if (challenge.config?.enableFollowUp && stageId) {
          try {
            await client.models.Challenge.create({
              stageId,
              type: 'FOLLOW_UP',
              title: 'Follow-Up Questions',
              instructions: 'AI-generated follow-up questions based on your previous response.',
              config: JSON.stringify({}),
              serverConfig: JSON.stringify({}),
              order: challengeOrder + 1,
            });
          } catch (err) {
            console.warn('[ChallengeEditor] Failed to create follow-up challenge:', err);
          }
        }

        if (newChallenge?.id) {
          navigate(`/pipeline/${pipelineId}/challenges/${newChallenge.id}`, {
            replace: true,
          });
        }
      } else {
        // Update existing record
        await client.models.Challenge.update({
          id: challenge.id,
          ...updateParams,
        });

        // Auto-create FOLLOW_UP challenge if newly enabled
        if (challenge.config?.enableFollowUp && challenge.stageId) {
          const { data: siblings } = await client.models.Challenge.list({
            filter: { stageId: { eq: challenge.stageId } },
          });
          const hasFollowUp = siblings?.some(
            (c) => c.type === 'FOLLOW_UP' && (c.order ?? 0) > (challenge.order ?? 0)
          );
          if (!hasFollowUp) {
            try {
              await client.models.Challenge.create({
                stageId: challenge.stageId,
                type: 'FOLLOW_UP',
                title: 'Follow-Up Questions',
                instructions: 'AI-generated follow-up questions based on your previous response.',
                config: JSON.stringify({}),
                serverConfig: JSON.stringify({}),
                order: (challenge.order ?? 0) + 1,
              });
            } catch (err) {
              console.warn('[ChallengeEditor] Failed to create follow-up challenge:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error("[ChallengeEditor] Error saving challenge:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClone = async () => {
    if (!challenge) return;
    setIsSaving(true);
    try {
      const cloneParams: any = {
        title: `${challenge.title} (Clone)`,
        instructions: challenge.instructions,
        config: JSON.stringify(challenge.config || {}),
        serverConfig: JSON.stringify(challenge.serverConfig || {}),
        stageId: challenge.stageId,
        type: challenge.type,
        order: (challenge.order ?? 0) + 1,
      };

      if (challenge.type === "CODE_REVIEW") {
        cloneParams.githubRepoUrl = challenge.githubRepoUrl;
        cloneParams.githubPrNumber = challenge.githubPrNumber;
        cloneParams.githubPrTitle = challenge.githubPrTitle;
        cloneParams.githubPrDescription = challenge.githubPrDescription;
        cloneParams.cachedDiffJson =
          typeof challenge.cachedDiffJson === "string"
            ? challenge.cachedDiffJson
            : JSON.stringify(challenge.cachedDiffJson);
        cloneParams.cachedMetadata =
          typeof challenge.cachedMetadata === "string"
            ? challenge.cachedMetadata
            : JSON.stringify(challenge.cachedMetadata);
        cloneParams.diffCachedAt = new Date().toISOString();
        cloneParams.groundTruthAnnotations = JSON.stringify(
          groundTruthAnnotations,
        );
      }

      const { data: newChallenge } =
        await client.models.Challenge.create(cloneParams);
      if (newChallenge) {
        navigate(`/pipeline/${pipelineId}/challenges/${newChallenge.id}`, {
          replace: true,
        });
      }
    } catch (err) {
      console.error("[ChallengeEditor] Error cloning challenge:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePRFetched = (prData: {
    githubRepoUrl: string;
    githubPrNumber: number;
    githubPrTitle: string;
    githubPrDescription: string;
    cachedDiffJson: any;
    cachedMetadata: any;
  }) => {
    setChallenge({
      ...challenge!,
      githubRepoUrl: prData.githubRepoUrl,
      githubPrNumber: prData.githubPrNumber,
      githubPrTitle: prData.githubPrTitle,
      githubPrDescription: prData.githubPrDescription,
      cachedDiffJson: prData.cachedDiffJson,
      cachedMetadata: prData.cachedMetadata,
      diffCachedAt: new Date().toISOString(),
    });
    setPrFetched(true);
  };

  if (isLoading) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 40 }} />
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}
        >
          <Skeleton height={600} />
          <Skeleton height={600} />
        </div>
      </div>
    );
  }

  if (!challenge) return <div>Challenge not found.</div>;

  const bottomPadding =
    challenge.type === "CODE_IMPLEMENTATION"
      ? runPanel.isOpen
        ? 320
        : 140
      : 100;

  const codeLanguage = String(
    (challenge.config?.language as string | undefined) || "javascript",
  ).toLowerCase();
  const testLanguage = String(
    (challenge.serverConfig?.testLanguage as string | undefined) ||
      codeLanguage ||
      "javascript",
  ).toLowerCase();

  return (
    <div style={{ paddingBottom: bottomPadding }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
                fontFamily: "Space Mono",
              }}
            >
              CHALLENGE_EDITOR / {challenge.type}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <input
                value={challenge.title}
                onChange={(e) =>
                  setChallenge({ ...challenge, title: e.target.value })
                }
                placeholder="Challenge Title"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  fontSize: 24,
                  fontWeight: 800,
                  color: "#fff",
                  margin: 0,
                  padding: "4px 0",
                  outline: "none",
                  width: "auto",
                  minWidth: 320,
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: "Space Mono",
                    letterSpacing: "0.1em",
                  }}
                >
                  TIME_LIMIT
                </div>
                <input
                  type="number"
                  value={challenge.config?.timeLimit || ""}
                  onChange={(e) => {
                    const val = e.target.value
                      ? parseInt(e.target.value)
                      : null;
                    setChallenge({
                      ...challenge,
                      config: { ...challenge.config, timeLimit: val },
                    });
                  }}
                  placeholder="MINS"
                  style={{
                    width: 60,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    padding: "6px 10px",
                    color: "#fff",
                    fontSize: 12,
                    fontFamily: "Space Mono",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {challenge.type === "CODE_IMPLEMENTATION" && (
            <button
              onClick={handleRunTests}
              disabled={isSaving || runPanel.status === "running"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 18px",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
                fontFamily: "Space Mono",
                cursor: "pointer",
              }}
            >
              <Play size={16} />
              {runPanel.status === "running" ? "RUNNING..." : "RUN_TESTS"}
            </button>
          )}
          {challenge.type === "CODE_IMPLEMENTATION" && (
            <button
              onClick={() => setIsPreviewFullscreen(true)}
              disabled={isSaving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 18px",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
                fontFamily: "Space Mono",
                cursor: "pointer",
              }}
            >
              <Maximize2 size={16} />
              FULL_SCREEN
            </button>
          )}
          <button
            onClick={() => setIsPreviewFullscreen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "Space Mono",
              cursor: "pointer",
            }}
          >
            <Play size={16} />
            PREVIEW
          </button>
          <button
            onClick={handleClone}
            disabled={isSaving}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "Space Mono",
              cursor: "pointer",
            }}
          >
            <Copy size={16} />
            CLONE_CHALLENGE
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "Space Mono",
              cursor: "pointer",
            }}
          >
            <Save size={16} />
            {isSaving ? "SAVING..." : "SAVE_CHANGES"}
          </button>
        </div>
      </div>

      {challenge.type === "CODE_IMPLEMENTATION" ? (
        <div
          style={{
            height: "calc(100vh - 220px)",
            display: "grid",
            gridTemplateColumns: "1fr 1.5fr 1fr",
            gap: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            overflow: "hidden",
            marginTop: 12,
          }}
        >
          {/* Panel 1: Markdown Instructions */}
          <MonacoPanel
            label="INSTRUCTIONS"
            language="markdown"
            value={challenge.instructions || ""}
            onChange={(val) =>
              setChallenge({
                ...challenge,
                instructions: val ?? "",
              })
            }
          />

          {/* Panel 2: Starter Code */}
          <MonacoPanel
            label="CANDIDATE_CODE"
            language={codeLanguage}
            value={challenge.config?.starterCode || ""}
            onChange={(val) =>
              setChallenge({
                ...challenge,
                config: {
                  ...challenge.config,
                  starterCode: val ?? "",
                },
              })
            }
            headerRight={
              <select
                value={codeLanguage}
                onChange={(e) => {
                  const next = e.target.value;
                  setChallenge({
                    ...challenge,
                    config: {
                      ...challenge.config,
                      language: next,
                    },
                    serverConfig: {
                      ...challenge.serverConfig,
                      testLanguage:
                        (challenge.serverConfig?.testLanguage as
                          | string
                          | undefined) || next,
                    },
                  });
                }}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: "Space Mono",
                  fontSize: 10,
                  padding: "6px 8px",
                  borderRadius: 6,
                  outline: "none",
                }}
              >
                <option value="javascript">JAVASCRIPT</option>
                <option value="typescript">TYPESCRIPT</option>
              </select>
            }
          />

          {/* Panel 3: Tests */}
          <MonacoPanel
            label="TESTS"
            language={testLanguage}
            value={challenge.serverConfig?.testCode || ""}
            onChange={(val) =>
              setChallenge({
                ...challenge,
                serverConfig: {
                  ...challenge.serverConfig,
                  testCode: val ?? "",
                },
              })
            }
            headerRight={
              <select
                value={testLanguage}
                onChange={(e) => {
                  const next = e.target.value;
                  setChallenge({
                    ...challenge,
                    serverConfig: {
                      ...challenge.serverConfig,
                      testLanguage: next,
                    },
                  });
                }}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: "Space Mono",
                  fontSize: 10,
                  padding: "6px 8px",
                  borderRadius: 6,
                  outline: "none",
                }}
              >
                <option value="javascript">JAVASCRIPT</option>
                <option value="typescript">TYPESCRIPT</option>
              </select>
            }
          />
        </div>
      ) : challenge.type === "QUIZ_SHORT_ANSWER" ? (
        /* ── QUIZ_SHORT_ANSWER — dedicated 2-column editor ── */
        (() => {
          const saConfig = normalizeShortAnswerConfig(challenge.config);
          const currentMode = saConfig.inputMode ?? 'text';
          const existingVideoKey = (saConfig as { questionVideoS3Key?: string }).questionVideoS3Key;
          const hasFollowUp = !!challenge.config?.enableFollowUp;

          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 32,
              marginTop: 8,
            }}>
              {/* ── Left Column: Response Format & Question ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

                {/* Response Format Selector */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                    fontFamily: 'Space Mono', letterSpacing: '0.15em', marginBottom: 12, paddingLeft: 2,
                  }}>HOW SHOULD CANDIDATES RESPOND?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    {([
                      { mode: 'text' as const, icon: '⌨', label: 'Written', desc: 'Type a text response' },
                      { mode: 'voice' as const, icon: '🎙', label: 'Voice', desc: 'Speak with transcription' },
                      { mode: 'video' as const, icon: '🎬', label: 'Video', desc: 'Record on camera' },
                    ]).map(({ mode, icon, label, desc }) => {
                      const active = currentMode === mode;
                      return (
                        <button key={mode} onClick={() => setChallenge({
                          ...challenge, config: { ...challenge.config, inputMode: mode },
                        })} style={{
                          fontFamily: 'Space Mono', padding: '18px 14px 16px', borderRadius: 8,
                          cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6,
                          border: active ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.06)',
                          background: active ? 'linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.02) 100%)' : 'rgba(255,255,255,0.02)',
                          transition: 'all 0.2s ease',
                        }}>
                          <div style={{ fontSize: 20 }}>{icon}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#fbbf24' : 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>{label}</div>
                          <div style={{ fontSize: 9, color: active ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.2)', lineHeight: 1.4 }}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Question Card */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#fbbf24', borderRadius: 1 }} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                        fontFamily: 'Space Mono', letterSpacing: '0.15em',
                      }}>QUESTION</span>
                    </div>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'Space Mono' }}>
                      {(challenge.config?.question || '').length} chars
                    </span>
                  </div>
                  <textarea
                    value={challenge.config?.question || ''}
                    onChange={(e) => setChallenge({
                      ...challenge, config: { ...challenge.config, question: e.target.value },
                    })}
                    placeholder="Write the question your candidate will see..."
                    style={{
                      width: '100%', minHeight: 200, padding: '20px 24px',
                      background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.9)',
                      fontSize: 15, fontFamily: 'inherit', lineHeight: 1.8,
                      outline: 'none', resize: 'vertical',
                    }}
                  />
                </LiquidMetalCard>

                {/* Time Limit */}
                <div style={{
                  marginTop: 24, display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 18px', background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
                }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>MAX DURATION</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[2, 5, 10].map((mins) => {
                      const isActive = challenge.config?.timeLimit === mins;
                      return (
                        <button key={mins} onClick={() => setChallenge({
                          ...challenge, config: { ...challenge.config, timeLimit: mins },
                        })} style={{
                          fontFamily: 'Space Mono', fontSize: 10, padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
                          border: isActive ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.08)',
                          background: isActive ? 'rgba(96,165,250,0.1)' : 'transparent',
                          color: isActive ? '#60a5fa' : 'rgba(255,255,255,0.3)', transition: 'all 0.15s',
                        }}>{mins}m</button>
                      );
                    })}
                    <button onClick={() => setChallenge({
                      ...challenge, config: { ...challenge.config, timeLimit: null },
                    })} style={{
                      fontFamily: 'Space Mono', fontSize: 10, padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
                      border: !challenge.config?.timeLimit ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.08)',
                      background: !challenge.config?.timeLimit ? 'rgba(96,165,250,0.1)' : 'transparent',
                      color: !challenge.config?.timeLimit ? '#60a5fa' : 'rgba(255,255,255,0.3)', transition: 'all 0.15s',
                    }}>None</button>
                  </div>
                </div>
              </div>

              {/* ── Right Column: Video, Scoring, Follow-Up ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* Recruiter Video Message */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#a78bfa', borderRadius: 1 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', letterSpacing: '0.15em' }}>YOUR MESSAGE</span>
                    </div>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono', fontStyle: 'italic' }}>
                      {existingVideoKey ? 'recorded' : 'optional'}
                    </span>
                  </div>
                  <div style={{ padding: '20px 24px' }}>
                    {!existingVideoKey && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', marginBottom: 16, lineHeight: 1.6 }}>
                        Record a video message for candidates. Add context, set expectations, or give a personal touch.
                      </div>
                    )}
                    <QuestionVideoRecorder
                      challengeId={challenge.id}
                      {...(existingVideoKey ? { existingS3Key: existingVideoKey } : {})}
                      onUploaded={(s3Key) => setChallenge({
                        ...challenge, config: { ...challenge.config, questionVideoS3Key: s3Key },
                      })}
                    />
                  </div>
                </LiquidMetalCard>

                {/* Scoring Guideline */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#4ade80', borderRadius: 1 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', letterSpacing: '0.15em' }}>SCORING GUIDELINE</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Shield size={10} color="rgba(255,255,255,0.15)" />
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'Space Mono' }}>INTERNAL</span>
                    </div>
                  </div>
                  <textarea
                    value={challenge.serverConfig?.idealAnswer || ''}
                    onChange={(e) => setChallenge({
                      ...challenge, serverConfig: { ...challenge.serverConfig, idealAnswer: e.target.value },
                    })}
                    placeholder="Describe what a strong answer looks like. This guides AI scoring and your manual review."
                    style={{
                      width: '100%', minHeight: 160, padding: '20px 24px',
                      background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.9)',
                      fontSize: 13, fontFamily: 'inherit', lineHeight: 1.8,
                      outline: 'none', resize: 'vertical',
                    }}
                  />
                </LiquidMetalCard>

                {/* Follow-Up Toggle */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#60a5fa', borderRadius: 1 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', letterSpacing: '0.15em' }}>FOLLOW-UP</span>
                    </div>
                    <button onClick={() => setChallenge({
                      ...challenge, config: { ...challenge.config, enableFollowUp: !hasFollowUp },
                    })} style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                      position: 'relative', transition: 'background 0.2s',
                      background: hasFollowUp ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.1)',
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                        position: 'absolute', top: 3, transition: 'left 0.2s',
                        left: hasFollowUp ? 21 : 3,
                      }} />
                    </button>
                  </div>
                  <div style={{ padding: '16px 24px' }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Mono', lineHeight: 1.7 }}>
                      {hasFollowUp
                        ? 'AI will generate tailored follow-up questions after the candidate submits. Questions probe depth of understanding based on their specific answer.'
                        : 'Enable to automatically ask follow-up questions after submission. AI generates probing questions based on the candidate\u0027s response.'}
                    </div>
                    {hasFollowUp && (
                      <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {['WHY', 'DEPTH', 'FIX', 'MISSED'].map((tag) => (
                          <span key={tag} style={{
                            fontSize: 9, fontFamily: 'Space Mono', padding: '4px 10px', borderRadius: 4,
                            background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.15)',
                            color: 'rgba(96,165,250,0.6)', letterSpacing: '0.1em',
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </LiquidMetalCard>

              </div>

              {/* ── Follow-Up inline card (spans full width, links to its own editor) ── */}
              {hasFollowUp && (
                <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '0 0 12px 20px',
                  }}>
                    <div style={{
                      width: 1, height: 20,
                      background: 'linear-gradient(180deg, rgba(96,165,250,0.3) 0%, rgba(96,165,250,0.1) 100%)',
                    }} />
                    <span style={{
                      fontSize: 8, color: 'rgba(96,165,250,0.4)',
                      fontFamily: 'Space Mono', letterSpacing: '0.15em',
                    }}>NEXT IN PIPELINE</span>
                  </div>
                  <div
                    onClick={() => {
                      // Navigate to the follow-up challenge editor if one exists
                      // For now this is a visual placeholder — the FOLLOW_UP challenge
                      // gets created on save and will appear in the stage's challenge list
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '18px 24px',
                      background: 'rgba(96,165,250,0.03)',
                      border: '1px solid rgba(96,165,250,0.12)',
                      borderRadius: 8,
                      borderLeft: '3px solid rgba(96,165,250,0.4)',
                      cursor: 'default',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: 'rgba(96,165,250,0.08)',
                      border: '1px solid rgba(96,165,250,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <ChevronDown size={16} color="rgba(96,165,250,0.6)" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
                        fontFamily: 'Space Mono', marginBottom: 4,
                      }}>Follow-Up Questions</div>
                      <div style={{
                        fontSize: 10, color: 'rgba(255,255,255,0.25)',
                        fontFamily: 'Space Mono', lineHeight: 1.5,
                      }}>
                        AI-generated probing questions &mdash; configure on the follow-up detail page after saving
                      </div>
                    </div>
                    <span style={{
                      fontSize: 8, color: 'rgba(96,165,250,0.4)', fontFamily: 'Space Mono',
                      letterSpacing: '0.1em', padding: '4px 10px',
                      background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.1)',
                      borderRadius: 4,
                    }}>FOLLOW_UP</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()
      ) : challenge.type === "FOLLOW_UP" ? (
        /* ── FOLLOW_UP — dedicated config editor ── */
        (() => {
          const fuConfig = typeof challenge.config === 'object' ? challenge.config : {};
          const questionCount = fuConfig.questionCount ?? 3;
          const selectedTypes: string[] = fuConfig.questionTypes ?? ['text'];
          const selectedCategories: string[] = fuConfig.categories ?? ['WHY', 'DEPTH', 'FIX', 'MISSED'];

          const updateFUConfig = (updates: Record<string, unknown>) => {
            setChallenge({
              ...challenge,
              config: { ...fuConfig, ...updates },
            });
          };

          const questionTypes = [
            { id: 'text', label: 'Text', icon: '⌨', desc: 'Written response' },
            { id: 'mcq', label: 'Multiple Choice', icon: '☑', desc: 'Pick from options' },
            { id: 'voice', label: 'Voice', icon: '🎙', desc: 'Spoken answer' },
            { id: 'video', label: 'Video', icon: '🎬', desc: 'Record on camera' },
            { id: 'code', label: 'Code', icon: '⟨/⟩', desc: 'Write a code snippet' },
          ];

          const categories = [
            { id: 'WHY', label: 'Why', color: '#60a5fa', desc: 'Explain reasoning behind choices' },
            { id: 'DEPTH', label: 'Depth', color: '#4ade80', desc: 'Go deeper on a topic' },
            { id: 'FIX', label: 'Fix', color: '#f87171', desc: 'Correct a weakness in their answer' },
            { id: 'MISSED', label: 'Missed', color: '#fbbf24', desc: 'Cover blind spots they skipped' },
            { id: 'PRIORITISATION', label: 'Priority', color: '#a78bfa', desc: 'Rank trade-offs and decisions' },
          ];

          return (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Description Card */}
              <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: '16px 24px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ width: 3, height: 16, background: '#60a5fa', borderRadius: 1 }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                    fontFamily: 'Space Mono', letterSpacing: '0.15em',
                  }}>ABOUT THIS CHALLENGE</span>
                </div>
                <div style={{ padding: '20px 24px' }}>
                  <div style={{
                    fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'Space Mono', lineHeight: 1.8,
                  }}>
                    After a candidate submits their answer to the previous challenge, AI generates
                    tailored follow-up questions that probe their depth of understanding. Configure
                    below how many questions to generate, what formats to use, and which categories
                    to focus on.
                  </div>
                </div>
              </LiquidMetalCard>

              {/* Config Grid: Count | Types | Categories */}
              <div style={{
                display: 'grid', gridTemplateColumns: '240px 1fr 1fr',
                gap: 24,
              }}>

                {/* Question Count */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ width: 3, height: 16, background: '#fbbf24', borderRadius: 1 }} />
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                      fontFamily: 'Space Mono', letterSpacing: '0.15em',
                    }}>COUNT</span>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{
                      fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'Space Mono',
                      marginBottom: 16, lineHeight: 1.6,
                    }}>How many follow-up questions should AI generate?</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => updateFUConfig({ questionCount: n })} style={{
                          width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
                          fontFamily: 'Space Mono', fontSize: 16, fontWeight: 700,
                          border: questionCount === n
                            ? '1px solid rgba(251,191,36,0.4)'
                            : '1px solid rgba(255,255,255,0.06)',
                          background: questionCount === n
                            ? 'rgba(251,191,36,0.1)'
                            : 'transparent',
                          color: questionCount === n ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                          transition: 'all 0.15s',
                        }}>{n}</button>
                      ))}
                    </div>
                  </div>
                </LiquidMetalCard>

                {/* Question Types */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#a78bfa', borderRadius: 1 }} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                        fontFamily: 'Space Mono', letterSpacing: '0.15em',
                      }}>QUESTION TYPES</span>
                    </div>
                    <span style={{
                      fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'Space Mono',
                    }}>{selectedTypes.length} selected</span>
                  </div>
                  <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {questionTypes.map(({ id, label, icon, desc }) => {
                      const isOn = selectedTypes.includes(id);
                      return (
                        <button key={id} onClick={() => {
                          const next = isOn
                            ? selectedTypes.filter((t: string) => t !== id)
                            : [...selectedTypes, id];
                          if (next.length > 0) updateFUConfig({ questionTypes: next });
                        }} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px', borderRadius: 6, cursor: 'pointer',
                          fontFamily: 'Space Mono', fontSize: 11, textAlign: 'left',
                          border: isOn ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.04)',
                          background: isOn ? 'rgba(167,139,250,0.06)' : 'transparent',
                          color: isOn ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                          transition: 'all 0.15s',
                        }}>
                          <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{icon}</span>
                          <span style={{ flex: 1, fontWeight: isOn ? 700 : 400 }}>{label}</span>
                          <span style={{
                            fontSize: 9, color: isOn ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)',
                          }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </LiquidMetalCard>

                {/* Categories */}
                <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 3, height: 16, background: '#4ade80', borderRadius: 1 }} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                        fontFamily: 'Space Mono', letterSpacing: '0.15em',
                      }}>CATEGORIES</span>
                    </div>
                    <span style={{
                      fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'Space Mono',
                    }}>{selectedCategories.length} active</span>
                  </div>
                  <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {categories.map(({ id, label, color, desc }) => {
                      const isOn = selectedCategories.includes(id);
                      return (
                        <button key={id} onClick={() => {
                          const next = isOn
                            ? selectedCategories.filter((c: string) => c !== id)
                            : [...selectedCategories, id];
                          if (next.length > 0) updateFUConfig({ categories: next });
                        }} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px', borderRadius: 6, cursor: 'pointer',
                          fontFamily: 'Space Mono', fontSize: 11, textAlign: 'left',
                          border: isOn ? `1px solid ${color}33` : '1px solid rgba(255,255,255,0.04)',
                          background: isOn ? `${color}0a` : 'transparent',
                          color: isOn ? color : 'rgba(255,255,255,0.25)',
                          transition: 'all 0.15s',
                        }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: isOn ? color : 'rgba(255,255,255,0.08)',
                            boxShadow: isOn ? `0 0 6px ${color}44` : 'none',
                            flexShrink: 0,
                          }} />
                          <span style={{ flex: 1, fontWeight: isOn ? 700 : 400 }}>{label}</span>
                          <span style={{
                            fontSize: 9, color: isOn ? `${color}66` : 'rgba(255,255,255,0.1)',
                          }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </LiquidMetalCard>
              </div>
            </div>
          );
        })()
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 40,
            alignItems: "flex-start",
          }}
        >
          {/* Left Panel: Configuration */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 32,
              maxHeight: "calc(100vh - 250px)",
              overflowY: "auto",
              paddingRight: 10,
            }}
          >
            <LiquidMetalCard variant="dark" style={{ padding: 40 }}>
              <SubTitle>CHALLENGE_CONTENT</SubTitle>
              <div style={{ marginTop: 32 }}>
                {challenge.type === "CODE_REVIEW" && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 32,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: "rgba(255,255,255,0.3)",
                            fontFamily: "Space Mono",
                            fontWeight: 700,
                            letterSpacing: "0.2em",
                          }}
                        >
                          STEP_1:_FETCH_PULL_REQUEST
                        </div>
                        {prFetched && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 9,
                              color: "#4ade80",
                              fontFamily: "Space Mono",
                            }}
                          >
                            <Shield size={10} />
                            PR_SYNCED_SUCCESSFULLY
                          </div>
                        )}
                      </div>
                      <GitHubPRFetcher
                        initialChallenge={{
                          githubRepoUrl: challenge.githubRepoUrl || "",
                          githubPrNumber: challenge.githubPrNumber || 0,
                        }}
                        onPRFetched={handlePRFetched}
                        onCleared={() => {
                          setChallenge({
                            ...challenge,
                            githubRepoUrl: undefined as any,
                            githubPrNumber: undefined as any,
                            githubPrTitle: undefined as any,
                            githubPrDescription: undefined as any,
                            cachedDiffJson: undefined as any,
                            cachedMetadata: undefined as any,
                          });
                          setPrFetched(false);
                        }}
                      />
                    </div>

                    {prFetched && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: "rgba(255,255,255,0.3)",
                            fontFamily: "Space Mono",
                            fontWeight: 700,
                            letterSpacing: "0.2em",
                            marginBottom: 8,
                          }}
                        >
                          STEP_2:_DEFINE_GROUND_TRUTH
                        </div>
                        <GroundTruthAnnotationEditor
                          initialAnnotations={groundTruthAnnotations}
                          onAnnotationsChange={setGroundTruthAnnotations}
                        />
                      </div>
                    )}
                  </div>
                )}

                {challenge.type === "QUIZ_MCQ" && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 24,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          color: "rgba(255,255,255,0.3)",
                          fontFamily: "Space Mono",
                        }}
                      >
                        QUESTION_TEXT
                      </label>
                      <textarea
                        value={challenge.config?.question || ""}
                        onChange={(e) => {
                          setChallenge({
                            ...challenge,
                            config: {
                              ...challenge.config,
                              question: e.target.value,
                            },
                          });
                        }}
                        placeholder="What is the question?"
                        style={{
                          width: "100%",
                          height: 100,
                          padding: "16px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 4,
                          color: "#fff",
                          fontSize: 14,
                          resize: "vertical",
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <label
                          style={{
                            fontSize: 10,
                            color: "rgba(255,255,255,0.3)",
                            fontFamily: "Space Mono",
                          }}
                        >
                          ANSWER_OPTIONS
                        </label>
                        <div
                          style={{
                            fontSize: 9,
                            color: "rgba(255,255,255,0.2)",
                            fontFamily: "Space Mono",
                          }}
                        >
                          SELECT_CORRECT_ANSWER
                        </div>
                      </div>

                      {(() => {
                        const options = Array.isArray(challenge.config?.options)
                          ? challenge.config.options
                          : [];
                        const correctId =
                          challenge.serverConfig?.correctOptionId;

                        // Auto-initialize if empty
                        if (options.length === 0) {
                          const initialOptions = [
                            { id: "a", text: "" },
                            { id: "b", text: "" },
                            { id: "c", text: "" },
                            { id: "d", text: "" },
                          ];
                          setTimeout(() => {
                            setChallenge({
                              ...challenge,
                              config: {
                                ...challenge.config,
                                options: initialOptions,
                              },
                            });
                          }, 0);
                          return null;
                        }

                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 12,
                            }}
                          >
                            {options.map((opt: any, idx: number) => (
                              <div
                                key={opt.id}
                                style={{
                                  display: "flex",
                                  gap: 12,
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  onClick={() => {
                                    setChallenge({
                                      ...challenge,
                                      serverConfig: {
                                        ...challenge.serverConfig,
                                        correctOptionId: opt.id,
                                      },
                                    });
                                  }}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    border: `2px solid ${correctId === opt.id ? "#34d399" : "rgba(255,255,255,0.1)"}`,
                                    background:
                                      correctId === opt.id
                                        ? "#34d399"
                                        : "transparent",
                                    cursor: "pointer",
                                  }}
                                />
                                <input
                                  value={opt.text}
                                  onChange={(e) => {
                                    const newOptions = [...options];
                                    newOptions[idx] = {
                                      ...opt,
                                      text: e.target.value,
                                    };
                                    setChallenge({
                                      ...challenge,
                                      config: {
                                        ...challenge.config,
                                        options: newOptions,
                                      },
                                      serverConfig: {
                                        ...challenge.serverConfig,
                                        options: newOptions,
                                      },
                                    });
                                  }}
                                  placeholder={`Option ${String.fromCharCode(65 + idx)}...`}
                                  style={{
                                    flex: 1,
                                    padding: "12px 16px",
                                    background: "rgba(0,0,0,0.2)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 4,
                                    color: "#fff",
                                    fontSize: 13,
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const newOptions = options.filter(
                                      (_: any, i: number) => i !== idx,
                                    );
                                    setChallenge({
                                      ...challenge,
                                      config: {
                                        ...challenge.config,
                                        options: newOptions,
                                      },
                                    });
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "rgba(255,80,80,0.3)",
                                    cursor: "pointer",
                                    padding: 8,
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const nextId = String.fromCharCode(
                                  97 + options.length,
                                );
                                const newOptions = [
                                  ...options,
                                  { id: nextId, text: "" },
                                ];
                                setChallenge({
                                  ...challenge,
                                  config: {
                                    ...challenge.config,
                                    options: newOptions,
                                  },
                                });
                              }}
                              style={{
                                alignSelf: "flex-start",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px dashed rgba(255,255,255,0.1)",
                                color: "rgba(255,255,255,0.4)",
                                padding: "8px 16px",
                                borderRadius: 4,
                                fontSize: 10,
                                cursor: "pointer",
                              }}
                            >
                              + ADD_OPTION
                            </button>
                          </div>
                        );
                      })()}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          color: "rgba(255,255,255,0.3)",
                          fontFamily: "Space Mono",
                        }}
                      >
                        EXPLANATION (SHOWN AFTER SUBMISSION)
                      </label>
                      <textarea
                        value={challenge.serverConfig?.explanation || ""}
                        onChange={(e) => {
                          setChallenge({
                            ...challenge,
                            serverConfig: {
                              ...challenge.serverConfig,
                              explanation: e.target.value,
                            },
                          });
                        }}
                        placeholder="Provide context for why the correct answer is right..."
                        style={{
                          width: "100%",
                          height: 80,
                          padding: "12px 16px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 4,
                          color: "#fff",
                          fontSize: 13,
                          resize: "none",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>
                  </div>
                )}

                {challenge.type === "CODE_IMPLEMENTATION" && (
                  <div
                    style={{
                      padding: 40,
                      border: "1px dashed rgba(255,255,255,0.1)",
                      textAlign: "center",
                    }}
                  >
                    <AlertCircle
                      size={24}
                      color="rgba(255,255,255,0.2)"
                      style={{ marginBottom: 16 }}
                    />
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.4)",
                        fontFamily: "Space Mono",
                      }}
                    >
                      Code implementation challenges are configured with
                      templates.
                    </div>
                    <p
                      style={{
                        fontSize: 10,
                        color: "rgba(255,255,255,0.2)",
                        marginTop: 8,
                      }}
                    >
                      Custom authoring & editing is coming soon!
                    </p>
                  </div>
                )}
              </div>
            </LiquidMetalCard>

            <LiquidMetalCard variant="dark" style={{ padding: 40 }}>
              <SubTitle>SCORING_&_RUBRIC</SubTitle>
              <div style={{ marginTop: 32 }}>
                <div
                  style={{
                    padding: 40,
                    border: "1px dashed rgba(255,255,255,0.1)",
                    textAlign: "center",
                  }}
                >
                  <Shield
                    size={24}
                    color="rgba(255,255,255,0.2)"
                    style={{ marginBottom: 16 }}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    SCORING_CONFIGURATION_COMING_SOON
                  </div>
                </div>
              </div>
            </LiquidMetalCard>
          </div>

          {/* Right Panel: Preview */}
          <div style={{ position: "sticky", top: 40 }}>
            <LiquidMetalCard
              variant="dark"
              style={{ padding: 40, minHeight: 600 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 32,
                }}
              >
                <SubTitle>CANDIDATE_PREVIEW</SubTitle>
                <button
                  onClick={() => setIsPreviewFullscreen(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 9,
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <Maximize2 size={12} />
                  FULL_SCREEN
                </button>
              </div>

              <div style={{ opacity: 0.8 }}>
                <TimerProvider>
                  <ChallengeRegistry
                    challenge={{
                      ...challenge,
                      config: JSON.stringify(challenge.config || {}),
                      serverConfig: JSON.stringify(
                        challenge.serverConfig || {},
                      ),
                    }}
                    onSubmissionChange={() => {}}
                    onSubmit={() => {}}
                  />
                </TimerProvider>
              </div>
            </LiquidMetalCard>
          </div>
        </div>
      )}

      {/* Fullscreen Overlay */}
      {isPreviewFullscreen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#0c0c0e",
            padding: 40,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#60a5fa",
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "Space Mono",
                  letterSpacing: "0.2em",
                }}
              >
                {challenge.type === "CODE_IMPLEMENTATION"
                  ? "EDITOR_MODE"
                  : "CANDIDATE_PREVIEW_MODE"}
              </span>
            </div>
            <button
              onClick={() => setIsPreviewFullscreen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: "#fff",
                border: "none",
                borderRadius: 4,
                color: "#000",
                fontSize: 10,
                fontWeight: 800,
                fontFamily: "Space Mono",
                cursor: "pointer",
              }}
            >
              <Minimize2 size={14} />
              EXIT_FULL_SCREEN
            </button>
          </div>

          <div style={{ flex: 1, overflow: "hidden" }}>
            {challenge.type === "CODE_IMPLEMENTATION" ? (
              <div
                style={{
                  height: "100%",
                  display: "grid",
                  gridTemplateColumns: "1fr 1.5fr 1fr",
                  gap: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <MonacoPanel
                  label="INSTRUCTIONS"
                  language="markdown"
                  value={challenge.instructions || ""}
                  onChange={(val) =>
                    setChallenge({
                      ...challenge,
                      instructions: val ?? "",
                    })
                  }
                />
                <MonacoPanel
                  label="CANDIDATE_CODE"
                  language={codeLanguage}
                  value={challenge.config?.starterCode || ""}
                  onChange={(val) =>
                    setChallenge({
                      ...challenge,
                      config: {
                        ...challenge.config,
                        starterCode: val ?? "",
                      },
                    })
                  }
                  headerRight={
                    <select
                      value={codeLanguage}
                      onChange={(e) => {
                        const next = e.target.value;
                        setChallenge({
                          ...challenge,
                          config: {
                            ...challenge.config,
                            language: next,
                          },
                          serverConfig: {
                            ...challenge.serverConfig,
                            testLanguage:
                              (challenge.serverConfig?.testLanguage as
                                | string
                                | undefined) || next,
                          },
                        });
                      }}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.7)",
                        fontFamily: "Space Mono",
                        fontSize: 10,
                        padding: "6px 8px",
                        borderRadius: 6,
                        outline: "none",
                      }}
                    >
                      <option value="javascript">JAVASCRIPT</option>
                      <option value="typescript">TYPESCRIPT</option>
                    </select>
                  }
                />
                <MonacoPanel
                  label="TESTS"
                  language={testLanguage}
                  value={challenge.serverConfig?.testCode || ""}
                  onChange={(val) =>
                    setChallenge({
                      ...challenge,
                      serverConfig: {
                        ...challenge.serverConfig,
                        testCode: val ?? "",
                      },
                    })
                  }
                  headerRight={
                    <select
                      value={testLanguage}
                      onChange={(e) => {
                        const next = e.target.value;
                        setChallenge({
                          ...challenge,
                          serverConfig: {
                            ...challenge.serverConfig,
                            testLanguage: next,
                          },
                        });
                      }}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.7)",
                        fontFamily: "Space Mono",
                        fontSize: 10,
                        padding: "6px 8px",
                        borderRadius: 6,
                        outline: "none",
                      }}
                    >
                      <option value="javascript">JAVASCRIPT</option>
                      <option value="typescript">TYPESCRIPT</option>
                    </select>
                  }
                />
              </div>
            ) : (
              <TimerProvider>
                <ChallengeRegistry
                  challenge={{
                    ...challenge,
                    config: JSON.stringify(challenge.config || {}),
                    serverConfig: JSON.stringify(challenge.serverConfig || {}),
                  }}
                  onSubmissionChange={() => {}}
                  onSubmit={() => {}}
                />
              </TimerProvider>
            )}
          </div>
        </div>
      )}

      {runPanel.isOpen && <div />}

      {challenge.type === "CODE_IMPLEMENTATION" && (
        <div
          style={{
            position: "fixed",
            left: 24,
            right: 24,
            bottom: 16,
            zIndex: 10000,
          }}
        >
          <LiquidMetalCard
            variant="dark"
            style={{
              padding: 12,
              borderRadius: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      runPanel.status === "success"
                        ? "#34d399"
                        : runPanel.status === "error"
                          ? "#f87171"
                          : runPanel.status === "running"
                            ? "#60a5fa"
                            : "rgba(255,255,255,0.2)",
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: "rgba(255,255,255,0.7)",
                    fontFamily: "Space Mono",
                    letterSpacing: "0.12em",
                  }}
                >
                  CONSOLE
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.35)",
                    fontFamily: "Space Mono",
                    letterSpacing: "0.12em",
                  }}
                >
                  {runPanel.status === "running"
                    ? "RUNNING"
                    : runPanel.status === "success"
                      ? "PASS"
                      : runPanel.status === "error"
                        ? "FAIL"
                        : "IDLE"}
                  {typeof runPanel.durationMs === "number"
                    ? ` / ${runPanel.durationMs}ms`
                    : ""}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={() =>
                    setRunPanel((prev) => ({
                      isOpen: prev.isOpen,
                      status: "idle",
                      logs: [],
                    }))
                  }
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.55)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                  }}
                >
                  CLEAR
                </button>
                <button
                  onClick={async () => {
                    const content = [
                      ...(runPanel.error ? [`ERROR: ${runPanel.error}`] : []),
                      ...(runPanel.logs || []),
                    ].join("\n");
                    try {
                      await navigator.clipboard.writeText(content);
                    } catch {}
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.55)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                  }}
                >
                  COPY
                </button>
                <button
                  onClick={() =>
                    setRunPanel((prev) => ({ ...prev, isOpen: !prev.isOpen }))
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.55)",
                    cursor: "pointer",
                    padding: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title={runPanel.isOpen ? "Collapse" : "Expand"}
                >
                  {runPanel.isOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </button>
                <button
                  onClick={() =>
                    setRunPanel((prev) => ({ ...prev, isOpen: false }))
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.35)",
                    cursor: "pointer",
                    padding: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Hide"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {runPanel.isOpen && (
              <div style={{ marginTop: 10 }}>
                {runPanel.error && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#fca5a5",
                      fontFamily: "Space Mono",
                      marginBottom: 10,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {runPanel.error}
                  </div>
                )}

                <div
                  style={{
                    height: 180,
                    overflow: "auto",
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: 12,
                    fontFamily: "Space Mono",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.75)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {runPanel.logs.length > 0
                    ? runPanel.logs.join("\n")
                    : runPanel.status === "running"
                      ? "Running..."
                      : "No output."}
                </div>
              </div>
            )}
          </LiquidMetalCard>
        </div>
      )}
    </div>
  );
}
