interface AuthDividerProps {
  label?: string;
}

export function AuthDivider({ label = "OR" }: AuthDividerProps) {
  return (
    <div className="auth-divider" role="separator" aria-label={label}>
      <span />
      <strong>{label}</strong>
      <span />
    </div>
  );
}
