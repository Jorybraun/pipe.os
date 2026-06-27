import { FileJson, FileText, FolderOpen, Link2, Palette, Trash2 } from 'lucide-react';
import type { RoomFile, RoomFileKind } from '../hooks/useRoomConnection';

interface RoomFileSystemWindowProps {
  files: RoomFile[];
  onOpenFile: (file: RoomFile) => void;
  onDeleteFile: (file: RoomFile) => void;
}

const FILE_KIND_LABELS: Record<RoomFileKind, string> = {
  text: 'Text',
  paint: 'Paint',
  json: 'JSON',
  link: 'Link',
};

function FileKindIcon({ kind }: { kind: RoomFileKind }): JSX.Element {
  if (kind === 'paint') return <Palette size={16} />;
  if (kind === 'json') return <FileJson size={16} />;
  if (kind === 'link') return <Link2 size={16} />;
  return <FileText size={16} />;
}

function filePath(file: RoomFile): string {
  const value = file.metadata?.path;
  return typeof value === 'string' && value.trim().length > 0 ? value : `Desktop/${file.name}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function RoomFileSystemWindow({
  files,
  onOpenFile,
  onDeleteFile,
}: RoomFileSystemWindowProps): JSX.Element {
  return (
    <div className="win95-files" data-testid="room-file-system">
      <div className="win95-files-toolbar">
        <FolderOpen size={16} />
        <span>Desktop</span>
      </div>
      <div className="win95-files-list" role="list">
        {files.length === 0 ? (
          <div className="win95-files-empty">No shared files yet.</div>
        ) : files.map((file) => (
          <div className="win95-files-row" role="listitem" key={file.id}>
            <div className="win95-files-icon">
              <FileKindIcon kind={file.kind} />
            </div>
            <div className="win95-files-main">
              <strong>{file.name}</strong>
              <span>{filePath(file)}</span>
            </div>
            <span className="win95-files-kind">{FILE_KIND_LABELS[file.kind]}</span>
            <span className="win95-files-time">{formatTime(file.updatedAt)}</span>
            <button
              type="button"
              className="win95-files-action"
              title={`Open ${file.name}`}
              aria-label={`Open ${file.name}`}
              onClick={() => onOpenFile(file)}
            >
              <FolderOpen size={14} />
            </button>
            <button
              type="button"
              className="win95-files-action"
              title={`Delete ${file.name}`}
              aria-label={`Delete ${file.name}`}
              onClick={() => onDeleteFile(file)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="win95-files-status">
        <span>{files.length} object{files.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
