import { useI18n } from "../i18n";

interface AuthDividerProps {
  label?: string;
}

export function AuthDivider({ label }: AuthDividerProps) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("auth.or");

  return (
    <div className="auth-divider" role="separator" aria-label={resolvedLabel}>
      <span />
      <strong>{resolvedLabel}</strong>
      <span />
    </div>
  );
}
