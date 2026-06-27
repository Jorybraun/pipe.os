interface NotepadWindowProps {
  value: string;
  onChange: (value: string) => void;
  saveStatus?: string;
}

export function NotepadWindow({ value, onChange, saveStatus }: NotepadWindowProps): JSX.Element {
  return (
    <div className="win95-notepad">
      <div className="win95-notepad-menu" aria-hidden="true">
        <span>File</span>
        <span>Edit</span>
        <span>Format</span>
        <span>View</span>
        <span>Help</span>
        {saveStatus && <span className="win95-notepad-save-status">{saveStatus}</span>}
      </div>
      <textarea
        className="win95-notepad-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        data-testid="room-notepad-textarea"
        aria-label="Notepad"
      />
    </div>
  );
}
