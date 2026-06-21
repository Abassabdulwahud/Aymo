interface TopBarProps {
  onSave: () => void;
  onShare: () => void;
}

export function TopBar({ onSave, onShare }: TopBarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">AYMO Notebook</p>
        <h1 className="page-title">Note Page</h1>
      </div>
      <div className="topbar-actions">
        <button className="btn btn-ghost" onClick={onShare}>
          Share
        </button>
        <button className="btn btn-solid" onClick={onSave}>
          Save
        </button>
      </div>
    </header>
  );
}
