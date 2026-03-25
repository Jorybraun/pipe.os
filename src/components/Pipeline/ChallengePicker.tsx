import { useState, useMemo, useEffect } from "react";
import { FEATURE_FLAGS } from "../../config/featureFlags";
import {
  X,
  Code,
  Shield,
  FileText,
  Search,
  Filter,
  Timer,
  ChevronRight,
  Zap,
  CheckSquare,
  Plus,
  Loader,
  AlertCircle,
  GitPullRequest,
  BookMarked,
  Trash2,
} from "lucide-react";
import { generateClient } from "aws-amplify/data";
import { LiquidMetalCard } from "../ui/LiquidMetalCard";
import { ChallengeCard } from "./ChallengeCard";
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
} from "../../content/challengeLibrary";
import type { ChallengeSelection } from "../../types/challengeSelection";
import type { Schema } from "../../../amplify/data/resource";

const client = generateClient<Schema>();

interface PRSummary {
  number: number;
  title: string;
  description: string;
  author: string;
  avatar: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  labels: string[];
  baseBranch: string;
  featureBranch: string;
}

interface ChallengePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selections: ChallengeSelection[]) => void;
}

const TYPES = [
  { id: "CODE_REVIEW", label: "Code Review", icon: Code, color: "#60a5fa" },
  {
    id: "CODE_IMPLEMENTATION",
    label: "Implementation",
    icon: Code,
    color: "#a78bfa",
  },
  { id: "QUIZ_MCQ", label: "Multiple Choice", icon: Shield, color: "#34d399" },
  {
    id: "QUIZ_SHORT_ANSWER",
    label: "Short Answer",
    icon: FileText,
    color: "#fbbf24",
  },
];

function isValidGitHubUrl(url: string): boolean {
  return (
    url.startsWith("https://github.com/") &&
    url.split("/").filter(Boolean).length >= 4
  );
}

/**
 * ChallengePicker - Modal for browsing and selecting multiple challenge templates,
 * or browsing GitHub PRs to create CODE_REVIEW challenges.
 *
 * When CODE_REVIEW filter is active: shows GitHub PR browser (repo URL + PR list).
 * For all other filters: shows the static challenge template library.
 */
export function ChallengePicker({
  isOpen,
  onClose,
  onSelect,
}: ChallengePickerProps): JSX.Element | null {
  // Template library state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("CODE_REVIEW");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // GitHub PR browser state (used when selectedType === 'CODE_REVIEW')
  const [repoUrl, setRepoUrl] = useState("");
  const [prs, setPrs] = useState<PRSummary[]>([]);
  const [isFetchingPRs, setIsFetchingPRs] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [selectedPRs, setSelectedPRs] = useState<Set<number>>(new Set());

  // Saved repos (persisted in localStorage)
  const SAVED_REPOS_KEY = "pipe_saved_repos";
  const [savedRepos, setSavedRepos] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_REPOS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [showAddRepoInput, setShowAddRepoInput] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_REPOS_KEY, JSON.stringify(savedRepos));
    } catch {
      /* ignore */
    }
  }, [savedRepos]);

  const handleSaveRepo = (): void => {
    const trimmed = newRepoUrl.trim();
    if (!isValidGitHubUrl(trimmed) || savedRepos.includes(trimmed)) return;
    setSavedRepos((prev) => [...prev, trimmed]);
    setRepoUrl(trimmed);
    setNewRepoUrl("");
    setShowAddRepoInput(false);
    void handleFetchPRsForUrl(trimmed);
  };

  const handleRemoveRepo = (url: string): void => {
    setSavedRepos((prev) => prev.filter((r) => r !== url));
    if (repoUrl === url) {
      setRepoUrl("");
      setPrs([]);
      setPrError(null);
      setSelectedPRs(new Set());
    }
  };

  const handleSelectSavedRepo = (url: string): void => {
    setRepoUrl(url);
    void handleFetchPRsForUrl(url);
  };

  const isCodeReviewMode = selectedType === "CODE_REVIEW";

  // ─── Template library filtering ────────────────────────────────────────────

  const filteredTemplates = useMemo<ChallengeTemplate[]>(() => {
    return ALL_CHALLENGE_TEMPLATES.filter((t) => {
      // In CODE_REVIEW mode we show the PR browser, not library templates
      if (isCodeReviewMode) return false;

      const matchesSearch =
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tags.some((tag) =>
          tag.toLowerCase().includes(searchQuery.toLowerCase()),
        );

      // Hide QUIZ types when FEATURE_FLAG_PREDEFINED_CHALLENGES is off
      if (
        !FEATURE_FLAGS.FEATURE_FLAG_PREDEFINED_CHALLENGES &&
        (t.type === "QUIZ_MCQ" || t.type === "QUIZ_SHORT_ANSWER")
      )
        return false;

      const matchesType = t.type === selectedType;

      return matchesSearch && matchesType;
    });
  }, [searchQuery, selectedType, isCodeReviewMode]);

  // ─── Template selection ─────────────────────────────────────────────────────

  const toggleTemplate = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // ─── PR selection ───────────────────────────────────────────────────────────

  const togglePR = (prNumber: number): void => {
    const next = new Set(selectedPRs);
    if (next.has(prNumber)) {
      next.delete(prNumber);
    } else {
      next.add(prNumber);
    }
    setSelectedPRs(next);
  };

  // ─── GitHub PR fetch ────────────────────────────────────────────────────────

  const handleFetchPRsForUrl = async (url: string): Promise<void> => {
    if (!isValidGitHubUrl(url)) return;
    setIsFetchingPRs(true);
    setPrError(null);
    setPrs([]);
    setSelectedPRs(new Set());

    try {
      const trimmedUrl = url.trim();
      console.log("[ChallengePicker] Calling listGitHubPRs:", {
        repoUrl: trimmedUrl,
      });
      const { data: raw, errors: gqlErrors } =
        await client.mutations.listGitHubPRs({
          repoUrl: trimmedUrl,
          state: "open",
        });

      if (gqlErrors?.length) {
        console.error("[ChallengePicker] GraphQL errors:", gqlErrors);
        throw gqlErrors[0];
      }

      const result = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!result?.success) {
        setPrError(result?.error?.message ?? "Failed to fetch pull requests.");
        return;
      }

      const fetchedPRs: PRSummary[] = result.data?.prs ?? [];
      setPrs(fetchedPRs);

      if (fetchedPRs.length === 0) {
        setPrError("No open pull requests found for this repository.");
      }
    } catch (err: unknown) {
      console.error("[ChallengePicker] Failed to list PRs:", err);
      // Amplify throws { data, errors } when the GraphQL call fails
      const gqlErr = (err as { errors?: Array<{ message?: string }> } | null)
        ?.errors?.[0]?.message;
      if (gqlErr?.includes("FieldUndefined") || gqlErr?.includes("undefined")) {
        setPrError("Schema not deployed. Run: npx ampx sandbox");
      } else {
        setPrError(
          gqlErr ??
            "Failed to fetch pull requests. Check the repo URL and try again.",
        );
      }
    } finally {
      setIsFetchingPRs(false);
    }
  };

  // ─── Confirm ────────────────────────────────────────────────────────────────

  const hasSelection = isCodeReviewMode
    ? selectedPRs.size > 0
    : selectedIds.size > 0;
  const selectionCount = isCodeReviewMode ? selectedPRs.size : selectedIds.size;

  const handleConfirm = (): void => {
    let selections: ChallengeSelection[];

    if (isCodeReviewMode && selectedPRs.size > 0) {
      selections = prs
        .filter((pr) => selectedPRs.has(pr.number))
        .map((pr) => ({
          source: "github" as const,
          repoUrl: repoUrl.trim(),
          prNumber: pr.number,
          prTitle: pr.title,
          prDescription: pr.description,
          prAuthor: pr.author,
        }));
    } else if (isCodeReviewMode && selectedIds.has("CREATE_NEW_CODE_REVIEW")) {
      selections = [
        {
          source: "library" as const,
          template: {
            id: "NEW_CODE_REVIEW",
            type: "CODE_REVIEW",
            title: "New Code Review",
            description: "Create a blank code review challenge",
            difficulty: "beginner",
            topic: "Custom",
            estimatedMinutes: 30,
            tags: [],
            instructions: "",
            config: {},
          },
        },
      ];
    } else {
      const isCreateNew = selectedIds.has(`CREATE_NEW_${selectedType}`);
      if (isCreateNew) {
        selections = [
          {
            source: "library" as const,
            template: {
              id: `NEW_${selectedType}`,
              type: selectedType as any,
              title: `New ${selectedType.replace("QUIZ_", "").replace("_", " ")}`,
              description: `Create a blank ${selectedType.toLowerCase()} challenge`,
              difficulty: "beginner",
              topic: "Custom",
              estimatedMinutes: 30,
              tags: [],
              instructions: "",
              config: {},
            },
          },
        ];
      } else {
        selections = ALL_CHALLENGE_TEMPLATES.filter((t) =>
          selectedIds.has(t.id),
        ).map((t) => ({ source: "library" as const, template: t }));
      }
    }

    onSelect(selections);

    // Reset local state for next open
    setSelectedIds(new Set());
    setSelectedPRs(new Set());
  };

  // ─── Type filter toggle ─────────────────────────────────────────────────────

  const handleTypeToggle = (typeId: string): void => {
    setSelectedType(typeId);
    // Clear selections when switching modes
    setSelectedIds(new Set());
    setSelectedPRs(new Set());
    setPrError(null);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(12px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <LiquidMetalCard
        variant="chrome"
        style={{
          maxWidth: 1000,
          width: "100%",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "24px 32px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
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
              {isCodeReviewMode ? "GITHUB_PR_BROWSER" : "CHALLENGE_LIBRARY"}
            </div>
            <h3
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#fff",
                margin: 0,
              }}
            >
              {isCodeReviewMode ? "Select GitHub PRs" : "Select Templates"}
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {hasSelection && (
              <button
                onClick={handleConfirm}
                style={{
                  padding: "10px 24px",
                  background: "#fff",
                  border: "none",
                  borderRadius: 4,
                  color: "#000",
                  fontSize: 11,
                  fontWeight: 800,
                  fontFamily: "Space Mono",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 0 20px rgba(255,255,255,0.2)",
                }}
              >
                <Plus size={14} strokeWidth={3} />
                ADD_SELECTED ({selectionCount})
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "16px 32px",
            background: "rgba(255,255,255,0.02)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            gap: 24,
            alignItems: "center",
          }}
        >
          {/* Search — only shown in library mode */}
          {!isCodeReviewMode && (
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "rgba(255,255,255,0.3)",
                }}
              />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, technology, or tag..."
                style={{
                  width: "100%",
                  background: "rgba(0,0,0,0.2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  padding: "10px 16px 10px 36px",
                  color: "#fff",
                  fontSize: 12,
                  outline: "none",
                  fontFamily: "Space Mono",
                }}
              />
            </div>
          )}

          {/* Saved repos UI — only shown in CODE_REVIEW mode */}
          {isCodeReviewMode && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* Repo selector row */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {savedRepos.length > 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <BookMarked
                      size={13}
                      style={{ color: "#60a5fa", flexShrink: 0 }}
                    />
                    <select
                      value={repoUrl}
                      onChange={(e) => {
                        if (e.target.value)
                          handleSelectSavedRepo(e.target.value);
                      }}
                      style={{
                        flex: 1,
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(96,165,250,0.3)",
                        borderRadius: 4,
                        padding: "8px 12px",
                        color: repoUrl ? "#fff" : "rgba(255,255,255,0.4)",
                        fontSize: 11,
                        outline: "none",
                        fontFamily: "Space Mono",
                        cursor: "pointer",
                      }}
                    >
                      <option value="" style={{ background: "#1a1a2e" }}>
                        — select a repository —
                      </option>
                      {savedRepos.map((r) => (
                        <option
                          key={r}
                          value={r}
                          style={{ background: "#1a1a2e" }}
                        >
                          {r.replace("https://github.com/", "")}
                        </option>
                      ))}
                    </select>
                    {repoUrl && (
                      <button
                        onClick={() => handleRemoveRepo(repoUrl)}
                        title="Remove this repo"
                        style={{
                          background: "none",
                          border: "none",
                          color: "rgba(255,100,100,0.5)",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "rgba(255,255,255,0.3)",
                      fontSize: 11,
                      fontFamily: "Space Mono",
                    }}
                  >
                    <GitPullRequest size={13} />
                    No repositories saved yet
                  </div>
                )}
                <button
                  onClick={() => setShowAddRepoInput((v) => !v)}
                  style={{
                    padding: "8px 14px",
                    background: showAddRepoInput
                      ? "rgba(96,165,250,0.15)"
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${showAddRepoInput ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 4,
                    color: showAddRepoInput
                      ? "#60a5fa"
                      : "rgba(255,255,255,0.5)",
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Plus size={11} />
                  ADD_REPO
                </button>
              </div>

              {/* Add repo inline input */}
              {showAddRepoInput && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    autoFocus
                    value={newRepoUrl}
                    onChange={(e) => setNewRepoUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveRepo();
                      if (e.key === "Escape") {
                        setShowAddRepoInput(false);
                        setNewRepoUrl("");
                      }
                    }}
                    placeholder="https://github.com/owner/repo"
                    style={{
                      flex: 1,
                      background: "rgba(0,0,0,0.2)",
                      border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: 4,
                      padding: "8px 14px",
                      color: "#fff",
                      fontSize: 11,
                      outline: "none",
                      fontFamily: "Space Mono",
                    }}
                  />
                  <button
                    onClick={handleSaveRepo}
                    disabled={!isValidGitHubUrl(newRepoUrl)}
                    style={{
                      padding: "8px 16px",
                      background: isValidGitHubUrl(newRepoUrl)
                        ? "rgba(96,165,250,0.15)"
                        : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 4,
                      color: isValidGitHubUrl(newRepoUrl)
                        ? "#60a5fa"
                        : "rgba(255,255,255,0.2)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "Space Mono",
                      cursor: isValidGitHubUrl(newRepoUrl)
                        ? "pointer"
                        : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    SAVE &amp; LOAD
                  </button>
                </div>
              )}

              {/* Fetching indicator */}
              {isFetchingPRs && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "rgba(96,165,250,0.7)",
                    fontSize: 10,
                    fontFamily: "Space Mono",
                  }}
                >
                  <Loader
                    size={11}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                  FETCHING PULL REQUESTS...
                </div>
              )}
            </div>
          )}

          {/* Type Filters */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {TYPES.filter(
              (t) =>
                FEATURE_FLAGS.FEATURE_FLAG_PREDEFINED_CHALLENGES ||
                (t.id !== "QUIZ_MCQ" && t.id !== "QUIZ_SHORT_ANSWER"),
              // FOLLOW_UP is always shown — it's not a predefined challenge template
            ).map((t) => {
              const isActive = selectedType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleTypeToggle(t.id)}
                  style={{
                    padding: "8px 12px",
                    background: isActive
                      ? "rgba(255,255,255,0.1)"
                      : "transparent",
                    border: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                    borderRadius: 4,
                    color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s",
                  }}
                >
                  <t.icon
                    size={12}
                    color={isActive ? t.color : "rgba(255,255,255,0.2)"}
                  />
                  {t.label.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: 32, overflowY: "auto", flex: 1 }}>
          {isCodeReviewMode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Create New Tile for Code Review */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: 16,
                }}
              >
                <CreateNewTile
                  type="CODE_REVIEW"
                  isSelected={selectedIds.has("CREATE_NEW_CODE_REVIEW")}
                  onClick={() => {
                    const next = new Set<string>();
                    if (!selectedIds.has("CREATE_NEW_CODE_REVIEW"))
                      next.add("CREATE_NEW_CODE_REVIEW");
                    setSelectedIds(next);
                    setSelectedPRs(new Set());
                  }}
                />
              </div>

              <div
                style={{
                  height: 1,
                  background: "rgba(255,255,255,0.06)",
                  margin: "8px 0",
                }}
              />

              <GitHubPRPanel
                prs={prs}
                isFetching={isFetchingPRs}
                error={prError}
                selectedPRs={selectedPRs}
                onToggle={(num) => {
                  togglePR(num);
                  setSelectedIds(new Set());
                }}
                hasUrl={isValidGitHubUrl(repoUrl)}
              />
            </div>
          ) : (
            <TemplateGrid
              templates={filteredTemplates}
              selectedIds={selectedIds}
              onToggle={toggleTemplate}
              selectedType={selectedType}
            />
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "16px 32px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(255,255,255,0.01)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "Space Mono",
            }}
          >
            {isCodeReviewMode
              ? `${prs.length} PRS_AVAILABLE | ${selectedPRs.size} SELECTED`
              : `${filteredTemplates.length} TEMPLATES_AVAILABLE | ${selectedIds.size} SELECTED`}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "rgba(255,255,255,0.4)",
              fontSize: 10,
            }}
          >
            <span>
              {hasSelection
                ? `Click ADD_SELECTED to confirm`
                : isCodeReviewMode
                  ? "Enter a repo URL, fetch PRs, then select"
                  : "Select templates to add to stage"}
            </span>
            <ChevronRight size={14} />
          </div>
        </div>
      </LiquidMetalCard>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TemplateGridProps {
  templates: ChallengeTemplate[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  selectedType: string;
}

function CreateNewTile({
  type,
  isSelected,
  onClick,
}: {
  type: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <ChallengeCard
      isSelected={isSelected}
      onClick={onClick}
      isTemplate
      challenge={{
        id: `CREATE_NEW_${type}`,
        type: type as any,
        title: `Create Custom ${type.replace("QUIZ_", "").replace("_", " ")}`,
        description: "Start from scratch with a clean slate",
        difficulty: "beginner",
      }}
    />
  );
}

function TemplateGrid({
  templates,
  selectedIds,
  onToggle,
  selectedType,
}: TemplateGridProps): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Create New Tile */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <CreateNewTile
          type={selectedType}
          isSelected={selectedIds.has(`CREATE_NEW_${selectedType}`)}
          onClick={() => {
            onToggle(`CREATE_NEW_${selectedType}`);
          }}
        />
      </div>

      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.06)",
          margin: "8px 0",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {templates.map((t) => (
          <ChallengeCard
            key={t.id}
            isTemplate
            isSelected={selectedIds.has(t.id)}
            onClick={() => onToggle(t.id)}
            challenge={t}
          />
        ))}
      </div>
    </div>
  );
}

interface GitHubPRPanelProps {
  prs: PRSummary[];
  isFetching: boolean;
  error: string | null;
  selectedPRs: Set<number>;
  onToggle: (prNumber: number) => void;
  hasUrl: boolean;
}

function GitHubPRPanel({
  prs,
  isFetching,
  error,
  selectedPRs,
  onToggle,
  hasUrl,
}: GitHubPRPanelProps): JSX.Element {
  if (isFetching) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          opacity: 0.6,
        }}
      >
        <Loader size={32} style={{ animation: "spin 1s linear infinite" }} />
        <div
          style={{
            fontSize: 12,
            fontFamily: "Space Mono",
            letterSpacing: "0.1em",
          }}
        >
          FETCHING_PULL_REQUESTS...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          padding: 24,
          background: "rgba(248,113,113,0.04)",
          border: "1px solid rgba(248,113,113,0.15)",
          borderRadius: 8,
        }}
      >
        <AlertCircle
          size={20}
          color="#f87171"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#f87171",
              fontFamily: "Space Mono",
              marginBottom: 6,
            }}
          >
            FETCH_ERROR
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!hasUrl || prs.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.3,
        }}
      >
        <GitPullRequest size={48} style={{ marginBottom: 20 }} />
        <div
          style={{
            fontSize: 12,
            fontFamily: "Space Mono",
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          {!hasUrl ? "ENTER_REPO_URL" : "NO_OPEN_PRS_FOUND"}
        </div>
        {!hasUrl && (
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.5)",
              fontFamily: "Space Mono",
            }}
          >
            Enter a GitHub repo URL above and click FETCH_PRS
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {prs.map((pr) => {
        const isSelected = selectedPRs.has(pr.number);
        return (
          <LiquidMetalCard
            key={pr.number}
            variant={isSelected ? "chrome" : "dark"}
            onClick={() => onToggle(pr.number)}
            style={{
              padding: "16px 20px",
              cursor: "pointer",
              border: isSelected ? "1px solid rgba(96,165,250,0.5)" : undefined,
              transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              {/* Selection indicator */}
              <div
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isSelected ? "#60a5fa" : "rgba(255,255,255,0.2)",
                  marginTop: 2,
                }}
              >
                {isSelected ? (
                  <CheckSquare size={18} />
                ) : (
                  <GitPullRequest size={16} />
                )}
              </div>

              {/* PR info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    #{pr.number}
                  </span>
                  {pr.draft && (
                    <span
                      style={{
                        fontSize: 8,
                        padding: "2px 6px",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 2,
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "Space Mono",
                      }}
                    >
                      DRAFT
                    </span>
                  )}
                  {pr.labels.slice(0, 3).map((label) => (
                    <span
                      key={label}
                      style={{
                        fontSize: 8,
                        padding: "2px 6px",
                        background: "rgba(96,165,250,0.08)",
                        border: "1px solid rgba(96,165,250,0.2)",
                        borderRadius: 2,
                        color: "#60a5fa",
                        fontFamily: "Space Mono",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#fff",
                    marginBottom: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pr.title}
                </div>

                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.35)",
                    fontFamily: "Space Mono",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span>{pr.author}</span>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ color: "#60a5fa", opacity: 0.7 }}>
                    {pr.featureBranch}
                  </span>
                  <span style={{ opacity: 0.4 }}>→</span>
                  <span style={{ opacity: 0.5 }}>{pr.baseBranch}</span>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ opacity: 0.5 }}>
                    {new Date(pr.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </LiquidMetalCard>
        );
      })}
    </div>
  );
}
