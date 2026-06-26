import { RefObject } from "react";
import { useI18n } from "../i18n";

interface SocialAuthButtonsProps {
  mode: "login" | "signup";
  onGoogle: () => Promise<void>;
  onApple: () => Promise<void>;
  disabled?: boolean;
  googleButtonRef: RefObject<HTMLDivElement>;
  googleEnabled: boolean;
  googleStatus: string | null;
  appleEnabled: boolean;
  appleStatus: string | null;
}

export function SocialAuthButtons({
  mode,
  onGoogle,
  onApple,
  disabled = false,
  googleButtonRef,
  googleEnabled,
  googleStatus,
  appleEnabled,
  appleStatus,
}: SocialAuthButtonsProps) {
  const { t } = useI18n();
  const text = mode === "login" ? t("auth.loginCta") : t("auth.signupCta");

  return (
    <div className="social-auth-group">
      {googleEnabled ? (
        <div ref={googleButtonRef} className="google-signin-slot" aria-label={`${text} with Google`} />
      ) : (
        <button className="btn social-btn" type="button" onClick={() => void onGoogle()} disabled={disabled}>
          {text} with Google
        </button>
      )}
      {googleStatus ? <p className="social-auth-status">{googleStatus}</p> : null}

      <button
        className="btn social-btn"
        type="button"
        onClick={() => void onApple()}
        disabled={disabled || !appleEnabled}
      >
        {text} with Apple
      </button>
      {appleStatus ? <p className="social-auth-status">{appleStatus}</p> : null}
    </div>
  );
}
