// Neo4j label taxonomy and relationship indexes
// These are documentation + indexes; actual nodes are created by application code

// ─── Label taxonomy (documented here, enforced by application) ────────────────
//
// Root entity labels:
//   :Candidate  — top-level candidate node
//   :Role       — top-level role context node
//   :Repo       — top-level qualified repo node
//
// Candidate sub-elements (dual label):
//   :CandidateNode :Experience
//   :CandidateNode :Project
//   :CandidateNode :Accomplishment
//   :CandidateNode :Skill
//   :CandidateNode :Education
//   :CandidateNode :Credential
//   :CandidateNode :CulturalSignal
//   :CandidateNode :TechnicalDemonstration
//   :CandidateNode :WorkingStyle
//   :CandidateNode :CommunicationStyle
//   :CandidateNode :CareerArc
//   :CandidateNode :Motivation
//   :CandidateNode :Context
//
// Role sub-elements (dual label):
//   :RoleNode :Requirement
//   :RoleNode :Responsibility
//   :RoleNode :CulturalSignal
//   :RoleNode :TeamContext
//   :RoleNode :Dealbreaker
//   :RoleNode :RedFlag
//   :RoleNode :TechnicalContext
//   :RoleNode :CodebaseExpectation
//   :RoleNode :ProcessExpectation
//   :RoleNode :Conflict
//   :RoleNode :BarsOverride
//
// Repo sub-elements (dual label):
//   :RepoNode :Feature
//   :RepoNode :ArchitecturalPattern
//   :RepoNode :TechnicalStack
//   :RepoNode :Construct
//   :RepoNode :ChallengeSurface
//   :RepoNode :QualitySignal
//   :RepoNode :DomainContext
//   :RepoNode :PRSample
//   :RepoNode :IssueCandidate
//
// Match artifact:
//   :MatchReport

// ─── Indexes on sub-element IDs for dedup during dual-write ───────────────────
CREATE INDEX candidate_node_id IF NOT EXISTS
  FOR (n:CandidateNode) ON (n.id);

CREATE INDEX role_node_id IF NOT EXISTS
  FOR (n:RoleNode) ON (n.id);

CREATE INDEX repo_node_id IF NOT EXISTS
  FOR (n:RepoNode) ON (n.id);

CREATE INDEX match_report_id IF NOT EXISTS
  FOR (m:MatchReport) ON (m.id);
