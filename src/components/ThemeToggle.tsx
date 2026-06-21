interface ThemeToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}

export function ThemeToggle({ checked, onChange, label = "Dark mode" }: ThemeToggleProps) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button
        type="button"
        className={`switch ${checked ? "active" : ""}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </label>
  );
}
