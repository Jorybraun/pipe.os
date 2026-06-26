interface NotepadWindowProps {
  value: string;
  onChange: (value: string) => void;
}

export function NotepadWindow({ value, onChange }: NotepadWindowProps): JSX.Element {
  return (
    <div className="win95-notepad">
      <div className="win95-notepad-menu" aria-hidden="true">
        <span>File</span>
        <span>Edit</span>
        <span>Format</span>
        <span>View</span>
        <span>Help</span>
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
