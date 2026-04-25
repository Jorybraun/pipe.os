/**
 * FileTreePanel — collapsible directory tree for browsing repo files.
 *
 * Fetches the repo file tree from /rpc/repo/:challengeId/tree and renders
 * a nested directory structure. Clicking a file triggers onFileSelect.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Loader, GitBranch } from 'lucide-react';
import { useSessionToken } from '../../contexts/SessionTokenContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  size: number;
  children: TreeNode[];
}

interface FileTreePanelProps {
  challengeId: string;
  selectedFile: string | null;
  changedFiles?: Set<string>;
  onFileSelect: (path: string) => void;
  onShowDiff: () => void;
}

// ─── Build nested tree from flat list ───────────────────────────────────────

function buildTree(entries: TreeEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  // Sort: directories first, then alphabetically
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    const parts = entry.path.split('/');
    const name = parts[parts.length - 1] ?? entry.path;
    const node: TreeNode = { name, path: entry.path, type: entry.type, size: entry.size, children: [] };
    nodeMap.set(entry.path, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  return root;
}

// ─── Tree node component ────────────────────────────────────────────────────

function TreeNodeItem({
  node,
  depth,
  selectedFile,
  changedFiles,
  onFileSelect,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  changedFiles?: Set<string> | undefined;
  onFileSelect: (path: string) => void;
  defaultOpen: boolean;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const isSelected = selectedFile === node.path;
  const isDir = node.type === 'tree';
  const isChanged = !isDir && changedFiles?.has(node.path);
  const hasChangedChildren = isDir && changedFiles
    ? Array.from(changedFiles).some((f) => f.startsWith(node.path + '/'))
    : false;

  const handleClick = (): void => {
    if (isDir) {
      setIsOpen(!isOpen);
    } else {
      onFileSelect(node.path);
    }
  };

  // File extension for icon coloring
  const ext = node.name.split('.').pop() ?? '';
  const fileColor = ['ts', 'tsx'].includes(ext) ? '#3178c6'
    : ['js', 'jsx'].includes(ext) ? '#f7df1e'
    : ['json'].includes(ext) ? '#64748b'
    : ['md', 'mdx'].includes(ext) ? '#60a5fa'
    : ['css', 'scss'].includes(ext) ? 'var(--pipe-accent)'
    : 'rgba(255,255,255,0.35)';

  return (
    <>
      <button
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '4px 8px',
          paddingLeft: 8 + depth * 16,
          background: isSelected ? 'rgba(96,165,250,0.1)' : hasChangedChildren ? 'rgba(74,222,128,0.03)' : 'transparent',
          border: 'none',
          borderLeft: isSelected ? '2px solid #60a5fa' : isChanged ? '2px solid #4ade80' : '2px solid transparent',
          color: isSelected ? '#e2e8f0' : isChanged ? '#4ade80' : hasChangedChildren ? 'rgba(74,222,128,0.7)' : 'rgba(255,255,255,0.5)',
          fontSize: 12,
          fontFamily: "'Space Mono', monospace",
          cursor: 'pointer',
          textAlign: 'left',
          outline: 'none',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        {isDir ? (
          <>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {isOpen ? <FolderOpen size={13} color="#fbbf24" /> : <Folder size={13} color="#fbbf24" />}
          </>
        ) : (
          <>
            <span style={{ width: 12 }} />
            <File size={13} color={fileColor} />
          </>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.name}
        </span>
        {isChanged && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
        )}
      </button>
      {isDir && isOpen && node.children.map((child) => (
        <TreeNodeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          changedFiles={changedFiles}
          onFileSelect={onFileSelect}
          defaultOpen={depth < 1}
        />
      ))}
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function FileTreePanel({ challengeId, selectedFile, changedFiles, onFileSelect, onShowDiff }: FileTreePanelProps): JSX.Element {
  const sessionToken = useSessionToken();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const res = await fetch(`${API_BASE}/rpc/repo/${challengeId}/tree`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { tree: TreeEntry[] };
      setTree(buildTree(data.tree));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
    } finally {
      setIsLoading(false);
    }
  }, [challengeId, sessionToken]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#64748b' }}>
        <Loader size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading files...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#ef4444', fontSize: 12 }}>
        {error}
      </div>
    );
  }

  if (!tree || tree.length === 0) {
    return (
      <div style={{ padding: 20, color: '#64748b', fontSize: 12, textAlign: 'center' }}>
        No files found
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Fixed: See diff button */}
      <div style={{ flexShrink: 0, padding: '8px 8px 0' }}>
        <button
          onClick={onShowDiff}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 12px',
            background: 'rgba(96,165,250,0.08)',
            border: '1px solid rgba(96,165,250,0.2)',
            borderRadius: 6,
            color: '#60a5fa',
            fontSize: 11,
            fontFamily: "'Space Mono', monospace",
            cursor: 'pointer',
            letterSpacing: '0.05em',
          }}
        >
          <GitBranch size={12} />
          VIEW CHANGES ({changedFiles?.size ?? 0} files)
        </button>
      </div>

      {/* Scrollable: File tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {tree.map((node) => (
          <TreeNodeItem
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            changedFiles={changedFiles}
            onFileSelect={onFileSelect}
            defaultOpen
          />
        ))}
      </div>
    </div>
  );
}
