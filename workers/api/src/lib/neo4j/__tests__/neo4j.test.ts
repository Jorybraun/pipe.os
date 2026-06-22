/**
 * Neo4j driver + query + write modules unit tests.
 *
 * Mocks neo4j-driver so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock factory — no top-level variables allowed inside
vi.mock('neo4j-driver', () => {
  const mockSessionRun = vi.fn();
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockDriver = {
    session: vi.fn().mockReturnValue({
      run: mockSessionRun,
      close: mockSessionClose,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    __esModule: true,
    default: {
      driver: vi.fn().mockReturnValue(mockDriver),
      auth: {
        basic: vi.fn().mockReturnValue({ scheme: 'basic', principal: 'neo4j', credentials: 'test' }),
      },
    },
    driver: vi.fn().mockReturnValue(mockDriver),
    auth: {
      basic: vi.fn().mockReturnValue({ scheme: 'basic', principal: 'neo4j', credentials: 'test' }),
    },
    // Expose mocks for test assertions
    _mockSessionRun: mockSessionRun,
    _mockSessionClose: mockSessionClose,
    _mockDriver: mockDriver,
  };
});

// Import after mock
import { buildNeo4jConfig, getNeo4jDriver, closeNeo4jDriver } from '../driver';
import { runQuery, runReadQuery, neo4jHealthCheck } from '../query';
import { writeCandidateGraph } from '../writeCandidateGraph';
import { writeRoleGraph } from '../writeRoleGraph';
import { writeRepoGraph } from '../writeRepoGraph';
import * as neo4jDriverModule from 'neo4j-driver';

function getMocks() {
  return neo4jDriverModule as unknown as {
    _mockSessionRun: ReturnType<typeof vi.fn>;
    _mockSessionClose: ReturnType<typeof vi.fn>;
    _mockDriver: { session: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  };
}

describe('Neo4j driver', () => {
  beforeEach(() => {
    closeNeo4jDriver();
    vi.clearAllMocks();
  });

  it('builds config from env', () => {
    const config = buildNeo4jConfig({
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'test',
    });
    expect(config).toEqual({
      uri: 'bolt://localhost:7687',
      user: 'neo4j',
      password: 'test',
    });
  });

  it('returns null when uri or password missing', () => {
    expect(buildNeo4jConfig({ NEO4J_URI: 'bolt://x' })).toBeNull();
    expect(buildNeo4jConfig({ NEO4J_PASSWORD: 'x' })).toBeNull();
  });

  it('caches driver instance', () => {
    const config = { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'test' };
    const d1 = getNeo4jDriver(config);
    const d2 = getNeo4jDriver(config);
    expect(d1).toBe(d2);
  });
});

describe('Neo4j query helpers', () => {
  beforeEach(() => {
    const { _mockSessionRun, _mockSessionClose } = getMocks();
    _mockSessionRun.mockReset();
    _mockSessionClose.mockClear();
  });

  it('runQuery executes cypher and closes session', async () => {
    const { _mockSessionRun, _mockSessionClose, _mockDriver } = getMocks();
    _mockSessionRun.mockResolvedValue({ records: [] });
    await runQuery(_mockDriver as any, 'RETURN 1');
    expect(_mockSessionRun).toHaveBeenCalledWith('RETURN 1', {});
    expect(_mockSessionClose).toHaveBeenCalled();
  });

  it('runReadQuery maps records', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [{ get: (k: string) => (k === 'n' ? 42 : null) }],
    });
    const result = await runReadQuery(_mockDriver as any, 'RETURN 42 AS n', {}, (r) => r.get('n'));
    expect(result).toEqual([42]);
  });

  it('neo4jHealthCheck returns true on success', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    _mockSessionRun.mockResolvedValue({
      records: [{ get: (k: string) => (k === 'n' ? { toNumber: () => 1 } : null) }],
    });
    const ok = await neo4jHealthCheck(_mockDriver as any);
    expect(ok).toBe(true);
  });

  it('neo4jHealthCheck returns false on error', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    _mockSessionRun.mockRejectedValue(new Error('connection refused'));
    const ok = await neo4jHealthCheck(_mockDriver as any);
    expect(ok).toBe(false);
  });
});

describe('writeCandidateGraph', () => {
  beforeEach(() => {
    closeNeo4jDriver();
    const { _mockSessionRun, _mockSessionClose } = getMocks();
    _mockSessionRun.mockReset();
    _mockSessionClose.mockClear();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: {
        counters: {
          updates: () => ({
            nodesCreated: 1,
            propertiesSet: 2,
            relationshipsCreated: 1,
          }),
        },
      },
    });
  });

  it('MERGEs candidate nodes with semantic classification stored as data', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    const result = await writeCandidateGraph({
      candidateId: 'cand-123',
      nodes: [
        {
          id: 'node-1',
          candidate_id: 'cand-123',
          node_type: 'PreviouslyUnseenCapability',
          narrative_text: 'TypeScript',
          extracted_properties_json: JSON.stringify({ esco_id: '1234' }),
          embedding_json: JSON.stringify([0.1, 0.2, 0.3]),
          source_type: 'resume',
          source_reference: null,
          captured_at: 1234567890,
          confidence: 0.9,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'v1',
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    expect(result.nodesCreated).toBe(1);
    expect(result.relationshipsCreated).toBe(1);

    const calls = _mockSessionRun.mock.calls as [string, Record<string, unknown>][];
    const nodeCypher = calls.find((call) => call[0].includes('MERGE (n:CandidateNode {id: node.id})'));
    expect(nodeCypher).toBeDefined();
    expect(nodeCypher![0]).toContain('n.node_type = node.node_type');
    const params = nodeCypher![1] as { nodes: Array<{ node_type: string }> };
    expect(params.nodes[0]!.node_type).toBe('PreviouslyUnseenCapability');
  });

  it('supersedes existing nodes from the same source type before writing', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    await writeCandidateGraph({
      candidateId: 'cand-123',
      nodes: [
        {
          id: 'node-1',
          candidate_id: 'cand-123',
          node_type: 'Skill',
          narrative_text: 'TypeScript',
          extracted_properties_json: null,
          embedding_json: JSON.stringify([0.1, 0.2, 0.3]),
          source_type: 'resume',
          source_reference: null,
          captured_at: 1234567890,
          confidence: 0.9,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'v1',
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    const calls = _mockSessionRun.mock.calls as [string, Record<string, unknown>][];
    const supersedeCypher = calls.find((c) => c[0].includes('SET n.superseded_at = $now'));
    expect(supersedeCypher).toBeDefined();
    expect(supersedeCypher![1]).toMatchObject({
      source_type: 'resume',
    });
  });

  it('skips nodes without embeddings', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    const result = await writeCandidateGraph({
      candidateId: 'cand-123',
      nodes: [
        {
          id: 'node-1',
          candidate_id: 'cand-123',
          node_type: 'Skill',
          narrative_text: 'TypeScript',
          extracted_properties_json: null,
          embedding_json: null,
          source_type: 'resume',
          source_reference: null,
          captured_at: 1234567890,
          confidence: 0.9,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'v1',
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    // Candidate MERGE still runs, but node UNWIND is skipped
    expect(_mockSessionRun).toHaveBeenCalledTimes(1);
  });

  it('throws when config is missing', async () => {
    await expect(
      writeCandidateGraph({
        candidateId: 'cand-123',
        nodes: [],
        env: {},
      }),
    ).rejects.toThrow('missing Neo4j config');
  });
});

describe('writeRoleGraph', () => {
  beforeEach(() => {
    closeNeo4jDriver();
    const { _mockSessionRun, _mockSessionClose } = getMocks();
    _mockSessionRun.mockReset();
    _mockSessionClose.mockClear();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: {
        counters: {
          updates: () => ({
            nodesCreated: 1,
            propertiesSet: 2,
            relationshipsCreated: 1,
          }),
        },
      },
    });
  });

  it('MERGEs open role semantics through structural nodes and edges', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    const result = await writeRoleGraph({
      roleContextId: 'role-123',
      pipelineId: 'pipe-123',
      rcdVersion: 'v1',
      nodes: [
        {
          id: 'req-1',
          role_context_id: 'role-123',
          rcd_version: 'v1',
          node_type: 'PreviouslyUnseenRoleMeaning',
          narrative_text: 'Requirement: Must know TypeScript',
          extracted_properties_json: '{}',
          embedding_json: JSON.stringify([0.1, 0.2]),
          source_section: 'domain_matrix.work.hiring_manager.laddering_chains',
          source_stakeholder: 'HIRING_MANAGER',
          weight: 1.0,
          superseded_at: null,
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    expect(result.nodesCreated).toBeGreaterThanOrEqual(0);
    const calls = _mockSessionRun.mock.calls as [string, Record<string, unknown>][];
    const roleNodeCypher = calls.find((c) => c[0].includes('MERGE (n:RoleNode {id: node.id})'));
    expect(roleNodeCypher).toBeDefined();
    expect(roleNodeCypher![0]).toContain('n.node_type = node.node_type');
    expect(roleNodeCypher![0]).toContain('MERGE (r)-[e:HAS]->(n)');
    const params = roleNodeCypher![1] as { nodes: Array<{ node_type: string }> };
    expect(params.nodes[0]!.node_type).toBe('PreviouslyUnseenRoleMeaning');
  });

  it('throws when config is missing', async () => {
    await expect(
      writeRoleGraph({
        roleContextId: 'role-123',
        pipelineId: 'pipe-123',
        rcdVersion: 'v1',
        nodes: [],
        env: {},
      }),
    ).rejects.toThrow('missing Neo4j config');
  });
});

describe('writeRepoGraph', () => {
  beforeEach(() => {
    closeNeo4jDriver();
    const { _mockSessionRun, _mockSessionClose } = getMocks();
    _mockSessionRun.mockReset();
    _mockSessionClose.mockClear();
    _mockSessionRun.mockResolvedValue({
      records: [],
      summary: {
        counters: {
          updates: () => ({
            nodesCreated: 1,
            propertiesSet: 2,
            relationshipsCreated: 1,
          }),
        },
      },
    });
  });

  it('MERGEs repo and sub-elements with embeddings', async () => {
    const { _mockSessionRun } = getMocks();
    const result = await writeRepoGraph({
      repoId: 123,
      fullName: 'owner/repo',
      adminStatus: 'approved',
      signalsVersion: 'v2.0.0',
      subElements: [
        {
          node_type: 'PreviouslyUnseenRepoSignal',
          slug: 'auth',
          narrative_text: 'OAuth2 authentication',
          source_reference: 'signals_v2',
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    expect(result.nodesCreated).toBe(1);
    expect(result.relationshipsCreated).toBe(1);
    expect(_mockSessionRun).toHaveBeenCalledTimes(2);
    const [nodeCypher, nodeParams] = _mockSessionRun.mock.calls[1]!;
    expect(nodeCypher).toContain('MERGE (n:RepoNode {id: node.id})');
    expect(nodeCypher).not.toContain(':PreviouslyUnseenRepoSignal');
    expect(nodeCypher).not.toContain(':Feature');
    expect((nodeParams as { nodes: Array<{ node_type: string }> }).nodes[0]!.node_type)
      .toBe('PreviouslyUnseenRepoSignal');
  });

  it('skips nodes without embeddings', async () => {
    const { _mockSessionRun, _mockDriver } = getMocks();
    await writeRepoGraph({
      repoId: 123,
      signalsVersion: 'v2.0.0',
      subElements: [
        {
          node_type: 'Feature',
          slug: 'auth',
          narrative_text: 'OAuth2 authentication',
          embedding: null,
        },
      ],
      env: {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'test',
      },
    });

    // Repo MERGE still runs, but node UNWIND is skipped
    expect(_mockSessionRun).toHaveBeenCalledTimes(1);
  });

  it('throws when config is missing', async () => {
    await expect(
      writeRepoGraph({
        repoId: 123,
        signalsVersion: 'v2.0.0',
        subElements: [],
        env: {},
      }),
    ).rejects.toThrow('missing Neo4j config');
  });
});
